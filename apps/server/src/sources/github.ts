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

  async graphql<T>(query: string, variables: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: { Authorization: `bearer ${await this.getToken()}`, 'Content-Type': 'application/json', 'User-Agent': 'agent-board-local' },
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

// ---------- PRs do time (acompanhamento de deploy) ----------
const TeamPrNode = z.object({
  __typename: z.literal('PullRequest'),
  id: z.string(), number: z.number(), title: z.string(), url: z.string(), body: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']), isDraft: z.boolean(),
  createdAt: z.string(), updatedAt: z.string(), mergedAt: z.string().nullable(),
  baseRefName: z.string(), headRefName: z.string(),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  additions: z.number(), deletions: z.number(),
  author: Actor, repository: Repo,
  reviews: z.object({ totalCount: z.number() }),
  closingIssuesReferences: z.object({ nodes: z.array(z.object({ number: z.number(), title: z.string(), url: z.string(), repository: Repo })) }),
});
export type TeamPrNodeT = z.infer<typeof TeamPrNode>;

export async function fetchTeamPrs(gh: GitHubClient, org: string, logins: string[], sinceDay: string) {
  const fields = `__typename ... on PullRequest { id number title url body state isDraft createdAt updatedAt mergedAt
    baseRefName headRefName reviewDecision additions deletions author { login } repository { nameWithOwner }
    reviews { totalCount } closingIssuesReferences(first: 5) { nodes { number title url repository { nameWithOwner } } } }`;
  if (!logins.length) return [];
  const who = logins.map(l => `author:${l}`).join(' ');
  const raw = await searchAll(gh, `org:${org} is:pr archived:false updated:>=${sinceDay} ${who}`, fields, z.unknown(), 4);
  return raw.map(r => TeamPrNode.safeParse(r)).filter(r => r.success).map(r => r.data!);
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
