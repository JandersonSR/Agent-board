// Paridade: o armazenamento local (SQLite) responde às consultas do painel igual ao MongoDB.
// Roda só com MONGO_TEST_URI (no CI há um MongoDB de serviço).
import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteDatabase } from './sqlite-store.js';

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

describe.skipIf(!uri)('paridade SQLite × MongoDB', () => {
  let client: MongoClient;
  const name = `ld_parity_${Date.now().toString(36)}`;
  const sqlite = new SqliteDatabase(':memory:');
  beforeAll(async () => {
    client = await new MongoClient(uri!).connect();
    await client.db(name).collection('painel_prs').insertMany(docs.map(d => ({ ...d })));
    await sqlite.collection('painel_prs').insertMany(docs.map(d => ({ ...d })));
  });
  afterAll(async () => { await client?.db(name).dropDatabase(); await client?.close(); sqlite.close(); });

  it.each(filters.map(f => [JSON.stringify(f), f]))('find %s', async (_label, f) => {
    const ids = (xs: Array<{ _id?: unknown }>) => xs.map(x => String(x._id)).sort();
    const m = await client.db(name).collection('painel_prs').find(f as never).toArray();
    const s = await sqlite.collection('painel_prs').find(f).toArray();
    expect(ids(s)).toEqual(ids(m));
  });

  it('ordenação com campos ausentes e nulos', async () => {
    const m = await client.db(name).collection('painel_prs').find({}).sort({ mergedAt: -1, status: 1 }).toArray();
    const s = await sqlite.collection('painel_prs').find({}).sort({ mergedAt: -1, status: 1 }).toArray();
    expect(s.map(x => String(x._id))).toEqual(m.map(x => String(x._id)));
  });
});
