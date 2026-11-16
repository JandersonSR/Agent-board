// Armazenamento local padrão: um arquivo SQLite, sem servidor nem configuração.
//
// Implementa o subconjunto da API de coleção do driver do MongoDB que o painel usa
// (find/sort/limit/projeção simples, findOne, insert, update/replace com upsert,
// findOneAndUpdate, delete, countDocuments) com os operadores $eq/$ne/$gt(e)/$lt(e)/$in/$nin/
// $exists/$regex/$or/$and e, na escrita, $set/$unset/$setOnInsert/$push($each/$slice)/$inc.
// Assim os repositórios funcionam iguais com SQLite ou MongoDB.
//
// Cada coleção é uma tabela (id, doc JSON). Os documentos ficam em memória depois da primeira
// leitura (o servidor é o único dono do arquivo) e cada escrita grava a linha na hora.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { BSON, ObjectId } from 'mongodb';

type Doc = Record<string, unknown> & { _id?: unknown };
type Filter = Record<string, unknown>;

// ---------- Serialização (datas e ObjectId sobrevivem ao JSON) ----------
const toJson = (d: Doc) => BSON.EJSON.stringify(d, { relaxed: true });
const fromJson = (s: string) => BSON.EJSON.parse(s, { relaxed: true }) as Doc;
const idKey = (id: unknown) => (id instanceof ObjectId ? id.toHexString() : String(id));

// ---------- Comparação e caminhos ----------
const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof ObjectId) && !(v instanceof RegExp);

/** Valores de um caminho com pontos; atravessa arrays como o MongoDB (qualquer elemento). */
export function valuesAt(doc: unknown, pathStr: string): unknown[] {
  let cur: unknown[] = [doc];
  for (const part of pathStr.split('.')) {
    const next: unknown[] = [];
    for (const v of cur) {
      if (Array.isArray(v)) {
        if (/^\d+$/.test(part)) next.push(v[Number(part)]);
        else for (const el of v) if (isPlain(el)) next.push(el[part]);
      } else if (isPlain(v)) next.push(v[part]);
      else next.push(undefined);
    }
    cur = next;
  }
  return cur;
}

const TYPE_ORDER = (v: unknown): number =>
  v === undefined || v === null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2
    : isPlain(v) ? 3 : Array.isArray(v) ? 4 : v instanceof ObjectId ? 5 : typeof v === 'boolean' ? 6 : v instanceof Date ? 7 : 8;

export function compare(a: unknown, b: unknown): number {
  const ta = TYPE_ORDER(a); const tb = TYPE_ORDER(b);
  if (ta !== tb) return ta - tb;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (a instanceof ObjectId && b instanceof ObjectId) return a.toHexString().localeCompare(b.toHexString());
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (ta === 0) return 0;
  const sa = JSON.stringify(a); const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

const sameType = (a: unknown, b: unknown) => TYPE_ORDER(a) === TYPE_ORDER(b);
const equals = (a: unknown, b: unknown) => {
  if ((a === undefined || a === null) && (b === undefined || b === null)) return true;
  return sameType(a, b) && compare(a, b) === 0;
};

/** Candidatos para comparar: o valor e, se for array, cada elemento. */
const expand = (vals: unknown[]) => vals.flatMap(v => (Array.isArray(v) ? [v, ...v] : [v]));

function matchOperator(op: string, arg: unknown, vals: unknown[], opts: Record<string, unknown>): boolean {
  const cand = expand(vals);
  switch (op) {
    case '$eq': return cand.some(v => equals(v, arg));
    case '$ne': return !cand.some(v => equals(v, arg));
    case '$gt': return cand.some(v => v != null && sameType(v, arg) && compare(v, arg) > 0);
    case '$gte': return cand.some(v => v != null && sameType(v, arg) && compare(v, arg) >= 0);
    case '$lt': return cand.some(v => v != null && sameType(v, arg) && compare(v, arg) < 0);
    case '$lte': return cand.some(v => v != null && sameType(v, arg) && compare(v, arg) <= 0);
    case '$in': return (arg as unknown[]).some(x => (x instanceof RegExp ? cand.some(v => typeof v === 'string' && x.test(v)) : cand.some(v => equals(v, x))));
    case '$nin': return !(arg as unknown[]).some(x => cand.some(v => equals(v, x)));
    case '$exists': return Boolean(arg) === vals.some(v => v !== undefined);
    case '$regex': {
      const re = arg instanceof RegExp ? arg : new RegExp(String(arg), String(opts.$options ?? ''));
      return cand.some(v => typeof v === 'string' && re.test(v));
    }
    case '$options': return true;
    case '$not': return !matchValue(arg, vals);
    case '$size': return vals.some(v => Array.isArray(v) && v.length === arg);
    case '$elemMatch': return vals.some(v => Array.isArray(v) && v.some(el => (isPlain(arg) && Object.keys(arg).every(k => k.startsWith('$')) ? matchValue(arg, [el]) : matches(el, arg as Filter))));
    default: throw new Error(`operador não suportado no armazenamento local: ${op}`);
  }
}

function matchValue(cond: unknown, vals: unknown[]): boolean {
  if (cond instanceof RegExp) return expand(vals).some(v => typeof v === 'string' && cond.test(v));
  if (isPlain(cond) && Object.keys(cond).some(k => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, arg]) => matchOperator(op, arg, vals, cond));
  }
  return matchOperator('$eq', cond, vals, {});
}

export function matches(doc: unknown, filter: Filter): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') { if (!(cond as Filter[]).some(f => matches(doc, f))) return false; continue; }
    if (key === '$and') { if (!(cond as Filter[]).every(f => matches(doc, f))) return false; continue; }
    if (key === '$nor') { if ((cond as Filter[]).some(f => matches(doc, f))) return false; continue; }
    if (key.startsWith('$')) throw new Error(`operador não suportado no armazenamento local: ${key}`);
    if (!matchValue(cond, valuesAt(doc, key))) return false;
  }
  return true;
}

// ---------- Escrita ----------
const clone = <T>(v: T): T => (v === undefined ? v : (BSON.EJSON.parse(BSON.EJSON.stringify(v as never, { relaxed: true }), { relaxed: true }) as T));

function setPath(doc: Doc, pathStr: string, value: unknown): void {
  const parts = pathStr.split('.');
  let cur: Record<string, unknown> | unknown[] = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const nextIsIndex = /^\d+$/.test(parts[i + 1]!);
    const holder = cur as Record<string, unknown>;
    if (!isPlain(holder[p]) && !Array.isArray(holder[p])) holder[p] = nextIsIndex ? [] : {};
    cur = holder[p] as Record<string, unknown>;
  }
  (cur as Record<string, unknown>)[parts[parts.length - 1]!] = clone(value);
}

function unsetPath(doc: Doc, pathStr: string): void {
  const parts = pathStr.split('.');
  let cur: unknown = doc;
  for (let i = 0; i < parts.length - 1; i++) { cur = isPlain(cur) || Array.isArray(cur) ? (cur as Record<string, unknown>)[parts[i]!] : undefined; }
  if (isPlain(cur)) delete cur[parts[parts.length - 1]!];
}

const getPath = (doc: Doc, p: string) => valuesAt(doc, p)[0];

function applyUpdate(doc: Doc, update: Record<string, unknown>, inserting: boolean): Doc {
  const out = clone(doc);
  if (!Object.keys(update).some(k => k.startsWith('$'))) {
    // substituição inteira (replaceOne)
    return { ...clone(update), _id: doc._id };
  }
  for (const [op, fields] of Object.entries(update)) {
    const entries = Object.entries(fields as Record<string, unknown>);
    switch (op) {
      case '$set': for (const [k, v] of entries) if (v !== undefined) setPath(out, k, v); break;
      case '$setOnInsert': if (inserting) for (const [k, v] of entries) if (v !== undefined) setPath(out, k, v); break;
      case '$unset': for (const [k] of entries) unsetPath(out, k); break;
      case '$inc': for (const [k, v] of entries) setPath(out, k, (Number(getPath(out, k)) || 0) + Number(v)); break;
      case '$push': for (const [k, v] of entries) {
        const prev = getPath(out, k);
        const arr = Array.isArray(prev) ? [...prev] : [];
        const spec = isPlain(v) && '$each' in v ? v as { $each: unknown[]; $slice?: number } : { $each: [v] };
        arr.push(...spec.$each.map(clone));
        const sliced = spec.$slice === undefined ? arr : spec.$slice < 0 ? arr.slice(spec.$slice) : arr.slice(0, spec.$slice);
        setPath(out, k, sliced);
      } break;
      default: throw new Error(`operador de escrita não suportado no armazenamento local: ${op}`);
    }
  }
  return out;
}

/** Campos de igualdade do filtro que viram o documento novo num upsert. */
function seedFromFilter(filter: Filter): Doc {
  const doc: Doc = {};
  for (const [k, v] of Object.entries(filter)) {
    if (k.startsWith('$')) continue;
    if (isPlain(v) && Object.keys(v).some(x => x.startsWith('$'))) { if ('$eq' in v) setPath(doc, k, v.$eq); continue; }
    setPath(doc, k, v);
  }
  return doc;
}

function project(doc: Doc, projection: Record<string, unknown> | undefined): Doc {
  if (!projection) return doc;
  const out = clone(doc);
  for (const [k, v] of Object.entries(projection)) {
    if (isPlain(v) && '$slice' in v) {
      const arr = getPath(out, k);
      if (Array.isArray(arr)) { const n = Number(v.$slice); setPath(out, k, n < 0 ? arr.slice(n) : arr.slice(0, n)); }
    } else if (v === 0 || v === false) unsetPath(out, k);
    // inclusões: devolve o documento inteiro (um superconjunto do pedido é suficiente para o painel)
  }
  return out;
}

function sortDocs(docs: Doc[], sort: Record<string, 1 | -1> | undefined): Doc[] {
  if (!sort) return docs;
  const keys = Object.entries(sort);
  return [...docs].sort((a, b) => {
    for (const [k, dir] of keys) {
      const c = compare(valuesAt(a, k)[0], valuesAt(b, k)[0]);
      if (c) return c * (dir < 0 ? -1 : 1);
    }
    return 0;
  });
}

class Cursor {
  private s: Record<string, 1 | -1> | undefined;
  private n = 0;
  constructor(private readonly load: () => Doc[], private readonly projection?: Record<string, unknown>) {}
  sort(s: Record<string, 1 | -1>) { this.s = s; return this; }
  limit(n: number) { this.n = n; return this; }
  async toArray(): Promise<Doc[]> {
    const sorted = sortDocs(this.load(), this.s);
    return (this.n ? sorted.slice(0, this.n) : sorted).map(d => project(clone(d), this.projection));
  }
}

// ---------- Banco ----------
interface Stmt { run(...a: unknown[]): unknown; all(...a: unknown[]): Array<Record<string, unknown>> }
interface SqliteDb { exec(sql: string): void; prepare(sql: string): Stmt; close(): void }

/** Carrega node:sqlite sem o aviso "experimental" no console (Node 22). */
function openSqlite(file: string): SqliteDb {
  const require = createRequire(import.meta.url);
  const original = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (String(typeof w === 'string' ? w : w.message).includes('SQLite')) return;
    return (original as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try {
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (f: string) => SqliteDb };
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    return db;
  } finally {
    process.emitWarning = original;
  }
}

export class SqliteCollection {
  private cache: Map<string, Doc> | undefined;
  private readonly upsertStmt: Stmt;
  private readonly deleteStmt: Stmt;

  constructor(private readonly db: SqliteDb, private readonly table: string) {
    if (!/^[a-z_]+$/.test(table)) throw new Error(`nome de tabela inválido: ${table}`);
    db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, doc TEXT NOT NULL)`);
    this.upsertStmt = db.prepare(`INSERT INTO "${table}" (id, doc) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc`);
    this.deleteStmt = db.prepare(`DELETE FROM "${table}" WHERE id = ?`);
  }

  private get docs(): Map<string, Doc> {
    if (!this.cache) {
      this.cache = new Map();
      for (const row of this.db.prepare(`SELECT id, doc FROM "${this.table}"`).all()) this.cache.set(String(row.id), fromJson(String(row.doc)));
    }
    return this.cache;
  }

  private save(doc: Doc): void {
    const key = idKey(doc._id);
    this.upsertStmt.run(key, toJson(doc));
    this.docs.set(key, doc);
  }

  private matching(filter: Filter = {}): Doc[] {
    // atalho para busca por _id
    const id = filter._id;
    if (id !== undefined && !isPlain(id) && Object.keys(filter).length === 1) {
      const d = this.docs.get(idKey(id));
      return d ? [d] : [];
    }
    return [...this.docs.values()].filter(d => matches(d, filter));
  }

  find(filter: Filter = {}, opts: { projection?: Record<string, unknown> } = {}) {
    return new Cursor(() => this.matching(filter), opts.projection);
  }

  async findOne(filter: Filter = {}, opts: { projection?: Record<string, unknown>; sort?: Record<string, 1 | -1> } = {}): Promise<Doc | null> {
    const d = sortDocs(this.matching(filter), opts.sort)[0];
    return d ? project(clone(d), opts.projection) : null;
  }

  async countDocuments(filter: Filter = {}): Promise<number> { return this.matching(filter).length; }

  async insertOne(doc: Doc): Promise<{ acknowledged: true; insertedId: unknown }> {
    const d = clone(doc);
    d._id ??= new ObjectId();
    if (this.docs.has(idKey(d._id))) throw Object.assign(new Error('E11000 duplicate key _id'), { code: 11000 });
    this.save(d);
    if (doc._id === undefined) (doc as Doc)._id = d._id; // como o driver: o objeto de entrada ganha o _id
    return { acknowledged: true, insertedId: d._id };
  }

  async insertMany(docs: Doc[]): Promise<{ acknowledged: true; insertedCount: number }> {
    for (const d of docs) await this.insertOne(d);
    return { acknowledged: true, insertedCount: docs.length };
  }

  private updateWhere(filter: Filter, update: Record<string, unknown>, many: boolean, upsert: boolean) {
    const found = this.matching(filter);
    const targets = many ? found : found.slice(0, 1);
    let modified = 0;
    for (const t of targets) {
      const next = applyUpdate(t, update, false);
      if (toJson(next) !== toJson(t)) { this.save(next); modified++; }
    }
    if (!targets.length && upsert) {
      const seed = seedFromFilter(filter);
      const doc = applyUpdate({ ...seed, _id: seed._id ?? new ObjectId() }, update, true);
      doc._id ??= seed._id ?? new ObjectId();
      this.save(doc);
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id, doc };
    }
    return { acknowledged: true, matchedCount: targets.length, modifiedCount: modified, upsertedCount: 0, upsertedId: null, doc: undefined };
  }

  async updateOne(filter: Filter, update: Record<string, unknown>, opts: { upsert?: boolean } = {}) {
    const { doc: _d, ...r } = this.updateWhere(filter, update, false, !!opts.upsert);
    return r;
  }

  async updateMany(filter: Filter, update: Record<string, unknown>, opts: { upsert?: boolean } = {}) {
    const { doc: _d, ...r } = this.updateWhere(filter, update, true, !!opts.upsert);
    return r;
  }

  async replaceOne(filter: Filter, replacement: Doc, opts: { upsert?: boolean } = {}) {
    const { _id: _ignored, ...body } = replacement;
    const { doc: _d, ...r } = this.updateWhere(filter, body, false, !!opts.upsert);
    return r;
  }

  async findOneAndUpdate(filter: Filter, update: Record<string, unknown>, opts: { returnDocument?: 'before' | 'after'; upsert?: boolean; projection?: Record<string, unknown> } = {}): Promise<Doc | null> {
    const before = this.matching(filter)[0];
    const prev = before ? clone(before) : null;
    const r = this.updateWhere(filter, update, false, !!opts.upsert);
    const after = before ? this.docs.get(idKey(before._id)) ?? null : r.doc ?? null;
    const out = opts.returnDocument === 'after' ? after : prev;
    return out ? project(clone(out), opts.projection) : null;
  }

  async deleteOne(filter: Filter): Promise<{ acknowledged: true; deletedCount: number }> {
    const d = this.matching(filter)[0];
    if (!d) return { acknowledged: true, deletedCount: 0 };
    this.deleteStmt.run(idKey(d._id));
    this.docs.delete(idKey(d._id));
    return { acknowledged: true, deletedCount: 1 };
  }

  async deleteMany(filter: Filter = {}): Promise<{ acknowledged: true; deletedCount: number }> {
    const ds = this.matching(filter);
    for (const d of ds) { this.deleteStmt.run(idKey(d._id)); this.docs.delete(idKey(d._id)); }
    return { acknowledged: true, deletedCount: ds.length };
  }

  /** Índices não fazem falta no volume do painel; aceitos e ignorados. */
  async createIndexes(): Promise<string[]> { return []; }
}

export class SqliteDatabase {
  private readonly db: SqliteDb;
  private readonly cols = new Map<string, SqliteCollection>();
  constructor(readonly file: string) { this.db = openSqlite(file); }
  collection(name: string): SqliteCollection {
    let c = this.cols.get(name);
    if (!c) this.cols.set(name, c = new SqliteCollection(this.db, name));
    return c;
  }
  close(): void { this.db.close(); }
}
