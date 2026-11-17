// Knowledge concentration per repository, from who writes and who reviews the merged PRs.
//
// "Bus factor": the smallest number of people who, if they leave, leave more than half
// of the period's PRs with no one who wrote or reviewed them. Greedy approximation: removes first
// whoever took part in the most PRs still covered.
//
// Reviewers only exist for PRs synced after this version; PRs without that information
// count as "unknown reviewers" and not as unreviewed.

type When = Date | string;

export interface KnowledgePr {
  url: string; repo?: string | undefined; owner: string; state: string;
  mergedAt?: When | null | undefined; reviewers?: string[] | undefined;
}

export type KnowledgeRisk = 'high' | 'medium' | 'low';

export interface RepoKnowledge {
  repo: string;
  prs: number;
  busFactor: number;
  risk: KnowledgeRisk;
  /** Few PRs in the period: the number is indicative. */
  lowData: boolean;
  authors: Array<{ name: string; prs: number }>;
  reviewers: Array<{ name: string; prs: number }>;
  topAuthorShare: number | null;
  topReviewerShare: number | null;
  /** PRs merged without any recorded review (only among those with the information). */
  unreviewed: number;
  /** PRs without reviewer information (synced before this version). */
  unknownReviewers: number;
}

export interface PersonKnowledge { name: string; authored: number; reviewed: number; repos: number; soleReviewerOf: string[] }

export interface Knowledge { days: number; repos: RepoKnowledge[]; people: PersonKnowledge[]; prs: number; withReviewerData: number }

export const MIN_PRS = 5;

/** Smallest number of people whose departure leaves > 50% of the PRs with no one who took part. */
export function busFactor(prPeople: Array<Set<string>>): number {
  if (!prPeople.length) return 0;
  const remaining = prPeople.map(s => new Set(s));
  const orphaned = () => remaining.filter(s => s.size === 0).length;
  let removed = 0;
  while (orphaned() * 2 <= prPeople.length) {
    const count = new Map<string, number>();
    for (const s of remaining) for (const p of s) count.set(p, (count.get(p) ?? 0) + 1);
    const top = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!top) break;
    for (const s of remaining) s.delete(top[0]);
    removed++;
  }
  return removed;
}

const ranked = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, prs]) => ({ name, prs }));
const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

export function computeKnowledge(prsIn: KnowledgePr[], days: number, now = Date.now()): Knowledge {
  const since = now - days * 86_400_000;
  const byUrl = new Map<string, KnowledgePr>();
  for (const p of prsIn) {
    const t = p.mergedAt ? new Date(p.mergedAt).getTime() : NaN;
    if (p.state === 'merged' && p.repo && t >= since && t <= now) byUrl.set(p.url, p);
  }
  const prs = [...byUrl.values()];

  const repos = new Map<string, KnowledgePr[]>();
  for (const p of prs) repos.set(p.repo!, [...(repos.get(p.repo!) ?? []), p]);

  const people = new Map<string, { authored: number; reviewed: number; repos: Set<string>; soleReviewerOf: string[] }>();
  const person = (n: string) => {
    let x = people.get(n);
    if (!x) people.set(n, x = { authored: 0, reviewed: 0, repos: new Set(), soleReviewerOf: [] });
    return x;
  };

  const out: RepoKnowledge[] = [];
  for (const [repo, list] of repos) {
    const authors = new Map<string, number>();
    const reviewers = new Map<string, number>();
    let unreviewed = 0;
    let unknown = 0;
    const sets = list.map(p => {
      inc(authors, p.owner);
      person(p.owner).authored++;
      person(p.owner).repos.add(repo);
      const revs = [...new Set((p.reviewers ?? []).filter(r => r && r !== p.owner))];
      if (!p.reviewers) unknown++;
      else if (!revs.length) unreviewed++;
      for (const r of revs) { inc(reviewers, r); person(r).reviewed++; person(r).repos.add(repo); }
      return new Set([p.owner, ...revs]);
    });
    const bf = busFactor(sets);
    const known = list.length - unknown;
    const rv = ranked(reviewers);
    const reviewedCount = known - unreviewed;
    const topReviewerShare = rv[0] && reviewedCount ? rv[0].prs / reviewedCount : null;
    if (rv[0] && reviewedCount >= 3 && topReviewerShare !== null && topReviewerShare >= 0.8) person(rv[0].name).soleReviewerOf.push(repo);
    const au = ranked(authors);
    out.push({
      repo, prs: list.length, busFactor: bf,
      risk: bf <= 1 ? 'high' : bf === 2 ? 'medium' : 'low', lowData: list.length < MIN_PRS,
      authors: au, reviewers: rv, topAuthorShare: au[0] ? au[0].prs / list.length : null, topReviewerShare,
      unreviewed, unknownReviewers: unknown,
    });
  }

  const order: Record<KnowledgeRisk, number> = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => Number(a.lowData) - Number(b.lowData) || order[a.risk] - order[b.risk] || b.prs - a.prs);
  return {
    days, repos: out, prs: prs.length, withReviewerData: prs.filter(p => p.reviewers).length,
    people: [...people.entries()].map(([name, x]) => ({ name, authored: x.authored, reviewed: x.reviewed, repos: x.repos.size, soleReviewerOf: x.soleReviewerOf.sort() }))
      .sort((a, b) => b.soleReviewerOf.length - a.soleReviewerOf.length || (b.authored + b.reviewed) - (a.authored + a.reviewed)),
  };
}
