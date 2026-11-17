// Visão de Staff: DORA, concentração de conhecimento, incidentes/postmortems, decisões do time e produto.
// Tudo fica nas coleções próprias do painel; textos livres passam pelo mascaramento antes de gravar.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { reposToScan, scanRepoAdrs } from '../domain/adr-scan.js';
import { DECISION_KINDS, DECISION_STATUSES, decisionAlerts, OPEN_DECISION, type Decision } from '../domain/decisions.js';
import { computeDora } from '../domain/dora.js';
import {
  INCIDENT_STATUSES, incidentAlerts, POSTMORTEM_STATUSES, postmortemMarkdown, SEVERITIES, type Incident,
} from '../domain/incidents.js';
import {
  computeInitiative, findCycle, INITIATIVE_STATUSES, RISK_LEVELS, STAGE_STATUSES, type Initiative,
} from '../domain/initiatives.js';
import { computeKnowledge, type KnowledgePr } from '../domain/knowledge.js';
import { DocRepo, isId, maskFields } from '../store/doc-repo.js';
import type { PainelStore } from '../store/mongo.js';
import { PrsRepo } from '../store/prs-repo.js';
import type { InfraService } from '../infra/service.js';

type Mask = (s: string) => { text: string; total: number };

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Url = z.string().trim().url().max(400).refine(u => /^https?:\/\//i.test(u), 'só http(s)');
const Text = (max: number) => z.string().trim().max(max);
const Name = z.string().trim().min(1).max(80);
const IdParams = z.object({ id: z.string().refine(isId, 'id inválido') });
const DaysQuery = (def: number) => z.object({ days: z.coerce.number().int().min(7).max(365).default(def) });

// ---------- Incidentes ----------
const IncidentFields = z.object({
  title: Text(200).min(1),
  severity: z.enum(SEVERITIES),
  status: z.enum(INCIDENT_STATUSES),
  startedAt: z.coerce.date(),
  detectedAt: z.coerce.date().nullable(),
  mitigatedAt: z.coerce.date().nullable(),
  resolvedAt: z.coerce.date().nullable(),
  impact: Text(4000),
  services: z.array(Name).max(20),
  causeChanges: z.array(Url).max(20),
  fixChanges: z.array(Url).max(20),
  timeline: z.array(z.object({ at: z.coerce.date(), text: Text(1000).min(1) })).max(200),
  actions: z.array(z.object({
    id: z.string().min(1).max(40), text: Text(500).min(1), owner: Name.optional(), due: Day.optional(),
    done: z.boolean(), doneAt: z.coerce.date().optional(),
  })).max(100),
  postmortem: z.object({
    status: z.enum(POSTMORTEM_STATUSES), url: Url.optional(),
    whatHappened: Text(8000).optional(), rootCause: Text(8000).optional(), wentWell: Text(8000).optional(),
    wentWrong: Text(8000).optional(), lessons: Text(8000).optional(),
  }),
}).strict();
const IncidentCreate = IncidentFields.partial().required({ title: true, severity: true, startedAt: true });
const IncidentPatch = IncidentFields.partial();
type IncidentInput = z.infer<typeof IncidentPatch>;

function maskIncident(x: IncidentInput, m: (s: string) => string): IncidentInput {
  const out: IncidentInput = maskFields(x, ['title', 'impact', 'services'], m);
  if (x.timeline) out.timeline = x.timeline.map(e => ({ ...e, text: m(e.text) }));
  if (x.actions) out.actions = x.actions.map(a => maskFields(a, ['text', 'owner'], m));
  if (x.postmortem) out.postmortem = maskFields(x.postmortem, ['whatHappened', 'rootCause', 'wentWell', 'wentWrong', 'lessons'], m);
  return out;
}

/** Preenche horários óbvios: resolvido sem fim ganha agora; ação concluída ganha a data. */
function stampIncident(x: IncidentInput, prev: Partial<Incident> | null, now: Date): IncidentInput {
  const out = { ...x };
  const status = x.status ?? prev?.status;
  if (status === 'resolved' && x.resolvedAt === undefined && !prev?.resolvedAt) out.resolvedAt = now;
  if ((status === 'mitigated' || status === 'resolved') && x.mitigatedAt === undefined && !prev?.mitigatedAt) out.mitigatedAt = out.resolvedAt ?? now;
  if (x.actions) {
    out.actions = x.actions.map(a => {
      if (a.done) return a.doneAt ? a : { ...a, doneAt: now };
      const { doneAt: _drop, ...rest } = a;
      return rest;
    });
  }
  return out;
}

// ---------- Decisões ----------
const DecisionFields = z.object({
  title: Text(300).min(1),
  kind: z.enum(DECISION_KINDS),
  status: z.enum(DECISION_STATUSES),
  owner: Name.optional(),
  deciders: z.array(Name).max(20),
  url: Url.optional(),
  context: Text(4000).optional(),
  decision: Text(4000).optional(),
  decideBy: Day.optional(),
  decidedAt: Day.optional(),
}).strict();
const DecisionCreate = DecisionFields.partial().required({ title: true });
const DecisionPatch = DecisionFields.partial();

// ---------- Produto ----------
const StageId = z.string().trim().min(1).max(40).regex(/^[\w-]+$/);
const InitiativeFields = z.object({
  name: Text(120).min(1),
  goal: Text(2000).optional(),
  status: z.enum(INITIATIVE_STATUSES),
  targetDate: Day.optional(),
  stages: z.array(z.object({
    id: StageId, name: Text(120).min(1), owners: z.array(Name).max(10).default([]),
    status: z.enum(STAGE_STATUSES).default('not_started'), dependsOn: z.array(StageId).max(20).default([]),
    issues: z.array(z.string().trim().min(1).max(300)).max(200).default([]), query: Text(120).optional(),
    targetDate: Day.optional(), notes: Text(2000).optional(),
    risks: z.array(z.object({ text: Text(500).min(1), level: z.enum(RISK_LEVELS), mitigation: Text(500).optional() })).max(30).default([]),
  })).max(30).superRefine((stages, ctx) => {
    const ids = stages.map(s => s.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) ctx.addIssue({ code: 'custom', message: `etapa repetida: ${dup}` });
    for (const s of stages) {
      for (const d of s.dependsOn) {
        if (d === s.id || !ids.includes(d)) ctx.addIssue({ code: 'custom', message: `dependência inválida em ${s.id}: ${d}` });
      }
    }
    const cycle = findCycle(stages);
    if (cycle) ctx.addIssue({ code: 'custom', message: `dependência circular: ${cycle.join(' → ')}` });
  }),
}).strict();
const InitiativeCreate = InitiativeFields.partial().required({ name: true });
const InitiativePatch = InitiativeFields.partial();
type InitiativeInput = z.infer<typeof InitiativePatch>;

function maskInitiative(x: InitiativeInput, m: (s: string) => string): InitiativeInput {
  const out: InitiativeInput = maskFields(x, ['name', 'goal'], m);
  if (x.stages) {
    out.stages = x.stages.map(s => ({
      ...maskFields(s, ['name', 'owners', 'query', 'notes'], m),
      risks: s.risks.map(r => maskFields(r, ['text', 'mitigation'], m)),
    }));
  }
  return out;
}

const localToday = (tzOffsetMin: number) => new Date(Date.now() + tzOffsetMin * 60_000).toISOString().slice(0, 10);

export async function staffRoutes(app: FastifyInstance, opts: { config: Config; store: PainelStore; mask: Mask; infra?: InfraService }): Promise<void> {
  const { config, store } = opts;
  const m = (s: string) => opts.mask(s).text;
  const prs = new PrsRepo(store);
  const incidents = new DocRepo<Incident>(store, 'painel_incidentes');
  const decisions = new DocRepo<Decision>(store, 'painel_decisoes');
  const initiatives = new DocRepo<Initiative>(store, 'painel_iniciativas');
  const tz = config.team.tzOffsetMin;
  const out = <T extends { _id: unknown }>(d: T) => ({ ...d, _id: String(d._id) });
  const ready = async () => { if (!store.configured) return false; await store.connect(); return true; };
  const notFound = { error: 'não encontrado' };

  // ---- Métricas ----
  app.get('/api/dora', async (req) => {
    const { days } = DaysQuery(90).parse(req.query);
    const empty = computeDora([], [], { days, tzOffsetMin: tz, failureRe: config.dora.failureRe });
    if (!(await ready())) return { configured: false, ...empty };
    const since = new Date(Date.now() - days * 86_400_000);
    const [issues, incs, realDeploys] = await Promise.all([
      prs.listForDora(new Date(since.getTime() + tz * 60_000).toISOString().slice(0, 10)),
      incidents.list({ $or: [{ startedAt: { $gte: since } }, { resolvedAt: { $gte: since } }, { status: { $ne: 'resolved' } }] } as never, { startedAt: -1 }, 2000),
      opts.infra?.productionDeploys(since.getTime()) ?? Promise.resolve([]),
    ]);
    return {
      configured: true, failureRe: config.dora.failureRe,
      ...computeDora(issues.map(i => ({ ...i, prs: i.prs ?? [] })), incs, { days, tzOffsetMin: tz, failureRe: config.dora.failureRe, realDeploys }),
    };
  });

  app.get('/api/knowledge', async (req) => {
    const { days } = DaysQuery(90).parse(req.query);
    if (!(await ready())) return { configured: false, ...computeKnowledge([], days) };
    const docs = await prs.listForKnowledge(new Date(Date.now() - days * 86_400_000));
    const list: KnowledgePr[] = docs.flatMap(d => (d.prs ?? []).map(p => ({
      url: p.url, repo: p.repo, owner: p.owner, state: p.state, mergedAt: p.mergedAt, reviewers: p.reviewers,
    })));
    return { configured: true, ...computeKnowledge(list, days) };
  });

  // ---- Incidentes ----
  app.get('/api/incidents', async () => {
    if (!(await ready())) return { configured: false, items: [], alerts: incidentAlerts([], localToday(tz)) };
    const items = await incidents.list({}, { startedAt: -1 }, 300);
    return { configured: true, items: items.map(out), alerts: incidentAlerts(items, localToday(tz)) };
  });

  app.post('/api/incidents', async (req, reply) => {
    const body = IncidentCreate.parse(req.body);
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    const now = new Date();
    const doc = stampIncident(maskIncident(body, m), null, now);
    const id = await incidents.create({
      status: 'open', services: [], causeChanges: [], fixChanges: [], timeline: [], actions: [], postmortem: { status: 'pending' },
      ...doc, createdAt: now, updatedAt: now,
    } as Incident);
    return { id };
  });

  app.patch('/api/incidents/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const body = IncidentPatch.parse(req.body);
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    const prev = await incidents.get(id);
    if (!prev) return reply.code(404).send(notFound);
    const doc = await incidents.update(id, { ...stampIncident(maskIncident(body, m), prev, new Date()), updatedAt: new Date() } as Partial<Incident>);
    return out(doc!);
  });

  app.delete('/api/incidents/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    return (await incidents.remove(id)) ? { ok: true } : reply.code(404).send(notFound);
  });

  app.get('/api/incidents/:id/postmortem.md', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const { lang } = z.object({ lang: z.enum(['pt-BR', 'en']).default('pt-BR') }).parse(req.query);
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    const doc = await incidents.get(id);
    if (!doc) return reply.code(404).send(notFound);
    return reply.type('text/markdown; charset=utf-8').send(postmortemMarkdown(doc, lang, tz));
  });

  // ---- Decisões ----
  app.get('/api/decisions', async () => {
    if (!(await ready())) return { configured: false, items: [], alerts: decisionAlerts([], localToday(tz)) };
    const items = await decisions.list({}, { updatedAt: -1 }, 1000);
    return { configured: true, items: items.map(out), alerts: decisionAlerts(items, localToday(tz)) };
  });

  app.post('/api/decisions', async (req, reply) => {
    const body = DecisionCreate.parse(req.body);
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    const now = new Date();
    const status = body.status ?? 'proposed';
    const id = await decisions.create({
      kind: 'design_doc', deciders: [], ...maskFields(body, ['title', 'owner', 'deciders', 'context', 'decision'], m), status,
      ...(status === 'decided' && !body.decidedAt ? { decidedAt: localToday(tz) } : {}),
      source: 'manual', createdAt: now, updatedAt: now,
    } as Decision);
    return { id };
  });

  app.patch('/api/decisions/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const body = DecisionPatch.parse(req.body);
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    const prev = await decisions.get(id);
    if (!prev) return reply.code(404).send(notFound);
    // ADR importado: título e status vêm do arquivo; o resto (dono, prazo, contexto) é editável.
    const fields = prev.source === 'repo' ? { ...body, title: undefined, status: undefined } : body;
    const set: Partial<Decision> = { ...maskFields(fields, ['title', 'owner', 'deciders', 'context', 'decision'], m), updatedAt: new Date() };
    for (const k of Object.keys(set) as Array<keyof Decision>) if (set[k] === undefined) delete set[k];
    if (set.status === 'decided' && !prev.decidedAt && !set.decidedAt) set.decidedAt = localToday(tz);
    return out((await decisions.update(id, set))!);
  });

  app.delete('/api/decisions/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    return (await decisions.remove(id)) ? { ok: true } : reply.code(404).send(notFound);
  });

  // Importa (ou atualiza) os ADRs dos clones locais. Só lê arquivos; nada é escrito nos repositórios.
  app.post('/api/decisions/import', async (_req, reply) => {
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    const repos = reposToScan(config.paths.repos, config.paths.reposRoot);
    const now = new Date();
    let added = 0; let updated = 0; let files = 0;
    for (const r of repos) {
      for (const adr of scanRepoAdrs(r.slug, r.path)) {
        files++;
        const res = await decisions.col.updateOne(
          { source: 'repo', repo: adr.repo, path: adr.path },
          {
            $set: { title: m(adr.title), status: adr.status, ...(adr.date ? { date: adr.date } : {}), updatedAt: now },
            $setOnInsert: { kind: 'adr', source: 'repo', repo: adr.repo, path: adr.path, deciders: [], createdAt: now },
          },
          { upsert: true },
        );
        if (res.upsertedCount) added++; else if (res.modifiedCount) updated++;
      }
    }
    return { repos: repos.length, files, added, updated };
  });

  // ---- Produto ----
  app.get('/api/initiatives', async () => {
    if (!(await ready())) return { configured: false, items: [] };
    const [items, tracked] = await Promise.all([initiatives.list({}, { status: 1, updatedAt: -1 }, 50), prs.listLite()]);
    const today = localToday(tz);
    return { configured: true, today, items: items.map(i => ({ ...out(i), view: computeInitiative(i, tracked, today) })) };
  });

  app.post('/api/initiatives', async (req, reply) => {
    const body = InitiativeCreate.parse(req.body);
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    const now = new Date();
    const id = await initiatives.create({ status: 'active', stages: [], ...maskInitiative(body, m), createdAt: now, updatedAt: now } as Initiative);
    return { id };
  });

  app.patch('/api/initiatives/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const body = InitiativePatch.parse(req.body);
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    const doc = await initiatives.update(id, { ...maskInitiative(body, m), updatedAt: new Date() } as Partial<Initiative>);
    return doc ? out(doc) : reply.code(404).send(notFound);
  });

  app.delete('/api/initiatives/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!(await ready())) return reply.code(503).send({ error: 'MongoDB não configurado' });
    return (await initiatives.remove(id)) ? { ok: true } : reply.code(404).send(notFound);
  });

  // ---- Resumo para a tela Hoje ----
  app.get('/api/staff/alerts', async () => {
    if (!(await ready())) return { configured: false };
    const today = localToday(tz);
    const [incs, decs, inits, tracked] = await Promise.all([
      incidents.list({ $or: [{ status: { $ne: 'resolved' } }, { 'actions.done': false }, { 'postmortem.status': { $in: ['pending', 'draft'] } }] } as never, { startedAt: -1 }, 300),
      decisions.list({ status: { $in: [...OPEN_DECISION] } } as never, { updatedAt: -1 }, 1000),
      initiatives.list({ status: 'active' } as never, { updatedAt: -1 }, 20),
      prs.listLite(),
    ]);
    return {
      configured: true,
      incidents: incidentAlerts(incs, today),
      decisions: decisionAlerts(decs, today),
      initiatives: inits.map(i => {
        const v = computeInitiative(i, tracked, today);
        return { _id: String(i._id), name: i.name, progress: v.progress, late: v.late, blocked: v.blocked, highRisks: v.highRisks };
      }),
      ...(opts.infra?.configured ? { infra: opts.infra.view().summary } : {}),
    };
  });
}
