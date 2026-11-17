// Deck storage restricted to its OWN collections (prefix deck_).
// Default: a local SQLite file (sqlite-store.ts), no server. With MONGO_URI: MongoDB.
// Project rule: nothing is written outside this list; company collections are only read
// by the one-off migration (readLegacyCollection, MongoDB only), which never writes.
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import type { Config } from '../config.js';
import { SqliteDatabase } from './sqlite-store.js';

export const OWN_COLLECTIONS = [
  'deck_summaries', 'deck_runs', 'deck_prs',
  'deck_incidents', 'deck_decisions', 'deck_initiatives', 'deck_evals', 'deck_events',
] as const;
export type OwnCollection = (typeof OWN_COLLECTIONS)[number];

/** Collection names before v0.5 (Portuguese). They are renamed on the first connection; nothing is copied. */
export const RENAMED_COLLECTIONS: Readonly<Record<string, OwnCollection>> = {
  painel_resumos: 'deck_summaries', painel_sessoes: 'deck_runs', painel_prs: 'deck_prs', painel_incidentes: 'deck_incidents',
  painel_decisoes: 'deck_decisions', painel_iniciativas: 'deck_initiatives', painel_avaliacoes: 'deck_evals', painel_eventos: 'deck_events',
};
export interface RenameReport { renamed: string[]; conflicts: string[] }

export function assertOwnCollection(name: string): asserts name is OwnCollection {
  if (!(OWN_COLLECTIONS as readonly string[]).includes(name)) {
    throw new Error(`collection not allowed: ${name} (only ${OWN_COLLECTIONS.join(', ')})`);
  }
}

export type MongoStatus =
  | { state: 'not_configured' }
  | { state: 'connecting' }
  | { state: 'connected'; db: string; kind?: 'sqlite' | 'mongo' }
  | { state: 'error'; message: string };

export class DeckStore {
  private client: MongoClient | undefined;
  private db: Db | undefined;
  private connecting: Promise<void> | undefined;
  private sqlite: SqliteDatabase | undefined;
  status: MongoStatus;
  /** What the first connection renamed from the old collection names (empty when there was nothing to do). */
  renameReport: RenameReport = { renamed: [], conflicts: [] };
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
        this.renameReport = this.sqlite.renameTables(RENAMED_COLLECTIONS);
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
        const client = new MongoClient(this.cfg.uri!, { serverSelectionTimeoutMS: 10_000, appName: 'tldeck' });
        await client.connect();
        this.client = client;
        this.db = this.cfg.dbName ? client.db(this.cfg.dbName) : client.db();
        this.renameReport = await renameMongoCollections(this.db, RENAMED_COLLECTIONS);
        await this.ensureIndexes();
        this.status = { state: 'connected', db: this.db.databaseName, kind: 'mongo' };
      } catch (e) {
        // The driver message may contain the cluster host; we keep only the type/code.
        const err = e as { codeName?: string; name?: string };
        this.status = { state: 'error', message: err.codeName ?? err.name ?? 'connection failed' };
        this.connecting = undefined;
        throw e;
      }
    })();
    return this.connecting;
  }

  collection<T extends Document = Document>(name: OwnCollection): Collection<T> {
    assertOwnCollection(name);
    // SQLite implements the same API subset the repositories use.
    if (this.sqlite) return this.sqlite.collection(name) as unknown as Collection<T>;
    if (!this.db) throw Object.assign(new Error('MongoDB not connected'), { statusCode: 503 });
    return this.db.collection<T>(name);
  }

  private async ensureIndexes(): Promise<void> {
    // Indexes only on the deck's own collections. Never on the company's.
    await Promise.all([
      this.collection('deck_summaries').createIndexes([
        { key: { itemKey: 1, contentHash: 1 }, unique: true, name: 'item_hash' },
        { key: { createdAt: 1 }, expireAfterSeconds: 30 * 86400, name: 'ttl_30d' },
      ]),
      this.collection('deck_runs').createIndexes([
        { key: { itemKey: 1, startedAt: -1 }, name: 'item_started' },
        { key: { status: 1 }, name: 'status' },
      ]),
      this.collection('deck_prs').createIndexes([
        { key: { status: 1, deployDate: 1 }, name: 'status_deploy' },
        { key: { 'prs.url': 1 }, name: 'pr_url' },
        { key: { linkGroup: 1 }, name: 'link_group' },
        { key: { deployDate: 1 }, name: 'deploy_date' },
        { key: { 'prs.mergedAt': 1 }, name: 'pr_merged' },
      ]),
      this.collection('deck_incidents').createIndexes([{ key: { startedAt: -1 }, name: 'started' }, { key: { status: 1 }, name: 'status' }]),
      this.collection('deck_decisions').createIndexes([
        { key: { status: 1, decideBy: 1 }, name: 'status_due' },
        { key: { repo: 1, path: 1 }, name: 'repo_path', unique: true, partialFilterExpression: { source: 'repo' } },
      ]),
      this.collection('deck_initiatives').createIndexes([{ key: { status: 1 }, name: 'status' }]),
      this.collection('deck_evals').createIndexes([{ key: { prUrl: 1 }, name: 'pr_url' }]),
      this.collection('deck_events').createIndexes([{ key: { key: 1 }, name: 'key', unique: true }, { key: { kind: 1, at: -1 }, name: 'kind_at' }, { key: { fingerprint: 1 }, name: 'fingerprint' }]),
    ]);
  }

  /** One-off, read-only read of the previous PR board's collection (migration). */
  async readLegacyCollection(db: string, collection: string): Promise<Document[]> {
    if (!this.client) throw new Error('migrating the previous board requires MongoDB (MONGO_URI)');
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

/**
 * Renames the old collections in MongoDB (same database, so it is a metadata change: no copy).
 * A new collection that exists but is empty is replaced; when both hold data, the old one is left alone.
 */
export async function renameMongoCollections(db: Db, renames: Readonly<Record<string, string>>): Promise<RenameReport> {
  const out: RenameReport = { renamed: [], conflicts: [] };
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
  for (const [from, to] of Object.entries(renames)) {
    if (!names.has(from)) continue;
    if (names.has(to)) {
      if (await db.collection(to).estimatedDocumentCount() > 0) { out.conflicts.push(`${from} → ${to}`); continue; }
      await db.collection(to).drop();
    }
    await db.renameCollection(from, to);
    out.renamed.push(`${from} → ${to}`);
  }
  return out;
}
