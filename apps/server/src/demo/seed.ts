// Demo mode: fictitious data to see the whole deck without configuring anything.
// Everything is made up (company "acme"), with dates relative to now. Nothing leaves the machine.
import { ObjectId } from 'mongodb';
import type { DailySummary, PersonDaily, TeamMember } from '../domain/daily.js';
import type { OpenBlocker } from '../domain/blockers.js';
import { deriveReview } from '../domain/reviews.js';
import type { StatusHistoryEntry } from '../domain/pr-status.js';
import type { DeckStore } from '../store/store.js';
import type { QueueItem, ReviewItem } from '../sync/service.js';

export type DemoLang = 'pt-BR' | 'en';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function demoData(lang: DemoLang, now = Date.now()) {
  const L = (pt: string, en: string) => (lang === 'en' ? en : pt);
  const ago = (ms: number) => new Date(now - ms);
  const iso = (ms: number) => ago(ms).toISOString();
  const day = (d: number) => new Date(now + d * DAY).toISOString().slice(0, 10);
  const gh = (repo: string, kind: 'issues' | 'pull', n: number) => `https://github.com/acme/${repo}/${kind}/${n}`;

  const team: TeamMember[] = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eva', 'Felipe'].map((name, i) => ({ id: `u${i + 1}`, name }));
  const person = (i: number, today: string[], confidence: number | undefined, newBlockers = 0): PersonDaily => ({
    member: team[i]!, posted: confidence !== undefined, postedAt: confidence !== undefined ? iso(HOUR + i * 7 * MIN) : undefined,
    ...(confidence !== undefined ? { parsed: { yesterday: [], today, blockers: [], confidence } as never } : {}),
    lowConfidence: confidence !== undefined && confidence <= 2,
    changes: { newBlockers: Array.from({ length: newBlockers }, () => ({ text: 'x', inferred: false }) as never), resolvedBlockers: [] },
  });
  const people = [
    person(0, [L('Simulação de parcelas: regras de arredondamento', 'Installment simulation: rounding rules')], 4),
    person(1, [L('Migrações do schema de contratos', 'Contracts schema migrations')], 2, 1),
    person(2, [L('Evento "proposta aprovada" no Kafka', '"Proposal approved" event on Kafka')], 4),
    person(3, [L('Testes de integração entre etapas', 'Integration tests across stages')], 3),
    person(4, [L('Pipeline do ambiente de desenvolvimento', 'Dev environment pipeline')], 5),
    person(5, [], undefined),
  ];
  const daily: DailySummary = { day: day(0), people, missing: [team[5]!], lowConfidence: [people[1]!], blockers: [], postedCount: 5 };

  const blockers: OpenBlocker[] = [
    { key: 'b1', member: team[1]!, text: L('Migração falha no ambiente de dev: permissão no schema', 'Migration fails on dev: schema permission'), issue: '412', since: iso(95 * MIN), ageMs: 95 * MIN, source: 'daily', inferred: false },
    { key: 'b2', member: team[3]!, text: L('Aguardando contrato do evento de parcelas', 'Waiting on the installments event contract'), dependsOn: 'Carla', since: iso(30 * MIN), ageMs: 30 * MIN, source: 'channel', channel: 'loans-squad', inferred: true },
  ];

  const q = (key: string, type: string, rank: number, title: string, repo: string | undefined, num: number | undefined, reasons: string[], mins: number, answered = true, source: 'github' | 'chat' | 'jira' = 'github', label?: string): QueueItem => ({
    key, source, kind: source === 'chat' ? 'message' : 'issue', type, rank, title,
    url: repo && num ? gh(repo, 'issues', num) : source === 'jira' ? `https://acme.atlassian.net/browse/${label}` : 'https://discord.com',
    ...(source === 'chat' ? { origin: `Discord · ${label}` } : source === 'jira' ? { origin: `Jira · ${label}` } : {}),
    repo: source === 'github' ? `acme/${repo}` : undefined, number: num, labels: label ? [label] : [],
    createdAt: iso(mins * MIN), updatedAt: iso((mins / 2) * MIN), reasons, answered,
  } as QueueItem);
  const queue = [
    q('q1', 'Bug', 1, L('Parcela com centavo a mais no último vencimento', 'Last installment is off by one cent'), 'loans-api', 431, ['assigned'], 140),
    q('q2', 'Ticket', 0, L('Cliente não recebe o contrato por e-mail', 'Customer does not get the contract by email'), 'notifications', 87, ['mentioned'], 50, false),
    q('q3', L('Ajuste', 'Fix'), 2, L('Ajustar limite de simulação por produto', 'Adjust simulation limit per product'), 'loans-api', 425, ['assigned'], 600),
    q('q4', L('Tarefa', 'Task'), 3, L('Revisar a RFC do outbox de eventos', 'Review the event outbox RFC'), 'architecture', 19, ['assigned', 'mentioned'], 1500),
    q('q5', 'Ticket', 0, L('Dúvida do suporte sobre quitação antecipada', 'Support question about early payoff'), undefined, undefined, ['mentioned'], 20, false, 'chat', L('suporte', 'support')),
    q('q6', 'Story', 4, L('Cliente acompanha a proposta pelo app', 'Customer follows the proposal in the app'), undefined, undefined, ['assigned'], 2900, false, 'jira', 'LOAN-214'),
  ];

  const r = (key: string, title: string, repo: string, num: number, author: string, add: number, del: number, daysWaiting: number, draft = false): ReviewItem =>
    deriveReview({ key, title, url: gh(repo, 'pull', num), repo: `acme/${repo}`, number: num, author, isDraft: draft, additions: add, deletions: del, changedFiles: 6, base: 'develop', createdAt: iso(daysWaiting * DAY + HOUR) }, now) as ReviewItem;
  const reviews = [
    r('r1', L('Simulação: arredondamento por parcela', 'Simulation: per-installment rounding'), 'loans-api', 440, 'ana', 182, 40, 2),
    r('r2', L('Schema de contratos e migração inicial', 'Contracts schema and first migration'), 'loans-api', 438, 'bruno', 512, 12, 1),
    r('r3', L('Evento proposta-aprovada via outbox', 'Proposal-approved event through the outbox'), 'loans-api', 441, 'carla', 96, 8, 0),
    r('r4', L('Pipeline de deploy no ambiente de dev', 'Deploy pipeline for dev'), 'platform', 73, 'eva', 64, 30, 0, true),
  ];

  return { L, ago, iso, day, gh, team, daily, blockers, queue, reviews };
}

/** A PR's status history: queue → review → (changes) → merge. */
function history(start: Date, steps: Array<[StatusHistoryEntry['status'], number]>, now: number): StatusHistoryEntry[] {
  const out: StatusHistoryEntry[] = [];
  let t = start.getTime();
  for (const [status, dur] of steps) {
    const leftAt = dur > 0 && t + dur < now ? new Date(t + dur) : null;
    out.push({ status, enteredAt: new Date(t), leftAt });
    if (!leftAt) break;
    t += dur;
  }
  return out;
}

/** Writes the sample data to the deck's database (only if it is still empty). */
export async function seedDemo(store: DeckStore, lang: DemoLang, now = Date.now()): Promise<boolean> {
  await store.connect();
  const prsCol = store.collection('deck_prs');
  if (await prsCol.countDocuments({})) return false;
  const { L, ago, day, gh } = demoData(lang, now);

  // ---- Deliveries (PRs and deploys) for flow, DORA and knowledge ----
  const people = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eva'];
  const repos = ['loans-api', 'loans-api', 'loans-api', 'web', 'platform'];
  const titles = [
    L('Simulação de parcelas', 'Installment simulation'), L('Taxa por produto', 'Rate per product'), L('Cadastro e KYC', 'Onboarding and KYC'),
    L('Proposta e análise', 'Proposal and review'), L('Relatório de inadimplência', 'Delinquency report'), L('Hotfix: parcela com centavo a mais', 'Hotfix: installment off by one cent'),
    L('Webhook de pagamento', 'Payment webhook'), L('Tela de contrato', 'Contract screen'), L('Cache de taxas', 'Rate cache'),
  ];
  type SeedIssue = { _id: ObjectId; key: string; deployDate?: string; prs: Array<{ url: string }> } & Record<string, unknown>;
  const docs: SeedIssue[] = [];
  for (let i = 0; i < 26; i++) {
    const merged = i < 22;
    const startedDaysAgo = merged ? 4 + i * 2.6 : 1 + (i - 22);
    const start = ago(startedDaysAgo * 86_400_000);
    const author = people[i % people.length]!;
    const repo = repos[i % repos.length]!;
    const rcs = i % 3 === 0;
    const steps: Array<[StatusHistoryEntry['status'], number]> = merged
      ? [['review_queue', (3 + (i % 5) * 4) * 3_600_000], ['reviewing', 10 * 3_600_000], ...(rcs ? [['rcs', 20 * 3_600_000] as [StatusHistoryEntry['status'], number], ['re_review', 6 * 3_600_000] as [StatusHistoryEntry['status'], number]] : []), ['waiting_approves', 8 * 3_600_000], ['merged', 0]]
      : [['review_queue', 0]];
    const statusHistory = history(start, steps, now);
    const mergedAt = merged ? statusHistory[statusHistory.length - 1]!.enteredAt : null;
    const hotfix = i === 5 || i === 14;
    const title = hotfix ? titles[5]! : `${titles[i % titles.length]!}${i > 8 ? ` (${i})` : ''}`;
    const reviewers = repo === 'loans-api' ? ['Janderson', ...(i % 4 === 0 ? ['Ana'] : [])] : repo === 'web' ? ['Bruno', 'Carla'] : ['Felipe'];
    const status = merged ? 'merged' : 'review_queue';
    const pr = {
      url: gh(repo, 'pull', 300 + i), title, owner: author, author: author.toLowerCase(), status, derivedStatus: status, statusOverride: null,
      state: merged ? 'merged' : 'open', repo: `acme/${repo}`, number: 300 + i, base: 'develop', isDraft: false,
      additions: 40 + ((i * 53) % 500), deletions: 5 + ((i * 17) % 80), mergedAt, head: hotfix ? 'hotfix/installment' : `feat/item-${i}`, labels: hotfix ? ['hotfix'] : [],
      reviewers: merged ? reviewers.filter(rv => rv !== author) : undefined, statusHistory, source: 'auto', createdAt: start, updatedAt: mergedAt ?? start,
    };
    docs.push({
      _id: new ObjectId(), key: gh(repo, 'issues', 200 + i), reference: gh(repo, 'issues', 200 + i), title, owner: author,
      team: repo === 'platform' ? 'platform' : 'loans', status, mergedAt,
      ...(merged ? { deployDate: new Date(mergedAt!.getTime() + (1 + (i % 3)) * 86_400_000).toISOString().slice(0, 10), deployDateSource: 'project' } : {}),
      prs: [pr], statusHistory, source: 'auto', createdAt: start, updatedAt: mergedAt ?? start, syncedAt: new Date(now),
    });
  }
  // future deploys do not count yet
  for (const d of docs) if (d.deployDate && d.deployDate > day(0)) d.deployDate = day(0);
  await prsCol.insertMany(docs);

  // ---- Incidentes ----
  const causeIssue = docs[3]!.key;
  await store.collection('deck_incidents').insertMany([
    {
      title: L('Simulação fora do ar após deploy', 'Simulation down after deploy'), severity: 'sev2', status: 'resolved',
      startedAt: ago(9 * 86_400_000), detectedAt: ago(9 * 86_400_000 - 10 * 60_000), mitigatedAt: ago(9 * 86_400_000 - 90 * 60_000), resolvedAt: ago(9 * 86_400_000 - 2 * 3_600_000),
      impact: L('Clientes sem conseguir simular por 2 h (~300 tentativas)', 'Customers could not simulate for 2 h (~300 attempts)'), services: ['loans-api'],
      causeChanges: [causeIssue], fixChanges: [docs[5]!.prs[0]!.url],
      timeline: [
        { at: ago(9 * 86_400_000 - 10 * 60_000), text: L('Alerta de erro 500 na simulação', '500 error alert on simulation') },
        { at: ago(9 * 86_400_000 - 90 * 60_000), text: L('Rollback do deploy', 'Deploy rolled back') },
      ],
      actions: [
        { id: 'a1', text: L('Teste de contrato da migração', 'Contract test for the migration'), owner: 'Bruno', due: day(-2), done: false },
        { id: 'a2', text: L('Alerta de latência na simulação', 'Latency alert on simulation'), owner: 'Eva', due: day(5), done: false },
        { id: 'a3', text: L('Runbook de rollback', 'Rollback runbook'), owner: 'Ana', done: true, doneAt: ago(5 * 86_400_000) },
      ],
      postmortem: { status: 'draft', rootCause: L('A migração criou um índice que travou a tabela de taxas.', 'The migration created an index that locked the rates table.') },
      createdAt: ago(9 * 86_400_000), updatedAt: ago(4 * 86_400_000),
    },
    {
      title: L('Webhook de pagamento duplicado', 'Duplicate payment webhook'), severity: 'sev3', status: 'open', startedAt: ago(5 * 3_600_000),
      services: ['payments'], causeChanges: [], fixChanges: [], timeline: [], actions: [], postmortem: { status: 'pending' },
      createdAt: ago(5 * 3_600_000), updatedAt: ago(5 * 3_600_000),
    },
  ]);

  // ---- Decisions ----
  const dec = (title: string, kind: string, status: string, owner?: string, decideBy?: string, createdDaysAgo = 10) => ({
    title, kind, status, ...(owner ? { owner } : {}), deciders: [], ...(decideBy ? { decideBy } : {}), source: 'manual',
    createdAt: ago(createdDaysAgo * 86_400_000), updatedAt: ago(2 * 86_400_000),
  });
  await store.collection('deck_decisions').insertMany([
    dec(L('Outbox para eventos de proposta', 'Outbox for proposal events'), 'rfc', 'discussing', 'Carla', day(-2)),
    dec(L('Arredondamento bancário nas parcelas', "Banker's rounding for installments"), 'design_doc', 'proposed', 'Ana', day(4)),
    dec(L('Cache de taxas por produto', 'Rate cache per product'), 'design_doc', 'proposed', undefined, undefined, 30),
    { ...dec(L('Kafka para eventos entre serviços', 'Kafka for service events'), 'adr', 'decided', 'Diego'), decidedAt: day(-40) },
  ]);

  // ---- Produto ----
  const issuesOf = (from: number, to: number) => docs.slice(from, to).map(d => d.key);
  await store.collection('deck_initiatives').insertOne({
    name: L('Empréstimo pessoal (produto 1)', 'Personal loan (product 1)'), goal: L('Cliente simula, contrata e recebe o crédito sem falar com ninguém.', 'Customers simulate, sign and receive credit without talking to anyone.'),
    status: 'active', targetDate: day(40), createdAt: ago(60 * 86_400_000), updatedAt: ago(86_400_000),
    stages: [
      { id: 'kyc', name: L('Cadastro e KYC', 'Onboarding and KYC'), owners: ['Ana', 'Diego'], status: 'done', dependsOn: [], issues: issuesOf(14, 20), risks: [] },
      { id: 'sim', name: L('Simulação', 'Simulation'), owners: ['Ana', 'Bruno'], status: 'in_progress', dependsOn: ['kyc'], issues: [...issuesOf(0, 6), ...issuesOf(22, 24)], targetDate: day(6),
        risks: [{ text: L('Regra de IOF por prazo', 'Tax rule by term'), level: 'high', mitigation: L('validar com o jurídico', 'check with legal') }] },
      { id: 'prop', name: L('Proposta e análise', 'Proposal and review'), owners: ['Carla', 'Eva'], status: 'in_progress', dependsOn: ['sim'], issues: [...issuesOf(6, 8), ...issuesOf(24, 26)], targetDate: day(-1), risks: [] },
      { id: 'sign', name: L('Contrato e assinatura', 'Contract and signing'), owners: ['Diego', 'Felipe'], status: 'not_started', dependsOn: ['prop'], issues: [],
        risks: [{ text: L('Fornecedor de assinatura sem sandbox', 'Signing vendor has no sandbox'), level: 'medium' }] },
      { id: 'pay', name: L('Liberação do crédito', 'Credit release'), owners: ['Bruno', 'Eva'], status: 'not_started', dependsOn: ['sign'], issues: [], risks: [] },
    ],
  });

  // ---- Agent runs (a review with judged findings and a finished task) ----
  const finding = (severity: string, path: string, line: number, title: string, body: string) => ({ severity, path, line, title, body });
  const findings = [
    finding('high', 'src/simulation/installments.ts', 88, L('Arredondamento por parcela acumula centavos', 'Per-installment rounding accumulates cents'), L('Some o resíduo na última parcela.', 'Push the remainder into the last installment.')),
    finding('medium', 'src/simulation/rates.ts', 31, L('Taxa lida sem cache', 'Rate read without cache'), L('Cada simulação consulta o banco.', 'Every simulation hits the database.')),
    finding('low', 'src/simulation/index.ts', 12, L('Nome de variável pouco claro', 'Unclear variable name'), '…'),
  ];
  const version = 'r1 · skill demo01 · sonnet';
  await store.collection('deck_runs').insertMany([
    {
      kind: 'review', engine: 'claude', itemKey: 'gh:acme/loans-api#440', title: `loans-api#440 ${L('Simulação: arredondamento por parcela', 'Simulation: per-installment rounding')}`,
      target: { prUrl: gh('loans-api', 'pull', 440), repo: 'acme/loans-api' }, status: 'done', model: 'sonnet', promptMasked: L('(prompt de exemplo)', '(sample prompt)'),
      maskedCount: 0, cwd: '', startedAt: ago(12 * 60_000), endedAt: ago(11 * 60_000), log: [], actions: [], promptVersion: version, promptEdited: false,
      findingDecisions: ['accepted', 'accepted', 'rejected'],
      result: { review: { verdict: 'request_changes', readyForProd: false, confidence: 82, summary: L('Bom caminho; o arredondamento ainda gera diferença na última parcela.', 'Good direction; rounding still creates a gap on the last installment.'), risks: [], blockers: [], findings } },
      usage: { inputTokens: 42000, outputTokens: 3100, cacheReadTokens: 51000, cacheWriteTokens: 0, costUsd: 0.11, durationMs: 38_000, turns: 6 },
    },
    {
      kind: 'task', engine: 'claude', itemKey: 'gh:acme/loans-api#431', title: `loans-api#431 ${L('Parcela com centavo a mais no último vencimento', 'Last installment is off by one cent')}`,
      target: { issueUrl: gh('loans-api', 'issues', 431), repo: 'acme/loans-api' }, status: 'done', model: 'sonnet', promptMasked: L('(prompt de exemplo)', '(sample prompt)'),
      maskedCount: 1, cwd: '', startedAt: ago(25 * 60_000), endedAt: ago(3 * 60_000), promptVersion: 't1', actions: [],
      log: [{ at: ago(20 * 60_000), type: 'tool', text: 'Read src/simulation/installments.ts' }, { at: ago(8 * 60_000), type: 'tool', text: 'Bash npm test' }],
      usage: { inputTokens: 42000, outputTokens: 6100, cacheReadTokens: 90000, cacheWriteTokens: 0, costUsd: 0.47, durationMs: 1_300_000, turns: 31 },
      task: {
        phase: 'ready', issueUrl: gh('loans-api', 'issues', 431), issueTitle: 'x', repo: 'acme/loans-api', repoPath: '../loans-api', worktree: '(demo)',
        branch: 'agent/431-last-installment', base: 'origin/develop', approvedAt: ago(15 * 60_000), notes: L("Mantenha o arredondamento bancário.", "Keep banker's rounding."),
        plan: { summary: L('Distribuir o resíduo na última parcela.', 'Push the remainder into the last installment.'), steps: [L('Calcular em centavos', 'Compute in cents'), L('Última = total − soma', 'Last = total − sum')], files: ['src/simulation/installments.ts'], tests: [L('Caso de 12x que gerava +0,01', '12x case that produced +0.01')], risks: [], questions: [] },
        implementation: { summary: L('Resíduo na última parcela, com teste de regressão.', 'Remainder in the last installment, with a regression test.'), changes: ['installments.ts'], testsRun: ['npm test'], testsPassed: true, followUps: [] },
        verify: { command: 'npm test', ok: true, code: 0, output: 'Tests  212 passed (212)', durationMs: 41_000 },
      },
    },
  ]);

  // ---- Fixed evaluation set ----
  const cases = [
    { _id: new ObjectId(), name: L('Centavo na última parcela', 'Cent on the last installment'), prUrl: gh('loans-api', 'pull', 402), expected: [{ id: 'a', path: 'src/simulation/installments.ts', keywords: [L('arredond', 'round')] }], createdAt: ago(20 * 86_400_000) },
    { _id: new ObjectId(), name: L('Índice que trava a tabela', 'Locking index'), prUrl: gh('loans-api', 'pull', 438), expected: [{ id: 'a', keywords: [L('índice', 'index')] }, { id: 'b', keywords: ['lock'] }], createdAt: ago(20 * 86_400_000) },
  ];
  await store.collection('deck_evals').insertMany(cases);
  const evalRun = (caseId: ObjectId, f: Array<{ title: string; path?: string }>, daysAgo: number, v: string) => ({
    kind: 'review', engine: 'claude', itemKey: 'eval', title: '[eval]', target: {}, status: 'done', model: 'sonnet', promptMasked: '', maskedCount: 0, cwd: '',
    startedAt: ago(daysAgo * 86_400_000), endedAt: ago(daysAgo * 86_400_000), log: [], actions: [], promptVersion: v, evalCaseId: String(caseId),
    result: { review: { verdict: 'comment', readyForProd: false, confidence: 70, summary: '', risks: [], blockers: [], findings: f.map(x => ({ severity: 'high', title: x.title, body: '', path: x.path ?? null, line: null })) } },
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.12, durationMs: 40_000, turns: 4 },
  });
  await store.collection('deck_runs').insertMany([
    evalRun(cases[0]!._id, [{ title: L('Arredondamento errado', 'Wrong rounding'), path: 'src/simulation/installments.ts' }], 1, version),
    evalRun(cases[1]!._id, [{ title: L('Falta índice', 'Missing index') }], 1, version),
    evalRun(cases[0]!._id, [], 8, 'r1 · skill old001 · sonnet'),
    evalRun(cases[1]!._id, [{ title: 'lock' }], 8, 'r1 · skill old001 · sonnet'),
  ]);
  return true;
}
