// Sincronização periódica (POLL_INTERVAL_MIN) e sob demanda. Lê GitHub e Discord, aplica as
// regras de domínio, mascara todo texto e guarda um snapshot em memória para a API.
// Única escrita: upsert em painel_prs (coleção própria).
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { blockersFromChannels, blockersFromDailies, mergeBlockers, type ChannelMessage, type OpenBlocker } from '../domain/blockers.js';
import { summarizeDaily, type DailyMessage, type DailySummary } from '../domain/daily.js';
import { deriveStatus } from '../domain/pr-status.js';
import { parseTypeOrder, sortQueue, typeRank } from '../domain/priority.js';
import { deriveReview, sortReviews, type ReviewDerived } from '../domain/reviews.js';
import type { MaskResult } from '../privacy/mask.js';
import { DiscordClient, type DiscordMessage } from '../sources/discord.js';
import { boardIssueOf, fetchMyItems, fetchReviewRequests, fetchTeamPrs, GitHubClient } from '../sources/github.js';
import type { PainelStore } from '../store/mongo.js';
import { PrsRepo, type SyncedGroup } from '../store/prs-repo.js';

export type SourceId = 'github' | 'discord' | 'prs';
export interface SourceState { configured: boolean; lastSync?: string | undefined; error?: string | undefined; running: boolean }

export interface QueueItem {
  key: string;
  source: 'github' | 'discord';
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
  /** Último comentário é meu (respondi depois da menção)? */
  answered: boolean;
}

export interface ReviewItem extends ReviewDerived {
  key: string; title: string; url: string; repo: string; number: number; author?: string | undefined;
  isDraft: boolean; additions: number; deletions: number; changedFiles: number; base: string; createdAt: string; requestedAt?: string | undefined;
}

type Mask = (s: string) => MaskResult;

export class SyncService {
  readonly state: Record<SourceId, SourceState>;
  reviews: ReviewItem[] = [];
  queue: QueueItem[] = [];
  daily: DailySummary | undefined;
  blockers: OpenBlocker[] = [];
  private running: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly gh: GitHubClient | undefined;
  private readonly discord: DiscordClient | undefined;
  private readonly prs: PrsRepo;
  private readonly typeRules;

  constructor(private readonly cfg: Config, private readonly store: PainelStore, private readonly mask: Mask, private readonly log: FastifyBaseLogger) {
    this.gh = cfg.github.org ? new GitHubClient({ token: cfg.github.token, login: cfg.github.login }) : undefined;
    this.discord = cfg.discord.token ? new DiscordClient(cfg.discord.token, cfg.discord.guildId) : undefined;
    this.prs = new PrsRepo(store);
    this.typeRules = parseTypeOrder(cfg.queueTypeOrder);
    this.state = {
      github: { configured: !!this.gh, running: false },
      discord: { configured: !!this.discord && !!cfg.discord.dailyChannelId && cfg.discord.team.length > 0, running: false },
      // Sem a lista do time o sync traria PRs de outros times (que eu só reviso): fica desligado.
      prs: { configured: !!this.gh && store.configured && cfg.github.team.length > 0, running: false },
    };
  }

  private m = (s: string) => this.mask(s).text;

  start(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), this.cfg.limits.pollIntervalMin * 60_000);
  }
  stop(): void { clearInterval(this.timer); }

  /** Executa uma sincronização (ou espera a que já está rodando). */
  run(): Promise<void> {
    this.running ??= (async () => {
      try {
        await Promise.all([
          this.step('github', () => this.syncGitHub()),
          this.step('discord', () => this.syncDiscord()),
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
      s.error = this.m((e as Error).message ?? 'erro');
      this.log.warn({ source: id, error: s.error }, 'falha na sincronização');
    } finally { s.running = false; }
  }

  // ---------- GitHub: reviews e fila ----------
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
    this.queue = sortQueue([...githubQueue, ...this.queue.filter(q => q.source === 'discord')]);
  }

  // ---------- Discord: daily, bloqueios, menções ----------
  private async syncDiscord(): Promise<void> {
    const d = this.discord!;
    const cfg = this.cfg.discord;
    const now = Date.now();
    const team = cfg.team;
    const toDaily = (m: DiscordMessage): DailyMessage => ({
      id: m.id, authorId: m.author.id, content: this.m(m.content), timestamp: m.timestamp, url: d.messageUrl(m.channel_id, m.id),
    });

    const dailyMsgs = (await d.messagesSince(cfg.dailyChannelId!, now - 10 * 86_400_000)).map(toDaily);
    this.daily = summarizeDaily(dailyMsgs, team, now, this.cfg.team.tzOffsetMin);

    const channelMsgs: Array<ChannelMessage & { raw: DiscordMessage }> = [];
    for (const ch of cfg.watchChannels) {
      const msgs = await d.messagesSince(ch.id, now - 7 * 86_400_000, 500);
      channelMsgs.push(...msgs.map(m => ({ ...toDaily(m), channel: ch.label, raw: m })));
    }
    this.blockers = mergeBlockers(
      blockersFromDailies(dailyMsgs, team, now, this.cfg.team.tzOffsetMin),
      blockersFromChannels(channelMsgs, team, now),
    );

    // Menções a mim (usuário ou cargos) ainda sem resposta minha.
    const myId = cfg.myUserId;
    const roles = new Set(cfg.myRoleIds);
    const discordQueue: QueueItem[] = [];
    if (myId) {
      const repliedTo = new Set(channelMsgs.filter(m => m.raw.author.id === myId).map(m => m.raw.message_reference?.message_id).filter(Boolean));
      for (const m of channelMsgs) {
        const r = m.raw;
        if (r.author.id === myId) continue;
        const mentionsMe = r.mentions.some(x => x.id === myId) || r.mention_roles.some(x => roles.has(x));
        if (!mentionsMe) continue;
        const answered = repliedTo.has(r.id) || channelMsgs.some(x => x.raw.author.id === myId && x.channel === m.channel && Date.parse(x.timestamp) > Date.parse(m.timestamp));
        const firstLine = m.content.split(/\r?\n/).find(l => l.trim())?.replace(/<@[!&]?\d+>/g, '').trim() ?? '';
        discordQueue.push({
          key: `dc:${r.channel_id}:${r.id}`, source: 'discord', kind: 'message', type: m.channel,
          rank: typeRank(this.typeRules, m.channel), title: firstLine.slice(0, 160) || '(sem texto)', url: m.url ?? '',
          labels: [m.channel], author: r.author.global_name ?? r.author.username, createdAt: r.timestamp, updatedAt: r.timestamp,
          reasons: ['mentioned'], answered,
        });
      }
    }
    this.queue = sortQueue([...this.queue.filter(q => q.source === 'github'), ...discordQueue]);
  }

  // ---------- PRs do time → painel_prs ----------
  private async syncPrs(): Promise<void> {
    await this.store.connect();
    const gh = this.gh!;
    const org = this.cfg.github.org!;
    const since = new Date(Date.now() - this.cfg.prsLookbackDays * 86_400_000).toISOString().slice(0, 10);
    const names = new Map(this.cfg.github.team.map(t => [t.login.toLowerCase(), t.name]));
    const prs = await fetchTeamPrs(gh, org, this.cfg.github.team.map(t => t.login), since);

    const groups = new Map<string, SyncedGroup>();
    for (const pr of prs) {
      const status = deriveStatus({ state: pr.state, reviewDecision: pr.reviewDecision, reviewCount: pr.reviews.totalCount });
      const issue = boardIssueOf(pr, org, this.cfg.github.boardRepo);
      const owner = names.get(pr.author?.login?.toLowerCase() ?? '') ?? pr.author?.login ?? '?';
      const key = issue?.url ?? pr.url;
      const g = groups.get(key) ?? { key, title: this.m(issue?.title ?? pr.title), reference: issue?.url, owner, prs: [] };
      g.prs.push({
        url: pr.url, title: this.m(pr.title), owner, status: status ?? 'review_queue',
        state: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
        repo: pr.repository.nameWithOwner, number: pr.number, base: pr.baseRefName, isDraft: pr.isDraft,
        additions: pr.additions, deletions: pr.deletions, mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
      });
      groups.set(key, g);
    }
    for (const g of groups.values()) await this.prs.upsertGroup(g);
  }
}
