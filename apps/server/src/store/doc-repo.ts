// CRUD simples sobre uma coleção PRÓPRIA do painel (a allowlist de mongo.ts vale aqui também).
import { ObjectId, type Document, type Filter, type Sort } from 'mongodb';
import type { OwnCollection, PainelStore } from './mongo.js';

export const isId = (id: string) => ObjectId.isValid(id) && String(new ObjectId(id)) === id.toLowerCase();

export class DocRepo<T extends Document> {
  constructor(private readonly store: PainelStore, private readonly name: OwnCollection) {}
  get col() { return this.store.collection<Document>(this.name); }

  async list(filter: Filter<T> = {}, sort: Sort = { updatedAt: -1 }, limit = 500): Promise<Array<T & { _id: ObjectId }>> {
    return (await this.col.find(filter as Filter<Document>).sort(sort).limit(limit).toArray()) as unknown as Array<T & { _id: ObjectId }>;
  }

  async get(id: string): Promise<(T & { _id: ObjectId }) | null> {
    return (await this.col.findOne({ _id: new ObjectId(id) } as Filter<Document>)) as unknown as (T & { _id: ObjectId }) | null;
  }

  async create(doc: T): Promise<string> {
    const r = await this.col.insertOne(doc as never);
    return String(r.insertedId);
  }

  async update(id: string, set: Partial<T>): Promise<(T & { _id: ObjectId }) | null> {
    const r = await this.col.findOneAndUpdate({ _id: new ObjectId(id) } as Filter<Document>, { $set: set as Document }, { returnDocument: 'after' });
    return r as unknown as (T & { _id: ObjectId }) | null;
  }

  async remove(id: string): Promise<boolean> {
    return (await this.col.deleteOne({ _id: new ObjectId(id) } as Filter<Document>)).deletedCount > 0;
  }
}

/** Mascara campos de texto (string ou lista de strings) de um objeto raso. */
export function maskFields<T extends Record<string, unknown>>(obj: T, keys: Array<keyof T>, mask: (s: string) => string): T {
  const out = { ...obj };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === 'string') out[k] = mask(v) as T[keyof T];
    else if (Array.isArray(v)) out[k] = v.map(x => (typeof x === 'string' ? mask(x) : x)) as T[keyof T];
  }
  return out;
}
