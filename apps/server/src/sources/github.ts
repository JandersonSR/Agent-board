// GitHub via GraphQL. Token: GITHUB_TOKEN ou `gh auth token` (nunca logado nem devolvido à tela).
// Toda resposta é validada com Zod antes de ser usada.
import { z } from 'zod';
import { execCmd } from '../util/exec.js';

const GQL_URL = 'https://api.github.com/graphql';

export class GitHubClient {
  private token: string | undefined;
  private login: string | undefined;

  constructor(private readonly opts: { token?: string | undefined; login?: string | undefined }) {
    this.token = opts.token;
    this.login = opts.login;
  }

  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    const r = await execCmd('gh', ['auth', 'token'], { timeoutMs: 15_000 });
    const t = r.stdout.trim();
    if (!r.ok || !t) throw new Error('GitHub sem token: defina GITHUB_TOKEN ou rode gh auth login');
    this.token = t;
    return t;
  }

  /** REST (para o que o GraphQL não cobre, ex.: criar review PENDING). Resposta validada com Zod. */
  async rest<T>(method: 'GET' | 'POST', pathname: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const res = await fetch(`https://api.github.com${pathname}`, {
      method,
      headers: {
        Authorization: `bearer ${await this.getToken()}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'tldeck-local',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string; errors?: Array<{ message?: string } | string> };
    if (!res.ok) {
      const detail = data.errors?.map(e => (typeof e === 'string' ? e : e.message)).filter(Boolean).join('; ');
      throw Object.assign(new Error(`GitHub ${res.status}: ${data.message ?? 'erro'}${detail ? ` (${detail})` : ''}`), { statusCode: res.status === 422 ? 409 : 502 });
    }
    return schema.parse(data);
  }

  async graphql<T>(query: string, variables: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: { Authorization: `bearer ${await this.getToken()}`, 'Content-Type': 'application/json', 'User-Agent': 'tldeck-local' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) { this.token = this.opts.token; throw new Error('GitHub recusou o token (401)'); }
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    const body = (await res.json()) as { data?: unknown; errors?: Array<{ message: string }> };
    if (body.errors?.length && !body.data) throw new Error(`GitHub: ${body.errors[0]!.message}`);
    return schema.parse(body.data);
  }

  async viewerLogin(): Promise<string> {
    if (this.login) return this.login;
    const d = await this.graphql('query{viewer{login}}', {}, z.object({ viewer: z.object({ login: z.string() }) }));
    this.login = d.viewer.login;
    return this.login;
  }
}

// ---------- Schemas ----------
const Repo = z.object({ nameWithOwner: z.string() });
const Actor = z.object({ login: z.string() }).nullable();
const Labels = z.object({ nodes: z.array(z.object({ name: z.string() })) });
const LastComment = z.object({ nodes: z.array(z.object({ author: Actor, createdAt: z.string() })) });

export const IssueNode = z.object({
  __typename: z.literal('Issue'),
  id: z.string(), number: z.number(), title: z.string(), url: z.string(),
  createdAt: z.string(), updatedAt: z.string(),
  issueType: z.object({ name: z.string() }).nullable().optional(),
  labels: Labels, repository: Repo, author: Actor, comments: LastComment,
});
export const PullNode = z.object({
  __typename: z.literal('PullRequest'),
  id: z.string(), number: z.number(), title: z.string(), url: z.string(),
  createdAt: z.string(), updatedAt: z.string(),
  isDraft: z.boolean(), additions: z.number(), deletions: z.number(), changedFiles: z.number(),
  labels: Labels, repository: Repo, author: Actor, comments: LastComment,
  baseRefName: z.string(),
});
const SearchNode = z.union([IssueNode, PullNode, z.object({ __typename: z.string() }).passthrough()]);
const Search = <T extends z.ZodTypeAny>(node: T) => z.object({
  search: z.object({ issueCount: z.number(), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }), nodes: z.array(node) }),
});

export type IssueNodeT = z.infer<typeof IssueNode>;
export type PullNodeT = z.infer<typeof PullNode>;

const ITEM_FIELDS = `
  __typename
  ... on Issue { id number title url createdAt updatedAt issueType { name } labels(first: 10) { nodes { name } }
    repository { nameWithOwner } author { login } comments(last: 1) { nodes { author { login } createdAt } } }
  ... on PullRequest { id number title url createdAt updatedAt isDraft additions deletions changedFiles baseRefName
    labels(first: 10) { nodes { name } } repository { nameWithOwner } author { login } comments(last: 1) { nodes { author { login } createdAt } } }`;

async function searchAll<T extends z.ZodTypeAny>(gh: GitHubClient, q: string, fields: string, node: T, maxPages = 3): Promise<Array<z.infer<T>>> {
  const query = `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 50, after: $after) {
    issueCount pageInfo { hasNextPage endCursor } nodes { ${fields} } } }`;
  const out: Array<z.infer<T>> = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const d: { search: { nodes: Array<z.infer<T>>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await gh.graphql(query, { q, after }, Search(node));
    out.push(...d.search.nodes);
    if (!d.search.pageInfo.hasNextPage) break;
    after = d.search.pageInfo.endCursor;
  }
  return out;
}

/** Itens abertos atribuídos a mim (exceto PRs que eu mesmo abri) ou que me mencionam. */
export async function fetchMyItems(gh: GitHubClient, org: string) {
  const [assigned, mentioned] = await Promise.all([
    searchAll(gh, `org:${org} is:open archived:false assignee:@me -author:@me`, ITEM_FIELDS, SearchNode),
    searchAll(gh, `org:${org} is:open archived:false mentions:@me`, ITEM_FIELDS, SearchNode),
  ]);
  const pick = (n: unknown) => {
    const i = IssueNode.safeParse(n); if (i.success) return i.data;
    const p = PullNode.safeParse(n); if (p.success) return p.data;
    return null;
  };
  const map = new Map<string, { node: IssueNodeT | PullNodeT; reasons: Set<'assigned' | 'mentioned'> }>();
  for (const [list, reason] of [[assigned, 'assigned'], [mentioned, 'mentioned']] as const) {
    for (const raw of list) {
      const node = pick(raw);
      if (!node) continue;
      const cur = map.get(node.id) ?? { node, reasons: new Set() };
      cur.reasons.add(reason);
      map.set(node.id, cur);
    }
  }
  return [...map.values()].map(v => ({ node: v.node, reasons: [...v.reasons] }));
}

// ---------- Reviews pedidos a mim ----------
const ReviewNode = z.object({
  __typename: z.literal('PullRequest'),
  id: z.string(), number: z.number(), title: z.string(), url: z.string(), isDraft: z.boolean(),
  createdAt: z.string(), additions: z.number(), deletions: z.number(), changedFiles: z.number(),
  baseRefName: z.string(), repository: Repo, author: Actor,
  timelineItems: z.object({ nodes: z.array(z.object({
    createdAt: z.string().optional(),
    requestedReviewer: z.object({ login: z.string().optional(), name: z.string().optional() }).nullable().optional(),
  })) }),
});
export type ReviewNodeT = z.infer<typeof ReviewNode>;

export async function fetchReviewRequests(gh: GitHubClient, org: string) {
  const fields = `__typename ... on PullRequest { id number title url isDraft createdAt additions deletions changedFiles baseRefName
    repository { nameWithOwner } author { login }
    timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 20) { nodes { ... on ReviewRequestedEvent { createdAt
      requestedReviewer { ... on User { login } ... on Team { name } } } } } }`;
  const raw = await searchAll(gh, `org:${org} is:pr is:open archived:false review-requested:@me`, fields, z.unknown());
  return raw.map(r => ReviewNode.safeParse(r)).filter(r => r.success).map(r => r.data!);
}

// ---------- PRs para o acompanhamento de deploy ----------
/** Campos de PR usados no deploy: estado, decisão de review e datas para detectar re-review. */
export const PR_FRAGMENT = `fragment DeployPr on PullRequest {
  id number title url body state isDraft createdAt updatedAt mergedAt baseRefName headRefName reviewDecision
  additions deletions author { login } repository { nameWithOwner }
  reviews(last: 30) { totalCount nodes { state submittedAt author { login } } }
  labels(first: 10) { nodes { name } }
  commits(last: 1) { nodes { commit { committedDate } } }
  timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 1) { nodes { ... on ReviewRequestedEvent { createdAt } } }
  closingIssuesReferences(first: 5) { nodes { number title url repository { nameWithOwner } } }
}`;

export const DeployPrNode = z.object({
  id: z.string(), number: z.number(), title: z.string(), url: z.string(), body: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']), isDraft: z.boolean(),
  createdAt: z.string(), updatedAt: z.string(), mergedAt: z.string().nullable(),
  baseRefName: z.string(), headRefName: z.string(),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  additions: z.number(), deletions: z.number(),
  author: Actor, repository: Repo,
  reviews: z.object({ totalCount: z.number(), nodes: z.array(z.object({ state: z.string(), submittedAt: z.string().nullable(), author: Actor.optional() })) }),
  labels: Labels.optional(),
  commits: z.object({ nodes: z.array(z.object({ commit: z.object({ committedDate: z.string() }) })) }),
  timelineItems: z.object({ nodes: z.array(z.object({ createdAt: z.string().optional() })) }),
  closingIssuesReferences: z.object({ nodes: z.array(z.object({ number: z.number(), title: z.string(), url: z.string(), repository: Repo })) }),
});
export type DeployPrNodeT = z.infer<typeof DeployPrNode>;
export type TeamPrNodeT = DeployPrNodeT;

/** Datas usadas para detectar re-review. */
export function reviewTimes(pr: DeployPrNodeT) {
  const rc = pr.reviews.nodes.filter(r => r.state === 'CHANGES_REQUESTED' && r.submittedAt).map(r => r.submittedAt!).sort().pop();
  return {
    lastChangesRequestedAt: rc ?? null,
    lastCommitAt: pr.commits.nodes[0]?.commit.committedDate ?? null,
    lastReviewRequestedAt: pr.timelineItems.nodes[pr.timelineItems.nodes.length - 1]?.createdAt ?? null,
  };
}

const PageSchema = z.object({ search: z.object({ pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }), nodes: z.array(z.unknown()) }) });

/** Busca PRs (com os campos de deploy) por uma consulta de search do GitHub. */
async function searchDeployPrs(gh: GitHubClient, q: string, maxPages = 4): Promise<DeployPrNodeT[]> {
  const query = `${PR_FRAGMENT}
query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 50, after: $after) {
  pageInfo { hasNextPage endCursor } nodes { __typename ...DeployPr } } }`;
  const out: DeployPrNodeT[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const d: z.infer<typeof PageSchema> = await gh.graphql(query, { q, after }, PageSchema);
    for (const n of d.search.nodes) { const p = DeployPrNode.safeParse(n); if (p.success) out.push(p.data); }
    if (!d.search.pageInfo.hasNextPage) break;
    after = d.search.pageInfo.endCursor;
  }
  return out;
}

export async function fetchTeamPrs(gh: GitHubClient, org: string, logins: string[], sinceDay: string) {
  if (!logins.length) return [];
  const who = logins.map(l => `author:${l}`).join(' ');
  return searchDeployPrs(gh, `org:${org} is:pr archived:false updated:>=${sinceDay} ${who}`);
}

/** PRs abertos e atualizados recentemente para as branches de deploy: é assim que uma entrega vira "deploy". */
export async function fetchOpenDeployPrs(gh: GitHubClient, org: string, bases: string[], sinceDay: string): Promise<DeployPrNodeT[]> {
  const out = new Map<string, DeployPrNodeT>();
  for (const base of bases) {
    for (const pr of await searchDeployPrs(gh, `org:${org} is:pr is:open archived:false base:${base} updated:>=${sinceDay}`, 2)) out.set(pr.url, pr);
  }
  return [...out.values()];
}

// ---------- Issues: PRs ligados e campos do Project ----------
const FIELD_VALUES = `fieldValues(first: 30) { nodes { __typename
  ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
  ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
  ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } } } }`;
const PROJECT_FIELDS = `projectItems(first: 10) { nodes { project { number title } ${FIELD_VALUES} } }`;

const FieldValue = z.object({
  __typename: z.string().optional(),
  date: z.string().nullable().optional(), name: z.string().nullable().optional(), text: z.string().nullable().optional(),
  field: z.object({ name: z.string().optional() }).nullable().optional(),
}).passthrough();
const ProjectItems = z.object({ nodes: z.array(z.object({
  project: z.object({ number: z.number(), title: z.string() }).nullable().optional(),
  fieldValues: z.object({ nodes: z.array(FieldValue) }),
})) });

export interface ProjectField { project?: number | undefined; field: string; date?: string | undefined; text?: string | undefined }

function toField(v: z.infer<typeof FieldValue>, project?: number): ProjectField | undefined {
  const field = v.field?.name;
  if (!field) return undefined;
  return { project, field, date: v.date ?? undefined, text: v.text ?? v.name ?? undefined };
}

function flattenFields(items: z.infer<typeof ProjectItems> | undefined): ProjectField[] {
  const out: ProjectField[] = [];
  for (const it of items?.nodes ?? []) {
    for (const v of it.fieldValues.nodes) { const f = toField(v, it.project?.number); if (f) out.push(f); }
  }
  return out;
}

const IssueWithLinks = z.object({
  number: z.number(), title: z.string(), url: z.string(), state: z.enum(['OPEN', 'CLOSED']),
  closedByPullRequestsReferences: z.object({ nodes: z.array(z.unknown()) }).optional(),
  timelineItems: z.object({ nodes: z.array(z.object({ __typename: z.string(), source: z.unknown().optional(), subject: z.unknown().optional() }).passthrough()) }),
  projectItems: ProjectItems.optional(),
});

export interface IssueLinks { url: string; number: number; title: string; state: 'OPEN' | 'CLOSED'; prs: DeployPrNodeT[]; projectFields: ProjectField[] }

export class MissingProjectScope extends Error {}
const isScopeError = (e: unknown) => /read:project|INSUFFICIENT_SCOPES/i.test((e as Error)?.message ?? '');

/** Parse de "https://github.com/org/repo/issues/123" ou "org/repo#123". */
export function parseIssueRef(ref: string): { owner: string; repo: string; number: number } | undefined {
  const m = ref.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/i) ?? ref.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : undefined;
}

/**
 * Para cada issue: PRs que a fecham, PRs ligados (connected) e PRs que a citam (cross-reference),
 * de qualquer autor/repo da org. Em lotes de 5 por consulta; se o GitHub recusar o lote (502/timeout
 * em consultas pesadas), o lote é dividido ao meio até uma issue por vez. Com withProject, traz os
 * campos do Project.
 */
export async function fetchIssueLinks(gh: GitHubClient, refs: string[], withProject: boolean): Promise<IssueLinks[]> {
  // Índice global no alias: lotes divididos não colidem ao juntar os resultados.
  const parsed = refs.flatMap(r => { const p = parseIssueRef(r); return p ? [p] : []; }).map((p, idx) => ({ ...p, idx }));
  const out: IssueLinks[] = [];

  const runBatch = async (batch: typeof parsed): Promise<Record<string, { issue?: unknown } | null>> => {
    const body = batch.map(p => `i${p.idx}: repository(owner: ${JSON.stringify(p.owner)}, name: ${JSON.stringify(p.repo)}) { issue(number: ${p.number}) {
      number title url state
      closedByPullRequestsReferences(first: 20, includeClosedPrs: true) { nodes { ...DeployPr } }
      timelineItems(itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT], first: 60) { nodes { __typename
        ... on CrossReferencedEvent { source { __typename ...DeployPr } }
        ... on ConnectedEvent { subject { __typename ...DeployPr } } } }
      ${withProject ? PROJECT_FIELDS : ''}
    } }`).join('\n');
    try {
      return await gh.graphql(`${PR_FRAGMENT}\nquery {\n${body}\n}`, {}, z.record(z.string(), z.object({ issue: z.unknown() }).nullable()));
    } catch (e) {
      if (withProject && isScopeError(e)) throw new MissingProjectScope('token sem escopo read:project');
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        return { ...(await runBatch(batch.slice(0, mid))), ...(await runBatch(batch.slice(mid))) };
      }
      throw e;
    }
  };

  for (let i = 0; i < parsed.length; i += 5) {
    const data = await runBatch(parsed.slice(i, i + 5));
    for (const v of Object.values(data)) {
      const issue = IssueWithLinks.safeParse(v?.issue);
      if (!issue.success) continue;
      const prs = new Map<string, DeployPrNodeT>();
      const add = (n: unknown) => { const p = DeployPrNode.safeParse(n); if (p.success) prs.set(p.data.url, p.data); };
      issue.data.closedByPullRequestsReferences?.nodes.forEach(add);
      for (const t of issue.data.timelineItems.nodes) add(t.source ?? t.subject);
      out.push({
        url: issue.data.url, number: issue.data.number, title: issue.data.title, state: issue.data.state,
        prs: [...prs.values()], projectFields: flattenFields(issue.data.projectItems),
      });
    }
  }
  return out;
}

const ProjectPage = z.object({ organization: z.object({ projectV2: z.object({ items: z.object({
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  nodes: z.array(z.object({
    content: z.object({ __typename: z.string(), number: z.number().optional(), title: z.string().optional(), url: z.string().optional(), state: z.string().optional() }).nullable(),
    fieldValues: z.object({ nodes: z.array(FieldValue) }),
  })),
}) }).nullable() }) });

/** Issues de um Project da org com seus campos (para descobrir as que têm data de deploy). */
export async function fetchProjectIssues(gh: GitHubClient, org: string, projectNumber: number, maxPages = 30) {
  const query = `query($org: String!, $n: Int!, $after: String) { organization(login: $org) { projectV2(number: $n) {
    items(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes {
      content { __typename ... on Issue { number title url state } }
      ${FIELD_VALUES} } } } } }`;
  const out: Array<{ url: string; title: string; state: string; fields: ProjectField[] }> = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    let d: z.infer<typeof ProjectPage>;
    try { d = await gh.graphql(query, { org, n: projectNumber, after }, ProjectPage); }
    catch (e) { if (isScopeError(e)) throw new MissingProjectScope('token sem escopo read:project'); throw e; }
    const items = d.organization.projectV2?.items;
    if (!items) break;
    for (const n of items.nodes) {
      if (n.content?.__typename !== 'Issue' || !n.content.url) continue;
      out.push({
        url: n.content.url, title: n.content.title ?? '', state: n.content.state ?? 'OPEN',
        fields: n.fieldValues.nodes.flatMap(v => { const f = toField(v, projectNumber); return f ? [f] : []; }),
      });
    }
    if (!items.pageInfo.hasNextPage) break;
    after = items.pageInfo.endCursor;
  }
  return out;
}

/** Issue do board referenciada pelo PR (closing refs ou link/ref no corpo). */
export function boardIssueOf(pr: TeamPrNodeT, org: string, boardRepo: string | undefined): { url: string; number: number; title?: string } | undefined {
  const closing = pr.closingIssuesReferences.nodes;
  const fromBoard = boardRepo ? closing.find(c => c.repository.nameWithOwner.toLowerCase() === `${org}/${boardRepo}`.toLowerCase()) : undefined;
  const ref = fromBoard ?? closing[0];
  if (ref) return { url: ref.url, number: ref.number, title: ref.title };
  if (!boardRepo) return undefined;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const urlRe = new RegExp(`github\\.com/${esc(org)}/${esc(boardRepo)}/issues/(\\d+)`, 'i');
  const refRe = new RegExp(`\\b${esc(org)}/${esc(boardRepo)}#(\\d+)`, 'i');
  const n = pr.body.match(urlRe)?.[1] ?? pr.body.match(refRe)?.[1] ?? pr.title.match(urlRe)?.[1];
  return n ? { url: `https://github.com/${org}/${boardRepo}/issues/${n}`, number: Number(n) } : undefined;
}

// ---------- Pessoas: times da org (filtro por time na tela) ----------
const TeamsPage = z.object({ organization: z.object({ teams: z.object({
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  nodes: z.array(z.object({ slug: z.string(), name: z.string(), members: z.object({ nodes: z.array(z.object({ login: z.string() })) }) })),
}) }).nullable() });

/** Times da org com membros (até 100 por time). Exige read:org (já presente no token do gh). */
export async function fetchOrgTeams(gh: GitHubClient, org: string): Promise<Array<{ slug: string; name: string; members: string[] }>> {
  const query = `query($org: String!, $after: String) { organization(login: $org) { teams(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor } nodes { slug name members(first: 100) { nodes { login } } } } } }`;
  const out: Array<{ slug: string; name: string; members: string[] }> = [];
  let after: string | null = null;
  for (let page = 0; page < 4; page++) {
    const d: z.infer<typeof TeamsPage> = await gh.graphql(query, { org, after }, TeamsPage);
    const teams = d.organization?.teams;
    if (!teams) break;
    for (const t of teams.nodes) out.push({ slug: t.slug, name: t.name, members: t.members.nodes.map(m => m.login) });
    if (!teams.pageInfo.hasNextPage) break;
    after = teams.pageInfo.endCursor;
  }
  return out;
}
