// Periodic (POLL_INTERVAL_MIN) and on-demand sync. Reads GitHub, the team chat (Discord or Slack) and
// the issue trackers (Jira, Linear), applies the
// domain rules, masks every text and keeps an in-memory snapshot for the API.
// Only write: upsert into deck_prs (own collection).
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { blockersFromChannels, blockersFromDailies, mergeBlockers, type ChannelMessage, type OpenBlocker } from '../domain/blockers.js';
import { summarizeDaily, type DailyMessage, type DailySummary } from '../domain/daily.js';
import { deriveStatus, prodBranchMatcher } from '../domain/pr-status.js';
import { parseTypeOrder, sortQueue, typeRank } from '../domain/priority.js';
import { deriveReview, sortReviews, type ReviewDerived } from '../domain/reviews.js';
import type { MaskResult } from '../privacy/mask.js';
import { answeredByMe, discordChat, slackChat, titleOf, type ChatMessage, type ChatSettings, type ChatSource } from '../sources/chat.js';
import { findKeys, jiraTracker, keyFromUrl, linearTracker, type TrackerIssue, type TrackerSource } from '../sources/trackers.js';
import {
  boardIssueOf, fetchIssueLinks, fetchMyItems, fetchOpenDeployPrs, fetchProjectIssues, fetchPrsMentioning, fetchReviewRequests, fetchTeamPrs, GitHubClient,
  MissingProjectScope, parseIssueRef, reviewTimes, type DeployPrNodeT,
} from '../sources/github.js';
import { deployDateFrom } from '../domain/deploy-date.js';
import type { DeckStore } from '../store/store.js';
import { demoData, seedDemo } from '../demo/seed.js';
import { PrsRepo, type SyncedGroup, type SyncedPr } from '../store/prs-repo.js';

export type SourceId = 'github' | 'chat' | 'tracker' | 'prs';
export interface SourceState { configured: boolean; lastSync?: string | undefined; error?: string | undefined; running: boolean; provider?: string | undefined }

export interface QueueItem {
  key: string;
  source: 'github' | 'chat' | 'jira' | 'linear';
  /** Where it came from, for the screen ("Slack · support", "Jira · ABC-12"). */
  origin?: string | undefined;
  kind: 'issue' | 'pr' | 'message';
  type: string;
  rank: number;
  title: string;
  url: string;
  repo?: string | undefined;
  number?: number | undefined;
  labels: string[];
  author?: string | undefined;
  createdAt: string;
  updatedAt: string;
  reasons: string[];
  /** Is the last comment mine (did I answer after the mention)? */
  answered: boolean;
}

export interface ReviewItem extends ReviewDerived {
  key: string; title: string; url: string; repo: string; number: number; author?: string | undefined;
  isDraft: boolean; additions: number; deletions: number; changedFiles: number; base: string; createdAt: string; requestedAt?: string | undefined;
}

type Mask = (s: string) => MaskResult;

/** Who reviewed the PR (team member name when known), without the author and without bots. */
export function reviewersOf(pr: Pick<DeployPrNodeT, 'reviews' | 'author'>, names: Map<string, string>): string[] {
  const author = pr.author?.login?.toLowerCase();
  const logins = pr.reviews.nodes.map(r => r.author?.login).filter((l): l is string => !!l && l.toLowerCase() !== author && !/\[bot\]$/i.test(l));
  return [...new Set(logins.map(l => names.get(l.toLowerCase()) ?? l))];
}

export class SyncService {
  readonly state: Record<SourceId, SourceState>;
  reviews: ReviewItem[] = [];
  queue: QueueItem[] = [];
  daily: DailySummary | undefined;
  blockers: OpenBlocker[] = [];
  private running: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly gh: GitHubClient | undefined;
  private readonly chat: ChatSource | undefined;
  private readonly chatSettings: ChatSettings;
  readonly trackers: TrackerSource[];
  private readonly prs: PrsRepo;
  private readonly typeRules;
  private readonly isProdBranch: (base: string | undefined) => boolean;

  constructor(
    private readonly cfg: Config, private readonly store: DeckStore, private readonly mask: Mask, private readonly log: Pick<FastifyBaseLogger, 'warn' | 'error'>,
    deps: { chat?: { source: ChatSource; settings: ChatSettings } | undefined; trackers?: TrackerSource[] | undefined } = {},
  ) {
    this.gh = cfg.github.org ? new GitHubClient({ token: cfg.github.token, login: cfg.github.login }) : undefined;
    const c = deps.chat ?? chatFrom(cfg);
    this.chat = c?.source;
    this.chatSettings = c?.settings ?? { watchChannels: [], myGroupIds: [], team: [] };
    this.trackers = deps.trackers ?? trackersFrom(cfg);
    this.prs = new PrsRepo(store);
    this.typeRules = parseTypeOrder(cfg.queueTypeOrder);
    this.isProdBranch = prodBranchMatcher(cfg.deploy.prodBranches);
    this.state = {
      github: { configured: !!this.gh, running: false },
      chat: { configured: !!this.chat && !!this.chatSettings.dailyChannelId && this.chatSettings.team.length > 0, running: false, provider: this.chat?.label },
      tracker: { configured: this.trackers.length > 0, running: false, provider: this.trackers.map(t => t.label).join(' + ') || undefined },
      // Without the team list the sync would bring PRs from other teams (that I only review): it stays off.
      // Deploy routine: tracked issues (Project, deck or migrated) → linked PRs. The team list is optional.
      prs: { configured: !!this.gh && store.configured, running: false },
    };
  }

  private m = (s: string) => this.mask(s).text;

  /** Demo mode: fictitious sources, database seeded once, nothing leaves the machine. */
  get demo(): boolean { return this.cfg.demo.on; }

  private async loadDemo(): Promise<void> {
    const d = demoData(this.cfg.demo.lang);
    this.daily = d.daily; this.blockers = d.blockers; this.queue = d.queue; this.reviews = d.reviews;
    const at = new Date().toISOString();
    for (const id of Object.keys(this.state) as SourceId[]) this.state[id] = { configured: true, running: false, lastSync: at, provider: id === 'chat' ? 'Discord' : id === 'tracker' ? 'Jira' : undefined };
    await seedDemo(this.store, this.cfg.demo.lang).catch(e => this.log.warn({ err: (e as Error).message }, 'failed to seed demo mode'));
  }

  start(): void {
    if (this.demo) { void this.loadDemo(); return; }
    void this.run();
    this.timer = setInterval(() => void this.run(), this.cfg.limits.pollIntervalMin * 60_000);
  }
  stop(): void { clearInterval(this.timer); }

  /** Runs a sync (or waits for the one already running). */
  run(): Promise<void> {
    if (this.demo) return this.loadDemo();
    this.running ??= (async () => {
      try {
        await Promise.all([
          this.step('github', () => this.syncGitHub()),
          this.step('chat', () => this.syncChat()),
          this.step('tracker', () => this.syncTrackers()),
          this.step('prs', () => this.syncPrs()),
        ]);
      } finally { this.running = undefined; }
    })();
    return this.running;
  }

  private async step(id: SourceId, fn: () => Promise<void>): Promise<void> {
    const s = this.state[id];
    if (!s.configured) return;
    s.running = true;
    try {
      await fn();
      s.lastSync = new Date().toISOString();
      s.error = undefined;
    } catch (e) {
      s.error = this.m((e as Error).message ?? 'error');
      this.log.warn({ source: id, error: s.error }, 'sync failed');
    } finally { s.running = false; }
  }

  // ---------- GitHub: reviews and queue ----------
  private async syncGitHub(): Promise<void> {
    const gh = this.gh!;
    const org = this.cfg.github.org!;
    const me = await gh.viewerLogin();
    const now = Date.now();
    const [reviews, items] = await Promise.all([fetchReviewRequests(gh, org), fetchMyItems(gh, org)]);

    this.reviews = sortReviews(reviews.map(r => {
      const mine = r.timelineItems.nodes.filter(n => n.requestedReviewer?.login?.toLowerCase() === me.toLowerCase() && n.createdAt);
      const requestedAt = mine[mine.length - 1]?.createdAt ?? r.timelineItems.nodes[r.timelineItems.nodes.length - 1]?.createdAt;
      return deriveReview({
        key: `gh:${r.repository.nameWithOwner}#${r.number}`, title: this.m(r.title), url: r.url, repo: r.repository.nameWithOwner, number: r.number,
        author: r.author?.login, isDraft: r.isDraft, additions: r.additions, deletions: r.deletions, changedFiles: r.changedFiles,
        base: r.baseRefName, createdAt: r.createdAt, requestedAt,
      }, now, this.cfg.team.holidays);
    }));

    const githubQueue: QueueItem[] = items.map(({ node, reasons }) => {
      const typeName = node.__typename === 'Issue' ? node.issueType?.name : undefined;
      const labels = node.labels.nodes.map(l => l.name);
      const rank = typeRank(this.typeRules, typeName, ...labels);
      const last = node.comments.nodes[0];
      return {
        key: `gh:${node.repository.nameWithOwner}#${node.number}`, source: 'github', kind: node.__typename === 'Issue' ? 'issue' : 'pr',
        type: typeName ?? (node.__typename === 'PullRequest' ? 'PR' : 'Issue'), rank,
        title: this.m(node.title), url: node.url, repo: node.repository.nameWithOwner, number: node.number, labels,
        author: node.author?.login, createdAt: node.createdAt, updatedAt: node.updatedAt, reasons,
        answered: !!last && last.author?.login?.toLowerCase() === me.toLowerCase(),
      };
    });
    this.queue = sortQueue([...githubQueue, ...this.queue.filter(q => q.source !== 'github')]);
  }

  // ---------- Team chat (Discord or Slack): daily, blockers, mentions ----------
  private async syncChat(): Promise<void> {
    const chat = this.chat!;
    const cfg = this.chatSettings;
    const now = Date.now();
    const team = cfg.team;
    const toDaily = (m: ChatMessage): DailyMessage => ({ id: m.id, authorId: m.authorId, content: this.m(m.text), timestamp: m.at, url: m.url });

    const dailyMsgs = (await chat.messagesSince(cfg.dailyChannelId!, now - 10 * 86_400_000)).map(toDaily);
    this.daily = summarizeDaily(dailyMsgs, team, now, this.cfg.team.tzOffsetMin);

    const raw: ChatMessage[] = [];
    const channelMsgs: ChannelMessage[] = [];
    for (const ch of cfg.watchChannels) {
      const msgs = await chat.messagesSince(ch.id, now - 7 * 86_400_000, 500);
      raw.push(...msgs);
      channelMsgs.push(...msgs.map(m => ({ ...toDaily(m), channel: ch.label })));
    }
    this.blockers = mergeBlockers(
      blockersFromDailies(dailyMsgs, team, now, this.cfg.team.tzOffsetMin),
      blockersFromChannels(channelMsgs, team, now),
    );

    // Mentions of me (user or groups) I have not answered yet.
    const myId = cfg.myUserId;
    const groups = new Set(cfg.myGroupIds);
    const labels = new Map(cfg.watchChannels.map(c => [c.id, c.label]));
    const chatQueue: QueueItem[] = [];
    if (myId) {
      for (const m of raw) {
        if (m.authorId === myId) continue;
        if (!m.mentions.includes(myId) && !m.groupMentions.some(g => groups.has(g))) continue;
        const channel = labels.get(m.channelId) ?? m.channelId;
        chatQueue.push({
          key: `${chat.provider}:${m.channelId}:${m.id}`, source: 'chat', origin: `${chat.label} · ${channel}`, kind: 'message', type: channel,
          rank: typeRank(this.typeRules, channel), title: this.m(titleOf(m.text)) || '(no text)', url: m.url,
          labels: [channel], author: m.authorName, createdAt: m.at, updatedAt: m.at, reasons: ['mentioned'], answered: answeredByMe(m, raw, myId),
        });
      }
    }
    this.queue = sortQueue([...this.queue.filter(q => q.source !== 'chat'), ...chatQueue]);
  }

  // ---------- Issue trackers (Jira, Linear): my queue ----------
  private async syncTrackers(): Promise<void> {
    const items: QueueItem[] = [];
    const failures: string[] = [];
    await Promise.all(this.trackers.map(async t => {
      try {
        for (const i of await t.myQueue()) items.push(this.trackerItem(i));
      } catch (e) { failures.push((e as Error).message); }
    }));
    this.queue = sortQueue([...this.queue.filter(q => q.source !== 'jira' && q.source !== 'linear'), ...items]);
    if (failures.length) throw new Error(failures.join(' · '));
  }

  private trackerItem(i: TrackerIssue): QueueItem {
    return {
      key: `${i.provider}:${i.key}`, source: i.provider, origin: `${i.provider === 'jira' ? 'Jira' : 'Linear'} · ${i.key}`, kind: 'issue',
      type: i.type ?? 'Issue', rank: typeRank(this.typeRules, i.type, ...i.labels), title: this.m(i.title), url: i.url, labels: i.labels,
      createdAt: i.createdAt, updatedAt: i.updatedAt, reasons: ['assigned'], answered: false,
    };
  }

  /** The tracker issue a PR belongs to, from a key in its title, branch or body (first tracker that knows the prefix). */
  private trackerKeyOf(pr: DeployPrNodeT): { tracker: TrackerSource; key: string } | undefined {
    const text = `${pr.title} ${pr.headRefName} ${pr.body}`;
    for (const t of this.trackers) {
      const [key] = findKeys(text, t.prefixes);
      if (key) return { tracker: t, key };
    }
    return undefined;
  }

  // ---------- PRs and deploys → deck_prs ----------
  /** null = not tested yet; false = token without read:project (degrades without Project). */
  projectScope: boolean | null = null;
  get projectsConfigured(): number { return this.cfg.deploy.projects.length; }

  private toSyncedPr(pr: DeployPrNodeT, names: Map<string, string>): SyncedPr {
    const status = deriveStatus({ state: pr.state, reviewDecision: pr.reviewDecision, reviewCount: pr.reviews.totalCount, ...reviewTimes(pr), intoProduction: this.isProdBranch(pr.baseRefName) });
    const owner = names.get(pr.author?.login?.toLowerCase() ?? '') ?? pr.author?.login ?? '?';
    return {
      url: pr.url, title: this.m(pr.title), owner, ...(pr.author?.login ? { author: pr.author.login } : {}), status: status ?? 'review_queue',
      state: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
      repo: pr.repository.nameWithOwner, number: pr.number, base: pr.baseRefName, isDraft: pr.isDraft,
      additions: pr.additions, deletions: pr.deletions, mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
      head: pr.headRefName, labels: (pr.labels?.nodes ?? []).map(l => l.name),
      reviewers: reviewersOf(pr, names),
    };
  }

  /** Runs a call that reads the Project; if the scope is missing, flags it and returns undefined. */
  private async withProject<T>(fn: (withProject: boolean) => Promise<T>): Promise<T> {
    if (this.projectScope === false) return fn(false);
    try {
      const r = await fn(true);
      this.projectScope = true;
      return r;
    } catch (e) {
      if (!(e instanceof MissingProjectScope)) throw e;
      this.projectScope = false;
      this.log.warn('GitHub token without read:project: Project deploy dates turned off');
      return fn(false);
    }
  }

  private async syncPrs(): Promise<void> {
    await this.store.connect();
    const gh = this.gh!;
    const org = this.cfg.github.org!;
    const names = new Map(this.cfg.github.team.map(t => [t.login.toLowerCase(), t.name]));
    const today = Date.now();
    const minDeploy = new Date(today - this.cfg.deploy.lookbackDays * 86_400_000).toISOString().slice(0, 10);

    // 1) Finds issues with a deploy date in the configured Projects.
    if (this.cfg.deploy.projects.length && this.projectScope !== false) {
      try {
        for (const n of this.cfg.deploy.projects) {
          const items = await fetchProjectIssues(gh, org, n);
          for (const it of items) {
            const date = deployDateFrom(it.fields, this.cfg.deploy.dateField);
            if (!date || date < minDeploy) continue;
            await this.prs.upsertGroup({ key: it.url, title: this.m(it.title), reference: it.url, owner: '', prs: [], projectDeployDate: date, issueState: it.state === 'CLOSED' ? 'CLOSED' : 'OPEN' });
          }
        }
        this.projectScope = true;
      } catch (e) {
        if (!(e instanceof MissingProjectScope)) throw e;
        this.projectScope = false;
      }
    }

    // 1b) Finds deliveries from the PRs open to the deploy branches (does not depend on the Project or
    //     the team list): the issue the PR mentions is tracked with all its PRs.
    const since = new Date(today - this.cfg.prsLookbackDays * 86_400_000).toISOString().slice(0, 10);
    if (this.cfg.deploy.baseBranches.length) await this.groupAndSave(await fetchOpenDeployPrs(gh, org, this.cfg.deploy.baseBranches, since), names);

    // 2) The team's recent PRs (when the team list exists), grouped by issue.
    if (this.cfg.github.team.length) await this.groupAndSave(await fetchTeamPrs(gh, org, this.cfg.github.team.map(t => t.login), since), names);

    // 3) For each tracked issue: every linked PR (any author/repo) + the Project date.
    const refs = await this.prs.issueRefsToTrack();
    const links = await this.withProject(withProject => fetchIssueLinks(gh, refs, withProject));
    for (const issue of links) {
      const prs = issue.prs.map(pr => this.toSyncedPr(pr, names));
      await this.prs.upsertGroup({
        key: issue.url, title: this.m(issue.title), reference: issue.url, owner: prs[0]?.owner ?? '',
        prs, projectDeployDate: deployDateFrom(issue.projectFields, this.cfg.deploy.dateField), issueState: issue.state,
      });
    }

    // 3b) Issues tracked in Jira/Linear: state, title and deploy date from the tracker; PRs that mention the key.
    if (this.trackers.length) {
      const keys = (await this.prs.trackerRefsToTrack()).map(keyFromUrl).filter((k): k is string => !!k);
      await this.saveTrackerGroups(keys, await fetchPrsMentioning(gh, org, keys), names);
    }
  }

  /**
   * Groups PRs by the issue they belong to and saves the groups: a GitHub issue (closing reference or board link),
   * else a Jira/Linear key found in the PR, else the PR on its own.
   */
  private async groupAndSave(prs: DeployPrNodeT[], names: Map<string, string>): Promise<void> {
    const org = this.cfg.github.org!;
    const groups = new Map<string, SyncedGroup>();
    const byKey = new Map<string, DeployPrNodeT[]>();
    for (const pr of prs) {
      const issue = boardIssueOf(pr, org, this.cfg.github.boardRepo);
      const tracked = issue ? undefined : this.trackerKeyOf(pr);
      if (tracked) { byKey.set(tracked.key, [...(byKey.get(tracked.key) ?? []), pr]); continue; }
      const synced = this.toSyncedPr(pr, names);
      const key = issue?.url ?? pr.url;
      const g = groups.get(key) ?? { key, title: this.m(issue?.title ?? pr.title), reference: issue?.url, owner: synced.owner, prs: [] };
      g.prs.push(synced);
      groups.set(key, g);
    }
    for (const g of groups.values()) await this.prs.upsertGroup(g);
    if (byKey.size) await this.saveTrackerGroups([...byKey.keys()], [...byKey.values()].flat(), names);
  }

  /** Saves one group per Jira/Linear issue, with the tracker's title, state and deploy date and the PRs that mention its key. */
  private async saveTrackerGroups(keys: string[], prs: DeployPrNodeT[], names: Map<string, string>): Promise<void> {
    const issues = new Map<string, TrackerIssue>();
    for (const t of this.trackers) {
      const mine = keys.filter(k => findKeys(k, t.prefixes).length);
      if (!mine.length) continue;
      try {
        for (const i of await t.issues(mine)) issues.set(i.key, i);
      } catch (e) { this.log.warn({ tracker: t.provider, err: this.m((e as Error).message) }, 'failed to read tracker issues'); }
    }
    for (const key of new Set(keys)) {
      const issue = issues.get(key);
      const related = prs.filter(pr => this.trackerKeyOf(pr)?.key === key).map(pr => this.toSyncedPr(pr, names));
      if (!issue) {
        // Unknown to the tracker (or it failed): keep each PR on its own, as before.
        for (const p of related) await this.prs.upsertGroup({ key: p.url, title: p.title, owner: p.owner, prs: [p] });
        continue;
      }
      await this.prs.upsertGroup({
        key: issue.url, title: this.m(`${issue.key} ${issue.title}`), reference: issue.url, owner: related[0]?.owner ?? '', prs: related,
        ...(issue.deployDate ? { projectDeployDate: issue.deployDate } : {}), issueState: issue.done ? 'CLOSED' : 'OPEN',
      });
    }
  }

  /** Starts tracking an issue (link, org/repo#n or board number) and fetches its PRs right away. */
  async trackIssue(ref: string, deployDate?: string): Promise<{ key: string; title: string; prs: number }> {
    const fromTracker = await this.trackTrackerIssue(ref.trim(), deployDate);
    if (fromTracker) return fromTracker;
    if (!this.gh || !this.cfg.github.org) throw Object.assign(new Error('GitHub not configured'), { statusCode: 503 });
    await this.store.connect();
    const org = this.cfg.github.org;
    const normalized = /^\d+$/.test(ref.trim())
      ? (this.cfg.github.boardRepo ? `${org}/${this.cfg.github.boardRepo}#${ref.trim()}` : '')
      : ref.trim();
    if (!parseIssueRef(normalized)) throw Object.assign(new Error('give the issue link, org/repo#number or the number (with GITHUB_BOARD_REPO)'), { statusCode: 400 });
    const [issue] = await this.withProject(withProject => fetchIssueLinks(this.gh!, [normalized], withProject));
    if (!issue) throw Object.assign(new Error('issue not found (or no access)'), { statusCode: 404 });
    const names = new Map(this.cfg.github.team.map(t => [t.login.toLowerCase(), t.name]));
    const prs = issue.prs.map(pr => this.toSyncedPr(pr, names));
    await this.prs.upsertGroup({
      key: issue.url, title: this.m(issue.title), reference: issue.url, owner: prs[0]?.owner ?? '', prs,
      projectDeployDate: deployDateFrom(issue.projectFields, this.cfg.deploy.dateField), issueState: issue.state, source: 'manual',
    });
    if (deployDate) {
      const doc = (await this.prs.list({ includeOldMerged: true })).find(d => d.key === issue.url);
      if (doc?._id) await this.prs.patch(String(doc._id), { deployDate });
    }
    return { key: issue.url, title: issue.title, prs: prs.length };
  }

  /** Jira/Linear key or link ("LOAN-214", ".../browse/LOAN-214"): tracks it with the PRs that mention the key. */
  private async trackTrackerIssue(ref: string, deployDate?: string): Promise<{ key: string; title: string; prs: number } | undefined> {
    const key = keyFromUrl(ref) ?? (/^[A-Z][A-Z0-9_]*-\d+$/i.test(ref) ? ref.toUpperCase() : undefined);
    const tracker = key && this.trackers.find(t => (/^https?:/.test(ref) ? t.owns(ref) : findKeys(key, t.prefixes).length > 0));
    if (!key || !tracker) return undefined;
    await this.store.connect();
    const [issue] = await tracker.issues([key]);
    if (!issue) throw Object.assign(new Error('issue not found (or no access)'), { statusCode: 404 });
    const names = new Map(this.cfg.github.team.map(t => [t.login.toLowerCase(), t.name]));
    const found = this.gh && this.cfg.github.org ? await fetchPrsMentioning(this.gh, this.cfg.github.org, [key]) : [];
    const prs = found.filter(pr => this.trackerKeyOf(pr)?.key === key).map(pr => this.toSyncedPr(pr, names));
    await this.prs.upsertGroup({
      key: issue.url, title: this.m(`${issue.key} ${issue.title}`), reference: issue.url, owner: prs[0]?.owner ?? '', prs,
      ...(issue.deployDate ? { projectDeployDate: issue.deployDate } : {}), issueState: issue.done ? 'CLOSED' : 'OPEN', source: 'manual',
    });
    if (deployDate) {
      const doc = (await this.prs.list({ includeOldMerged: true })).find(d => d.key === issue.url);
      if (doc?._id) await this.prs.patch(String(doc._id), { deployDate });
    }
    return { key: issue.url, title: issue.title, prs: prs.length };
  }
}

/** The configured chat (Discord or Slack) and its channels, team and ids. */
export function chatFrom(cfg: Config): { source: ChatSource; settings: ChatSettings } | undefined {
  if (cfg.chatProvider === 'slack' && cfg.slack.token) {
    const s = cfg.slack;
    return { source: slackChat({ token: s.token! }), settings: { dailyChannelId: s.dailyChannelId, watchChannels: s.watchChannels, myUserId: s.myUserId, myGroupIds: s.myGroupIds, team: s.team } };
  }
  if (cfg.chatProvider === 'discord' && cfg.discord.token) {
    const d = cfg.discord;
    return { source: discordChat(d.token!, d.guildId), settings: { dailyChannelId: d.dailyChannelId, watchChannels: d.watchChannels, myUserId: d.myUserId, myGroupIds: d.myRoleIds, team: d.team } };
  }
  return undefined;
}

export function trackersFrom(cfg: Config): TrackerSource[] {
  const j = cfg.trackers.jira;
  const l = cfg.trackers.linear;
  return [
    ...(j ? [jiraTracker({ baseUrl: j.baseUrl, email: j.email, token: j.token, jql: j.jql, deployDateField: j.deployDateField, projectKeys: j.projectKeys })] : []),
    ...(l ? [linearTracker({ apiKey: l.apiKey, teamKeys: l.teamKeys, dueDateIsDeploy: l.dueDateIsDeploy })] : []),
  ];
}
