// Issue trackers besides GitHub (Jira, Linear), read-only. Each adapter answers two questions:
// what is assigned to me (the queue), and the state/title/deploy date of given issue keys (deploy tracking,
// where PRs that mention the key in the title, branch or body are grouped under the issue).
import { z } from 'zod';
import { HttpError, postJson, type Fetcher } from '../util/http.js';

export type TrackerProvider = 'jira' | 'linear';

export interface TrackerIssue {
  provider: TrackerProvider;
  key: string;
  url: string;
  title: string;
  type?: string | undefined;
  status: string;
  done: boolean;
  priority?: string | undefined;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  /** YYYY-MM-DD, from the configured field (Jira) or the due date (Linear), when enabled. */
  deployDate?: string | undefined;
}

export interface TrackerSource {
  readonly provider: TrackerProvider;
  readonly label: string;
  /** Issue key prefixes used to find keys in PRs (Jira project keys, Linear team keys). */
  readonly prefixes: string[];
  myQueue(): Promise<TrackerIssue[]>;
  issues(keys: string[]): Promise<TrackerIssue[]>;
  /** Whether a URL points at this tracker. */
  owns(url: string): boolean;
}

/** Keys with the given prefixes ("ABC-123"), unique, in order of appearance. */
export function findKeys(text: string, prefixes: string[]): string[] {
  if (!prefixes.length) return [];
  const re = new RegExp(`\\b(?:${prefixes.map(p => p.replace(/[^A-Za-z0-9]/g, '')).join('|')})-\\d+\\b`, 'gi');
  return [...new Set([...text.matchAll(re)].map(m => m[0].toUpperCase()))];
}

const day = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v : undefined;
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
};

// ---------- Jira Cloud (REST v3, API token) ----------
const JiraIssue = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string().default(''),
    issuetype: z.object({ name: z.string() }).nullish(),
    status: z.object({ name: z.string(), statusCategory: z.object({ key: z.string() }).nullish() }).nullish(),
    priority: z.object({ name: z.string() }).nullish(),
    labels: z.array(z.string()).nullish(),
    created: z.string().nullish(),
    updated: z.string().nullish(),
  }).passthrough(),
});
const JiraSearch = z.object({ issues: z.array(JiraIssue).default([]), nextPageToken: z.string().nullish(), isLast: z.boolean().nullish() });

export interface JiraOptions {
  baseUrl: string; email: string; token: string;
  /** JQL for "my queue". */
  jql?: string | undefined;
  /** Custom field id holding the deploy date (e.g. customfield_10050). */
  deployDateField?: string | undefined;
  projectKeys: string[];
  fetcher?: Fetcher | undefined;
}

export const DEFAULT_JIRA_JQL = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';

export function jiraTracker(opts: JiraOptions): TrackerSource {
  const fetcher = opts.fetcher ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const auth = { Authorization: `Basic ${Buffer.from(`${opts.email}:${opts.token}`).toString('base64')}` };
  const fields = ['summary', 'issuetype', 'status', 'priority', 'labels', 'created', 'updated', ...(opts.deployDateField ? [opts.deployDateField] : [])];
  const toIssue = (i: z.infer<typeof JiraIssue>): TrackerIssue => ({
    provider: 'jira', key: i.key, url: `${base}/browse/${i.key}`, title: i.fields.summary, type: i.fields.issuetype?.name,
    status: i.fields.status?.name ?? '', done: i.fields.status?.statusCategory?.key === 'done', priority: i.fields.priority?.name,
    labels: i.fields.labels ?? [], createdAt: i.fields.created ?? '', updatedAt: i.fields.updated ?? i.fields.created ?? '',
    deployDate: opts.deployDateField ? day((i.fields as Record<string, unknown>)[opts.deployDateField]) : undefined,
  });
  async function search(jql: string, max = 200): Promise<TrackerIssue[]> {
    const out: TrackerIssue[] = [];
    let nextPageToken: string | undefined;
    while (out.length < max) {
      const page = await postJson(fetcher, `${base}/rest/api/3/search/jql`, auth, { jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }, JiraSearch);
      out.push(...page.issues.map(toIssue));
      if (page.isLast !== false || !page.nextPageToken) break;
      nextPageToken = page.nextPageToken;
    }
    return out;
  }
  return {
    provider: 'jira', label: 'Jira', prefixes: opts.projectKeys,
    myQueue: () => search(opts.jql || DEFAULT_JIRA_JQL, 100),
    async issues(keys) {
      const valid = keys.filter(k => /^[A-Z][A-Z0-9_]*-\d+$/.test(k));
      const out: TrackerIssue[] = [];
      for (let i = 0; i < valid.length; i += 50) out.push(...await search(`key in (${valid.slice(i, i + 50).join(',')})`));
      return out;
    },
    owns: url => url.startsWith(`${base}/browse/`),
  };
}

// ---------- Linear (GraphQL, personal API key) ----------
const LinearIssue = z.object({
  identifier: z.string(), title: z.string(), url: z.string(), priorityLabel: z.string().nullish(),
  createdAt: z.string(), updatedAt: z.string(), dueDate: z.string().nullish(),
  state: z.object({ name: z.string(), type: z.string() }),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }).nullish(),
});
const FIELDS = 'identifier title url priorityLabel createdAt updatedAt dueDate state { name type } labels(first: 10) { nodes { name } }';
const LinearResponse = z.object({ data: z.record(z.string(), z.unknown()).nullish(), errors: z.array(z.object({ message: z.string() })).optional() });

export interface LinearOptions {
  apiKey: string;
  teamKeys: string[];
  /** Use the issue's due date as the deploy date. */
  dueDateIsDeploy?: boolean | undefined;
  fetcher?: Fetcher | undefined;
}

export function linearTracker(opts: LinearOptions): TrackerSource {
  const fetcher = opts.fetcher ?? fetch;
  const headers = { Authorization: opts.apiKey };
  const toIssue = (i: z.infer<typeof LinearIssue>): TrackerIssue => ({
    provider: 'linear', key: i.identifier, url: i.url, title: i.title, type: i.labels?.nodes[0]?.name, status: i.state.name,
    done: i.state.type === 'completed' || i.state.type === 'canceled', priority: i.priorityLabel ?? undefined,
    labels: (i.labels?.nodes ?? []).map(l => l.name), createdAt: i.createdAt, updatedAt: i.updatedAt,
    deployDate: opts.dueDateIsDeploy ? day(i.dueDate) : undefined,
  });
  async function gql(query: string, allowPartial = false): Promise<Record<string, unknown>> {
    const r = await postJson(fetcher, 'https://api.linear.app/graphql', headers, { query }, LinearResponse);
    if (r.errors?.length && (!allowPartial || !r.data)) {
      const auth = r.errors.some(e => /authenticat|api key/i.test(e.message));
      throw new HttpError(`api.linear.app: ${auth ? 'token without permission or expired' : 'query error'}`, auth ? 401 : undefined);
    }
    return r.data ?? {};
  }
  return {
    provider: 'linear', label: 'Linear', prefixes: opts.teamKeys,
    async myQueue() {
      const d = await gql(`query { viewer { assignedIssues(first: 100, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${FIELDS} } } } }`);
      const nodes = z.object({ viewer: z.object({ assignedIssues: z.object({ nodes: z.array(LinearIssue) }) }) }).parse(d).viewer.assignedIssues.nodes;
      return nodes.map(toIssue);
    },
    async issues(keys) {
      const valid = keys.filter(k => /^[A-Z][A-Z0-9]*-\d+$/.test(k));
      const out: TrackerIssue[] = [];
      for (let i = 0; i < valid.length; i += 25) {
        const batch = valid.slice(i, i + 25);
        // Unknown keys come back as null with an error for that alias; the rest is still read.
        const d = await gql(`query { ${batch.map((k, j) => `i${j}: issue(id: "${k}") { ${FIELDS} }`).join(' ')} }`, true);
        for (const v of Object.values(d)) { const p = LinearIssue.safeParse(v); if (p.success) out.push(toIssue(p.data)); }
      }
      return out;
    },
    owns: url => /^https:\/\/linear\.app\/[^/]+\/issue\//.test(url),
  };
}

/** Key from a tracker URL (".../browse/ABC-1", ".../issue/ENG-12/slug"). */
export const keyFromUrl = (url: string): string | undefined => url.match(/\/(?:browse|issue)\/([A-Z][A-Z0-9_]*-\d+)/i)?.[1]?.toUpperCase();

