// Armazenamento do painel restrito às coleções PRÓPRIAS (prefixo painel_).
// Padrão: arquivo SQLite local (sqlite-store.ts), sem servidor. Com MONGO_URI: MongoDB.
// Regra do projeto: nada é escrito fora desta lista; coleções da empresa só são lidas
// pela migração única (readLegacyCollection, só MongoDB), que nunca escreve.
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import type { Config } from '../config.js';
import { SqliteDatabase } from './sqlite-store.js';

export const OWN_COLLECTIONS = [
  'painel_resumos', 'painel_sessoes', 'painel_prs',
  'painel_incidentes', 'painel_decisoes', 'painel_iniciativas', 'painel_avaliacoes', 'painel_eventos',
] as const;
export type OwnCollection = (typeof OWN_COLLECTIONS)[number];

export function assertOwnCollection(name: string): asserts name is OwnCollection {
  if (!(OWN_COLLECTIONS as readonly string[]).includes(name)) {
    throw new Error(`coleção não permitida: ${name} (só ${OWN_COLLECTIONS.join(', ')})`);
  }
}

export type MongoStatus =
  | { state: 'not_configured' }
  | { state: 'connecting' }
  | { state: 'connected'; db: string; kind?: 'sqlite' | 'mongo' }
  | { state: 'error'; message: string };

export class PainelStore {
  private client: MongoClient | undefined;
  private db: Db | undefined;
  private connecting: Promise<void> | undefined;
  private sqlite: SqliteDatabase | undefined;
  status: MongoStatus;
  readonly kind: 'sqlite' | 'mongo' | 'none';

  constructor(private readonly cfg: Config['mongo']) {
    this.kind = cfg.storage ?? (cfg.uri ? 'mongo' : 'none');
    if (this.kind === 'mongo' && !cfg.uri) this.kind = 'none';
    this.status = this.kind === 'none' ? { state: 'not_configured' } : { state: 'connecting' };
  }

  get configured(): boolean { return this.kind !== 'none'; }

  async connect(): Promise<void> {
    if (this.kind === 'none') return;
    if (this.kind === 'sqlite') {
      if (this.sqlite) return;
      try {
        this.sqlite = new SqliteDatabase(this.cfg.sqliteFile ?? ':memory:');
        this.status = { state: 'connected', db: this.cfg.sqliteFile ?? ':memory:', kind: 'sqlite' };
      } catch (e) {
        this.status = { state: 'error', message: (e as Error).message.split('\n')[0]! };
        throw e;
      }
      return;
    }
    if (this.db) return;
    this.connecting ??= (async () => {
      try {
        this.status = { state: 'connecting' };
        const client = new MongoClient(this.cfg.uri!, { serverSelectionTimeoutMS: 10_000, appName: 'lead-deck' });
        await client.connect();
        this.client = client;
        this.db = this.cfg.dbName ? client.db(this.cfg.dbName) : client.db();
        await this.ensureIndexes();
        this.status = { state: 'connected', db: this.db.databaseName, kind: 'mongo' };
      } catch (e) {
        // A mensagem do driver pode conter o host do cluster; mantemos só o tipo/código.
        const err = e as { codeName?: string; name?: string };
        this.status = { state: 'error', message: err.codeName ?? err.name ?? 'falha de conexão' };
        this.connecting = undefined;
        throw e;
      }
    })();
    return this.connecting;
  }

  collection<T extends Document = Document>(name: OwnCollection): Collection<T> {
    assertOwnCollection(name);
    // O SQLite implementa o mesmo subconjunto da API que os repositórios usam.
    if (this.sqlite) return this.sqlite.collection(name) as unknown as Collection<T>;
    if (!this.db) throw Object.assign(new Error('MongoDB não conectado'), { statusCode: 503 });
    return this.db.collection<T>(name);
  }

  private async ensureIndexes(): Promise<void> {
    // Índices apenas nas coleções próprias. Nunca nas da empresa.
    await Promise.all([
      this.collection('painel_resumos').createIndexes([
        { key: { itemKey: 1, contentHash: 1 }, unique: true, name: 'item_hash' },
        { key: { createdAt: 1 }, expireAfterSeconds: 30 * 86400, name: 'ttl_30d' },
      ]),
      this.collection('painel_sessoes').createIndexes([
        { key: { itemKey: 1, startedAt: -1 }, name: 'item_started' },
        { key: { status: 1 }, name: 'status' },
      ]),
      this.collection('painel_prs').createIndexes([
        { key: { status: 1, deployDate: 1 }, name: 'status_deploy' },
        { key: { 'prs.url': 1 }, name: 'pr_url' },
        { key: { linkGroup: 1 }, name: 'link_group' },
        { key: { deployDate: 1 }, name: 'deploy_date' },
        { key: { 'prs.mergedAt': 1 }, name: 'pr_merged' },
      ]),
      this.collection('painel_incidentes').createIndexes([{ key: { startedAt: -1 }, name: 'started' }, { key: { status: 1 }, name: 'status' }]),
      this.collection('painel_decisoes').createIndexes([
        { key: { status: 1, decideBy: 1 }, name: 'status_due' },
        { key: { repo: 1, path: 1 }, name: 'repo_path', unique: true, partialFilterExpression: { source: 'repo' } },
      ]),
      this.collection('painel_iniciativas').createIndexes([{ key: { status: 1 }, name: 'status' }]),
      this.collection('painel_avaliacoes').createIndexes([{ key: { prUrl: 1 }, name: 'pr_url' }]),
      this.collection('painel_eventos').createIndexes([{ key: { key: 1 }, name: 'key', unique: true }, { key: { kind: 1, at: -1 }, name: 'kind_at' }, { key: { fingerprint: 1 }, name: 'fingerprint' }]),
    ]);
  }

  /** Leitura única e somente leitura da coleção do painel de PRs anterior (migração). */
  async readLegacyCollection(db: string, collection: string): Promise<Document[]> {
    if (!this.client) throw new Error('a migração do painel anterior exige MongoDB (MONGO_URI)');
    return this.client.db(db).collection(collection).find({}, { readPreference: 'secondaryPreferred' }).toArray();
  }

  async close(): Promise<void> {
    this.sqlite?.close();
    this.sqlite = undefined;
    await this.client?.close();
    this.client = undefined;
    this.db = undefined;
    this.connecting = undefined;
  }
}
