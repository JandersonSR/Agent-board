// JSON over HTTP with a timeout and validation, shared by the read-only integrations (infra, chat, trackers).
// Errors never carry the token or the response body: only the host and a short reason.
import type { z } from 'zod';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(message: string, readonly status: number | undefined) { super(message); }
}

/** 401/403: the token has no scope for this resource (or expired). */
export const isScopeError = (e: unknown): e is HttpError => e instanceof HttpError && (e.status === 401 || e.status === 403);

async function call<T>(fetcher: Fetcher, url: string, init: RequestInit, schema: z.ZodType<T>, timeoutMs: number): Promise<T> {
  const host = new URL(url).host;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { ...init, headers: { 'User-Agent': 'tldeck-local (read-only)', Accept: 'application/json', ...(init.headers as Record<string, string>) }, signal: ctrl.signal });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? 'token without permission or expired' : res.status === 429 ? 'rate limit' : `HTTP ${res.status}`;
      throw new HttpError(`${host}: ${hint}`, res.status);
    }
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw new HttpError(`${host}: unexpected response format`, res.status);
    return parsed.data;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(`${host}: ${(e as Error).name === 'AbortError' ? 'timed out' : 'network error'}`, undefined);
  } finally {
    clearTimeout(timer);
  }
}

export const getJson = <T>(fetcher: Fetcher, url: string, headers: Record<string, string>, schema: z.ZodType<T>, timeoutMs = 15_000): Promise<T> =>
  call(fetcher, url, { headers }, schema, timeoutMs);

/** POST with a JSON body (GraphQL, search endpoints). Still read-only: only query endpoints use it. */
export const postJson = <T>(fetcher: Fetcher, url: string, headers: Record<string, string>, body: unknown, schema: z.ZodType<T>, timeoutMs = 20_000): Promise<T> =>
  call(fetcher, url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, schema, timeoutMs);

export async function postForm<T>(fetcher: Fetcher, url: string, form: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  const res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  if (!res.ok) throw new HttpError(`${new URL(url).host}: authentication refused (HTTP ${res.status})`, res.status);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new HttpError(`${new URL(url).host}: unexpected token response`, res.status);
  return parsed.data;
}
