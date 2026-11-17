// JSON GET with a timeout and validation. Errors never carry the token or the whole response body.
import type { z } from 'zod';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class InfraHttpError extends Error {
  constructor(message: string, readonly status: number | undefined) { super(message); }
}

/** 401/403: the token has no scope for this resource (or expired). */
export const isScopeError = (e: unknown): e is InfraHttpError => e instanceof InfraHttpError && (e.status === 401 || e.status === 403);

export async function getJson<T>(fetcher: Fetcher, url: string, headers: Record<string, string>, schema: z.ZodType<T>, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { headers: { 'User-Agent': 'tldeck-local (read-only)', Accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? 'token without permission or expired' : res.status === 429 ? 'rate limit' : `HTTP ${res.status}`;
      throw new InfraHttpError(`${new URL(url).host}: ${hint}`, res.status);
    }
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw new InfraHttpError(`${new URL(url).host}: resposta em formato inesperado`, res.status);
    return parsed.data;
  } catch (e) {
    if (e instanceof InfraHttpError) throw e;
    throw new InfraHttpError(`${new URL(url).host}: ${(e as Error).name === 'AbortError' ? 'timed out' : 'network error'}`, undefined);
  } finally {
    clearTimeout(timer);
  }
}

export async function postForm<T>(fetcher: Fetcher, url: string, form: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  const res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  if (!res.ok) throw new InfraHttpError(`${new URL(url).host}: authentication refused (HTTP ${res.status})`, res.status);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new InfraHttpError(`${new URL(url).host}: resposta de token inesperada`, res.status);
  return parsed.data;
}
