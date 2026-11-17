// Acompanhamento da infraestrutura em tempo real (só leitura): lê os provedores, guarda o histórico curto
// das métricas, transforma mudanças em eventos (painel_eventos) e aplica a regra de incidente automático.
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { PainelStore } from '../store/mongo.js';
import { azureProvider } from './azure.js';
import { demoInfraProvider } from './demo.js';
import { digitalOceanProvider } from './digitalocean.js';
import { grafanaProvider } from './grafana.js';
import { herokuProvider } from './heroku.js';
import { newTrackerState, step, suspectDeploy, type FiringAlert, type InfraEvent, type TrackerRules } from './tracker.js';
import type { InfraProvider, InfraProviderId, InfraResource, InfraSnapshot } from './types.js';

type Mask = (s: string) => { text: string };
export interface MetricPoint { at: number; cpu?: number | undefined; memory?: number | undefined }
export interface ProviderState { id: InfraProviderId; label: string; ok: boolean | null; lastPoll?: string | undefined; error?: string | undefined }
export interface FiringView extends FiringAlert { incidentId?: string | undefined; suspect?: { title: string; at: string; version?: string | undefined } | undefined }

const HISTORY = 120;
const AUTO_INCIDENTS_PER_HOUR = 5;

export function providersFrom(cfg: Config): InfraProvider[] {
  if (cfg.demo.on) return [demoInfraProvider(Date.now(), cfg.demo.lang)];
  const i = cfg.infra;
  return [
    ...(i.digitalocean ? [digitalOceanProvider(i.digitalocean)] : []),
    ...(i.heroku ? [herokuProvider(i.heroku)] : []),
    ...(i.azure ? [azureProvider(i.azure)] : []),
    ...(i.grafana ? [grafanaProvider(i.grafana)] : []),
  ];
}

export class InfraService {
  private readonly state = newTrackerState();
  private readonly history = new Map<string, MetricPoint[]>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private autoCreated: number[] = [];
  resources: InfraResource[] = [];
  firing: FiringView[] = [];
  readonly providerState: ProviderState[];
  lastPoll: string | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly store: PainelStore,
    private readonly mask: Mask,
    private readonly log: Pick<FastifyBaseLogger, 'warn' | 'error'>,
    readonly providers: InfraProvider[] = providersFrom(cfg),
  ) {
    this.providerState = providers.map(p => ({ id: p.id, label: p.label, ok: null }));
  }

  get configured(): boolean { return this.providers.length > 0; }
  get rules(): TrackerRules { const i = this.cfg.infra; return { cpuWarn: i.cpuWarn, cpuCrit: i.cpuCrit, memCrit: i.memCrit, sustainMin: i.sustainMin, lang: i.lang }; }
  private L(pt: string, en: string): string { return this.cfg.infra.lang === 'en' ? en : pt; }
  private get prodRe(): RegExp { return new RegExp(this.cfg.infra.prodRe, 'i'); }
  private get events() { return this.store.collection('painel_eventos'); }

  start(): void {
    if (!this.configured) return;
    const begin = async () => {
      // No demo, 30 min de histórico para os gráficos e os alertas sustentados aparecerem na hora.
      if (this.cfg.demo.on) for (let k = 30; k >= 1; k--) await this.pollOnce(Date.now() - k * 60_000);
      await this.pollOnce();
    };
    void begin().catch(e => this.log.error({ err: (e as Error).message }, 'falha na primeira leitura da infra'));
    this.timer = setInterval(() => void this.pollOnce().catch(() => undefined), this.cfg.infra.pollSec * 1000);
  }
  stop(): void { clearInterval(this.timer); }

  /** Uma leitura de todos os provedores (a que já estiver rodando é reaproveitada). */
  pollOnce(now = Date.now()): Promise<void> {
    this.running ??= this.doPoll(now).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async doPoll(now: number): Promise<void> {
    const results = await Promise.allSettled(this.providers.map(p => p.poll(now)));
    const merged: InfraSnapshot = { resources: [], alerts: [], deploys: [] };
    const failed = new Set<InfraProviderId>();
    results.forEach((r, i) => {
      const ps = this.providerState[i]!;
      ps.lastPoll = new Date(now).toISOString();
      if (r.status === 'fulfilled') {
        ps.ok = true; ps.error = undefined;
        merged.resources.push(...r.value.resources); merged.alerts.push(...r.value.alerts); merged.deploys.push(...r.value.deploys);
      } else {
        ps.ok = false; ps.error = this.mask((r.reason as Error).message).text;
        failed.add(this.providers[i]!.id);
        this.log.warn({ provider: ps.id, error: ps.error }, 'falha ao ler a infra');
        merged.resources.push(...this.resources.filter(x => x.provider === ps.id)); // mantém o último estado conhecido
      }
    });
    // Textos que vêm de fora passam pelo mascaramento.
    merged.resources = merged.resources.map(r => ({ ...r, name: this.mask(r.name).text, ...(r.statusText ? { statusText: this.mask(r.statusText).text } : {}) }));
    merged.alerts = merged.alerts.map(a => ({ ...a, title: this.mask(a.title).text }));

    for (const r of merged.resources) {
      if (!r.metrics || (r.metrics.cpu === undefined && r.metrics.memory === undefined)) continue;
      const h = this.history.get(r.id) ?? [];
      h.push({ at: now, cpu: r.metrics.cpu, memory: r.metrics.memory });
      this.history.set(r.id, h.slice(-HISTORY));
    }
    const { events, firing } = step(this.state, merged, now, this.rules, failed);
    this.resources = merged.resources;
    this.lastPoll = new Date(now).toISOString();
    if (this.store.configured) await this.persist(events, now).catch(e => this.log.warn({ err: (e as Error).message }, 'falha ao gravar eventos da infra'));
    this.firing = await this.decorate(firing);
  }

  private async recentDeploys(sinceMs: number): Promise<InfraEvent[]> {
    return (await this.events.find({ kind: 'deploy', at: { $gte: new Date(sinceMs).toISOString() } }).sort({ at: -1 }).limit(200).toArray()) as unknown as InfraEvent[];
  }

  private async persist(events: InfraEvent[], now: number): Promise<void> {
    await this.store.connect();
    // Deploys primeiro: um alerta da mesma leitura já encontra o deploy como possível causa.
    const ordered = [...events.filter(e => e.kind === 'deploy'), ...events.filter(e => e.kind !== 'deploy')];
    for (const e of ordered) {
      const doc: Record<string, unknown> = { ...e, createdAt: new Date(now) };
      if (e.kind === 'alert_fired') {
        const deploys = await this.recentDeploys(Date.parse(e.at) - 2 * 3_600_000);
        const s = suspectDeploy({ resourceId: e.resourceId, resourceName: e.resourceName, startedAt: e.at }, deploys);
        if (s) doc.suspect = { title: s.title, at: s.at, version: s.deploy?.version };
        const incidentId = await this.maybeOpenIncident(e, doc.suspect as FiringView['suspect'], now);
        if (incidentId) doc.incidentId = incidentId;
      }
      if (e.kind === 'alert_resolved') await this.mitigateIncident(e, now);
      await this.events.updateOne({ key: e.key }, { $setOnInsert: doc }, { upsert: true });
    }
  }

  /** Regra: alerta crítico de produção abre um incidente SEV2 (no máximo 5 por hora). */
  private async maybeOpenIncident(e: InfraEvent, suspect: FiringView['suspect'], now: number): Promise<string | undefined> {
    if (this.cfg.infra.autoIncident !== 'critical' || e.severity !== 'critical') return undefined;
    if (!this.prodRe.test(`${e.resourceName ?? ''} ${e.title}`)) return undefined;
    this.autoCreated = this.autoCreated.filter(t => now - t < 3_600_000);
    if (this.autoCreated.length >= AUTO_INCIDENTS_PER_HOUR) return undefined;
    const incidents = this.store.collection('painel_incidentes');
    const open = await incidents.findOne({ alertFingerprint: e.fingerprint, status: { $ne: 'resolved' } });
    if (open) return String(open._id);
    const timeline = [{ at: new Date(e.at), text: this.L(`Alerta disparado (${e.provider}): ${e.title}`, `Alert fired (${e.provider}): ${e.title}`) }];
    if (suspect) timeline.unshift({ at: new Date(suspect.at), text: this.L(`${suspect.title}: possível causa (até 60 min antes do alerta)`, `${suspect.title}: possible cause (within 60 min before the alert)`) });
    const r = await incidents.insertOne({
      title: e.title, severity: 'sev2', status: 'open', startedAt: new Date(e.at), detectedAt: new Date(now), mitigatedAt: null, resolvedAt: null,
      impact: '', services: e.resourceName ? [e.resourceName] : [], causeChanges: [], fixChanges: [], timeline, actions: [],
      postmortem: { status: 'pending' }, source: 'infra', alertFingerprint: e.fingerprint, createdAt: new Date(now), updatedAt: new Date(now),
    });
    this.autoCreated.push(now);
    return String(r.insertedId);
  }

  /** Alerta resolvido marca a mitigação do incidente aberto por ele (resolver continua com a pessoa). */
  private async mitigateIncident(e: InfraEvent, now: number): Promise<void> {
    const incidents = this.store.collection('painel_incidentes');
    const inc = await incidents.findOne({ alertFingerprint: e.fingerprint, status: 'open' });
    if (!inc) return;
    const mins = e.durationMs ? Math.round(e.durationMs / 60_000) : undefined;
    await incidents.updateOne({ _id: inc._id }, {
      $set: { status: 'mitigated', mitigatedAt: new Date(now), updatedAt: new Date(now) },
      $push: { timeline: { at: new Date(now), text: this.L(`Alerta resolvido${mins !== undefined ? ` após ${mins} min` : ''}`, `Alert resolved${mins !== undefined ? ` after ${mins} min` : ''}`) } },
    } as never);
  }

  private async decorate(firing: FiringAlert[]): Promise<FiringView[]> {
    if (!this.store.configured || !firing.length) return firing;
    const fps = firing.map(f => f.fingerprint);
    const docs = (await this.events.find({ kind: 'alert_fired', fingerprint: { $in: fps } }).sort({ at: -1 }).limit(500).toArray()) as unknown as Array<InfraEvent & { incidentId?: string; suspect?: FiringView['suspect'] }>;
    return firing.map(f => {
      const d = docs.find(x => x.fingerprint === f.fingerprint);
      return { ...f, ...(d?.incidentId ? { incidentId: d.incidentId } : {}), ...(d?.suspect ? { suspect: d.suspect } : {}) };
    });
  }

  view() {
    const isProd = (n: string) => this.prodRe.test(n);
    return {
      configured: this.configured, demo: this.cfg.demo.on, pollSec: this.cfg.infra.pollSec, lastPoll: this.lastPoll,
      rules: { ...this.rules, autoIncident: this.cfg.infra.autoIncident },
      providers: this.providerState,
      resources: this.resources.map(r => ({ ...r, production: isProd(r.name), history: (this.history.get(r.id) ?? []).slice(-60) }))
        .sort((a, b) => rank(a.status) - rank(b.status) || Number(b.production) - Number(a.production) || a.name.localeCompare(b.name)),
      firing: this.firing,
      summary: {
        ok: this.resources.filter(r => r.status === 'ok').length, warn: this.resources.filter(r => r.status === 'warn').length,
        down: this.resources.filter(r => r.status === 'down').length, critical: this.firing.filter(f => f.severity === 'critical').length,
        warning: this.firing.filter(f => f.severity === 'warning').length,
      },
    };
  }

  async recentEvents(days: number, limit = 200) {
    if (!this.store.configured) return [];
    await this.store.connect();
    return (await this.events.find({ at: { $gte: new Date(Date.now() - days * 86_400_000).toISOString() } }).sort({ at: -1 }).limit(limit).toArray())
      .map(d => ({ ...d, _id: String(d._id) }));
  }

  /** Deploys bem-sucedidos de produção no período (para o DORA). */
  async productionDeploys(sinceMs: number): Promise<Array<{ at: string; resource: string }>> {
    if (!this.store.configured) return [];
    await this.store.connect();
    const docs = await this.recentDeploys(sinceMs);
    return docs.filter(d => d.deploy?.status === 'succeeded' && this.prodRe.test(d.resourceName ?? '')).map(d => ({ at: d.at, resource: d.resourceName ?? '' }));
  }

  /** Abre um incidente a partir de um alerta, por clique (mesmo fora da regra automática). */
  async openIncidentFor(fingerprint: string): Promise<string> {
    const f = this.firing.find(x => x.fingerprint === fingerprint);
    if (!f) throw Object.assign(new Error(this.L('alerta não está mais disparado', 'alert is no longer firing')), { statusCode: 404 });
    if (f.incidentId) return f.incidentId;
    await this.store.connect();
    const r = await this.store.collection('painel_incidentes').insertOne({
      title: f.title, severity: f.severity === 'critical' ? 'sev2' : 'sev3', status: 'open', startedAt: new Date(f.startedAt), detectedAt: new Date(f.firstSeenAt),
      mitigatedAt: null, resolvedAt: null, impact: '', services: f.resourceName ? [f.resourceName] : [], causeChanges: [], fixChanges: [],
      timeline: [{ at: new Date(f.startedAt), text: this.L(`Alerta disparado (${f.provider}): ${f.title}`, `Alert fired (${f.provider}): ${f.title}`) }, ...(f.suspect ? [{ at: new Date(f.suspect.at), text: this.L(`${f.suspect.title}: possível causa`, `${f.suspect.title}: possible cause`) }] : [])],
      actions: [], postmortem: { status: 'pending' }, source: 'infra', alertFingerprint: f.fingerprint, createdAt: new Date(), updatedAt: new Date(),
    });
    const id = String(r.insertedId);
    await this.events.updateMany({ kind: 'alert_fired', fingerprint: fingerprint }, { $set: { incidentId: id } });
    f.incidentId = id;
    return id;
  }
}

const rank = (s: InfraResource['status']) => (s === 'down' ? 0 : s === 'warn' ? 1 : s === 'unknown' ? 2 : 3);
