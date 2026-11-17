import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { matches, SqliteDatabase } from './sqlite-store.js';

const D = (s: string) => new Date(s);

describe('matches (operadores usados pelo painel)', () => {
  const doc = {
    status: 'merged', deployDate: '2026-11-10', archived: false, mergedAt: D('2026-11-09T10:00:00Z'),
    prs: [{ url: 'a', mergedAt: D('2026-11-01T00:00:00Z'), state: 'merged' }, { url: 'b', mergedAt: null, state: 'open' }],
    task: { phase: 'ready' }, reference: 'https://github.com/o/r/issues/12',
  };
  it('igualdade, $ne com campo ausente, $exists e caminhos com pontos', () => {
    expect(matches(doc, { status: 'merged', 'task.phase': 'ready' })).toBe(true);
    expect(matches(doc, { archived: { $ne: true } })).toBe(true);
    expect(matches({}, { archived: { $ne: true } })).toBe(true);
    expect(matches(doc, { evalCaseId: { $exists: false } })).toBe(true);
    expect(matches(doc, { 'task.phase': { $exists: true } })).toBe(true);
  });
  it('datas, $gte/$lt e arrays de subdocumentos', () => {
    expect(matches(doc, { mergedAt: { $gte: D('2026-11-09T00:00:00Z') } })).toBe(true);
    expect(matches(doc, { 'prs.mergedAt': { $gte: D('2026-10-31T00:00:00Z') } })).toBe(true);
    expect(matches(doc, { 'prs.mergedAt': { $gte: D('2026-11-05T00:00:00Z') } })).toBe(false);
    expect(matches(doc, { 'prs.url': { $in: ['x', 'b'] } })).toBe(true);
    expect(matches(doc, { deployDate: { $gte: '2026-11-01' } })).toBe(true);
    expect(matches(doc, { mergedAt: { $gte: '2026-01-01' } })).toBe(false); // tipos diferentes não se comparam
  });
  it('$or, $regex, null e ObjectId', () => {
    expect(matches(doc, { $or: [{ status: { $ne: 'merged' } }, { mergedAt: { $gte: D('2026-11-01T00:00:00Z') } }] })).toBe(true);
    expect(matches(doc, { reference: { $regex: '/issues/\\d+$' } })).toBe(true);
    expect(matches({ mergedAt: null }, { mergedAt: null })).toBe(true);
    expect(matches({}, { mergedAt: null })).toBe(true);
    const id = new ObjectId();
    expect(matches({ _id: id }, { _id: new ObjectId(id.toHexString()) })).toBe(true);
  });
  it('operador desconhecido falha alto (não ignora em silêncio)', () => {
    expect(() => matches(doc, { status: { $where: 'x' } })).toThrow(/não suportado/);
  });
});

describe('SqliteDatabase', () => {
  it('CRUD, upsert, $push com $slice, projeção e persistência no arquivo', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ld-')), 'data.db');
    const db = new SqliteDatabase(file);
    const runs = db.collection('painel_sessoes');
    const r = await runs.insertOne({ kind: 'review', status: 'running', startedAt: D('2026-11-16T10:00:00Z'), log: [], promptMasked: 'p' });
    const id = r.insertedId as ObjectId;
    await runs.insertOne({ kind: 'task', status: 'running', startedAt: D('2026-11-16T11:00:00Z'), log: [], task: { phase: 'planning' } });

    await runs.updateOne({ _id: id }, { $push: { log: { $each: [1, 2, 3, 4, 5].map(i => ({ i })), $slice: -3 } }, $set: { model: 'sonnet' } });
    const one = await runs.findOne({ _id: id });
    expect(one!.log).toEqual([{ i: 3 }, { i: 4 }, { i: 5 }]);
    expect(one!.startedAt).toBeInstanceOf(Date);

    await runs.updateMany({ kind: 'task', status: 'running' }, { $set: { 'task.phase': 'failed' } });
    const listed = await runs.find({}, { projection: { log: { $slice: -1 }, promptMasked: 0 } }).sort({ startedAt: -1 }).limit(5).toArray();
    expect(listed.map(d => d.kind)).toEqual(['task', 'review']);
    expect((listed[0]!.task as { phase: string }).phase).toBe('failed');
    expect(listed[1]!.promptMasked).toBeUndefined();
    expect(listed[1]!.log).toEqual([{ i: 5 }]);
    expect(await runs.countDocuments({ startedAt: { $gte: D('2026-11-16T10:30:00Z') } })).toBe(1);

    const dec = db.collection('painel_decisoes');
    const up = await dec.updateOne({ source: 'repo', repo: 'api', path: 'docs/adr/1.md' }, { $set: { title: 'A' }, $setOnInsert: { createdAt: D('2026-11-16T00:00:00Z') } }, { upsert: true });
    expect(up.upsertedCount).toBe(1);
    const again = await dec.updateOne({ source: 'repo', repo: 'api', path: 'docs/adr/1.md' }, { $set: { title: 'B' }, $setOnInsert: { createdAt: D('2020-01-01T00:00:00Z') } }, { upsert: true });
    expect(again).toMatchObject({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 });
    const d = await dec.findOne({ repo: 'api' });
    expect(d).toMatchObject({ title: 'B', source: 'repo', path: 'docs/adr/1.md' });
    expect((d!.createdAt as Date).toISOString()).toBe('2026-11-16T00:00:00.000Z');

    const after = await dec.findOneAndUpdate({ _id: d!._id }, { $set: { owner: 'Ana' } }, { returnDocument: 'after' });
    expect(after!.owner).toBe('Ana');
    await dec.replaceOne({ _id: d!._id }, { title: 'C', source: 'repo' });
    expect(await dec.findOne({ _id: d!._id })).toMatchObject({ title: 'C' });
    expect((await dec.findOne({ _id: d!._id }))!.owner).toBeUndefined();
    expect((await dec.deleteOne({ _id: d!._id })).deletedCount).toBe(1);
    db.close();

    const reopened = new SqliteDatabase(file);
    expect(await reopened.collection('painel_sessoes').countDocuments()).toBe(2);
    expect(await reopened.collection('painel_decisoes').countDocuments()).toBe(0);
    reopened.close();
  });

  it('insertOne preenche o _id do objeto de entrada e recusa _id repetido', async () => {
    const db = new SqliteDatabase(':memory:');
    const c = db.collection('painel_prs');
    const doc: Record<string, unknown> = { key: 'k' };
    await c.insertOne(doc);
    expect(doc._id).toBeInstanceOf(ObjectId);
    await expect(c.insertOne({ _id: doc._id, key: 'x' })).rejects.toThrow(/duplicate/);
  });
});
