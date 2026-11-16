// Acesso ao MongoDB restrito às coleções PRÓPRIAS do painel (prefixo painel_).
// Regra do projeto: nada é escrito fora desta lista; coleções da empresa só são lidas
// pela migração única (readLegacyCollection), que nunca escreve.
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import type { Config } from '../config.js';

export const OWN_COLLECTIONS = [
  'painel_resumos', 'painel_sessoes', 'painel_prs',
  'painel_incidentes', 'painel_decisoes', 'painel_iniciativas', 'painel_avaliacoes',
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
  | { state: 'connected'; db: string }
  | { state: 'error'; message: string };

export class PainelStore {
  private client: MongoClient | undefined;
  private db: Db | undefined;
  private connecting: Promise<void> | undefined;
  status: MongoStatus;

  constructor(private readonly cfg: Config['mongo']) {
    this.status = cfg.uri ? { state: 'connecting' } : { state: 'not_configured' };
  }

  get configured(): boolean { return !!this.cfg.uri; }

  async connect(): Promise<void> {
    if (!this.cfg.uri) return;
    if (this.db) return;
    this.connecting ??= (async () => {
      try {
        this.status = { state: 'connecting' };
        const client = new MongoClient(this.cfg.uri!, { serverSelectionTimeoutMS: 10_000, appName: 'agent-board' });
        await client.connect();
        this.client = client;
        this.db = this.cfg.dbName ? client.db(this.cfg.dbName) : client.db();
        await this.ensureIndexes();
        this.status = { state: 'connected', db: this.db.databaseName };
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
    ]);
  }

  /** Leitura única e somente leitura da coleção do painel de PRs anterior (migração). */
  async readLegacyCollection(db: string, collection: string): Promise<Document[]> {
    if (!this.client) throw new Error('MongoDB não conectado');
    return this.client.db(db).collection(collection).find({}, { readPreference: 'secondaryPreferred' }).toArray();
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    this.db = undefined;
    this.connecting = undefined;
  }
}
