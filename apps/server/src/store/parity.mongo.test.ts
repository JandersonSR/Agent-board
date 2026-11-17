// Parity: local storage (SQLite) answers the deck's queries the same as MongoDB.
// Only runs with MONGO_TEST_URI (CI has a MongoDB service).
import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteDatabase } from './sqlite-store.js';
import { RENAMED_COLLECTIONS, renameMongoCollections } from './store.js';

const uri = process.env.MONGO_TEST_URI;
const D = (s: string) => new Date(s);
const docs = [
  { _id: new ObjectId(), status: 'merged', archived: false, deployDate: '2026-11-10', mergedAt: D('2026-11-09T10:00:00Z'), reference: 'https://github.com/o/r/issues/1',
    prs: [{ url: 'a', mergedAt: D('2026-11-01T00:00:00Z'), state: 'merged', reviewers: ['Ana'] }, { url: 'b', mergedAt: null, state: 'open' }], task: { phase: 'ready' } },
  { _id: new ObjectId(), status: 'reviewing', deployDate: '2026-11-20', mergedAt: null, reference: 'https://github.com/o/r/pull/2', prs: [{ url: 'c', state: 'open' }] },
  { _id: new ObjectId(), status: 'merged', archived: true, mergedAt: D('2026-10-01T00:00:00Z'), prs: [], evalCaseId: 'x', tags: ['hotfix', 'api'] },
  { _id: new ObjectId(), status: 'review_queue', prs: [{ url: 'd', mergedAt: D('2026-11-12T00:00:00Z'), state: 'merged' }], score: 3 },
];
const filters: Array<Record<string, unknown>> = [
  {}, { status: 'merged' }, { archived: { $ne: true } }, { archived: true },
  { mergedAt: null }, { mergedAt: { $gte: D('2026-11-01T00:00:00Z') } }, { 'prs.mergedAt': { $gte: D('2026-11-05T00:00:00Z') } },
  { 'prs.url': { $in: ['b', 'd'] } }, { deployDate: { $gte: '2026-11-15' } }, { evalCaseId: { $exists: true } }, { evalCaseId: { $exists: false } },
  { reference: { $regex: '/issues/\\d+$' } }, { 'task.phase': 'ready' }, { tags: 'api' }, { tags: { $in: ['hotfix'] } }, { score: { $gt: 2, $lte: 3 } },
  { status: { $nin: ['merged', 'reviewing'] } }, { 'prs.reviewers': 'Ana' },
  { archived: { $ne: true }, $or: [{ status: { $ne: 'merged' } }, { mergedAt: { $gte: D('2026-11-01T00:00:00Z') } }, { 'prs.mergedAt': { $gte: D('2026-11-01T00:00:00Z') } }] },
];

describe.skipIf(!uri)('SQLite × MongoDB parity', () => {
  let client: MongoClient;
  const name = `ld_parity_${Date.now().toString(36)}`;
  const sqlite = new SqliteDatabase(':memory:');
  beforeAll(async () => {
    client = await new MongoClient(uri!).connect();
    await client.db(name).collection('deck_prs').insertMany(docs.map(d => ({ ...d })));
    await sqlite.collection('deck_prs').insertMany(docs.map(d => ({ ...d })));
  });
  afterAll(async () => { await client?.db(name).dropDatabase(); await client?.close(); sqlite.close(); });

  it.each(filters.map(f => [JSON.stringify(f), f]))('find %s', async (_label, f) => {
    const ids = (xs: Array<{ _id?: unknown }>) => xs.map(x => String(x._id)).sort();
    const m = await client.db(name).collection('deck_prs').find(f as never).toArray();
    const s = await sqlite.collection('deck_prs').find(f).toArray();
    expect(ids(s)).toEqual(ids(m));
  });

  it('sorting with missing and null fields', async () => {
    const m = await client.db(name).collection('deck_prs').find({}).sort({ mergedAt: -1, status: 1 }).toArray();
    const s = await sqlite.collection('deck_prs').find({}).sort({ mergedAt: -1, status: 1 }).toArray();
    expect(s.map(x => String(x._id))).toEqual(m.map(x => String(x._id)));
  });
});

describe.skipIf(!uri)('renaming the old collections in MongoDB', () => {
  it('renames in place, replaces an empty new collection and leaves conflicts alone', async () => {
    const client = await new MongoClient(uri!).connect();
    const db = client.db(`ld_rename_${Date.now().toString(36)}`);
    try {
      await db.collection('painel_prs').insertOne({ key: 'a' });
      await db.collection('painel_sessoes').insertOne({ status: 'done' });
      await db.createCollection('deck_runs');
      await db.collection('painel_incidentes').insertOne({ title: 'old' });
      await db.collection('deck_incidents').insertOne({ title: 'new' });
      const r = await renameMongoCollections(db, RENAMED_COLLECTIONS);
      expect(r.renamed.sort()).toEqual(['painel_prs → deck_prs', 'painel_sessoes → deck_runs']);
      expect(r.conflicts).toEqual(['painel_incidentes → deck_incidents']);
      expect(await db.collection('deck_prs').findOne({})).toMatchObject({ key: 'a' });
      expect(await db.collection('deck_runs').countDocuments()).toBe(1);
      expect(await renameMongoCollections(db, RENAMED_COLLECTIONS)).toEqual({ renamed: [], conflicts: ['painel_incidentes → deck_incidents'] });
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  });
});
