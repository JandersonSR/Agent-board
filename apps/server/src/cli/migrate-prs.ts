// Migração única: copia a coleção do painel de PRs anterior para painel_prs.
// Lê a origem em modo somente leitura; nunca altera nem apaga nada nela.
// Uso: npm run migrate:prs -w apps/server            (simulação, não grava)
//      npm run migrate:prs -w apps/server -- --apply (grava em painel_prs)
import { loadDotEnv, parseConfig } from '../config.js';
import { STATUSES, type DeployStatus } from '../domain/pr-status.js';
import { createMasker } from '../privacy/mask.js';
import { PainelStore } from '../store/mongo.js';
import { PrsRepo, type TrackedIssue, type TrackedPr } from '../store/prs-repo.js';

loadDotEnv();
const apply = process.argv.includes('--apply');
const config = parseConfig();
const legacy = config.mongo.legacyPr;
if (!legacy) { console.error('Defina MONGO_LEGACY_PR_DATABASE e MONGO_LEGACY_PR_COLLECTION no .env'); process.exit(1); }

const mask = createMasker(config.maskExtraPatterns);
const m = (s: unknown) => mask(String(s ?? '')).text;
const status = (s: unknown): DeployStatus => (STATUSES as readonly string[]).includes(String(s)) ? (s as DeployStatus) : 'review_queue';
const date = (v: unknown) => (v ? new Date(v as string) : undefined);

const store = new PainelStore(config.mongo);
await store.connect();
const repo = new PrsRepo(store);
const source = await store.readLegacyCollection(legacy.db, legacy.collection);
const already = await repo.legacyIds();

const docs: TrackedIssue[] = source.filter(d => !already.has(String(d._id))).map(d => {
  const prs: TrackedPr[] = (Array.isArray(d.prs) ? d.prs : []).map((p: Record<string, unknown>) => ({
    url: String(p.url ?? ''), title: m(p.title), owner: String(p.owner ?? ''), status: status(p.status),
    state: p.status === 'merged' ? 'merged' : 'open', mergedAt: date(p.mergedAt) ?? null,
    statusHistory: p.statusHistory as TrackedPr['statusHistory'], statusStats: p.statusStats as TrackedPr['statusStats'],
    source: 'legacy', createdAt: date(p.createdAt) ?? new Date(), updatedAt: date(p.updatedAt) ?? new Date(),
  }));
  return {
    key: String(d.reference || `legacy:${String(d._id)}`), title: m(d.title), reference: d.reference ? String(d.reference) : undefined,
    owner: String(d.owner ?? ''), team: d.team ? String(d.team) : undefined, deployDate: d.deployDate ? String(d.deployDate) : undefined,
    status: status(d.status), mergedAt: date(d.mergedAt) ?? null, linkGroup: (d.linkGroup as string | null) ?? null,
    deployOrder: (d.deployOrder as number | null) ?? null, prs,
    statusHistory: d.statusHistory as TrackedIssue['statusHistory'], statusStats: d.statusStats as TrackedIssue['statusStats'],
    source: 'legacy', legacyId: String(d._id), createdAt: date(d.createdAt) ?? new Date(), updatedAt: date(d.updatedAt) ?? new Date(),
  };
});

console.log(`origem: ${source.length} documentos · já migrados: ${already.size} · a migrar: ${docs.length}`);
console.log(`por status: ${JSON.stringify(docs.reduce<Record<string, number>>((a, d) => ({ ...a, [d.status]: (a[d.status] ?? 0) + 1 }), {}))}`);
if (!apply) console.log('Simulação: nada foi gravado. Rode com --apply para gravar em painel_prs.');
else console.log(`gravados em painel_prs: ${await repo.insertMany(docs)}`);
await store.close();
