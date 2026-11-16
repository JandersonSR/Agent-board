// GET de JSON com tempo limite e validação. Os erros nunca carregam o token nem o corpo inteiro da resposta.
import type { z } from 'zod';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class InfraHttpError extends Error {
  constructor(message: string, readonly status: number | undefined) { super(message); }
}

export async function getJson<T>(fetcher: Fetcher, url: string, headers: Record<string, string>, schema: z.ZodType<T>, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { headers: { 'User-Agent': 'lead-deck-local (read-only)', Accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? 'token sem permissão ou expirado' : res.status === 429 ? 'limite de requisições' : `HTTP ${res.status}`;
      throw new InfraHttpError(`${new URL(url).host}: ${hint}`, res.status);
    }
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw new InfraHttpError(`${new URL(url).host}: resposta em formato inesperado`, res.status);
    return parsed.data;
  } catch (e) {
    if (e instanceof InfraHttpError) throw e;
    throw new InfraHttpError(`${new URL(url).host}: ${(e as Error).name === 'AbortError' ? 'tempo esgotado' : 'falha de rede'}`, undefined);
  } finally {
    clearTimeout(timer);
  }
}

export async function postForm<T>(fetcher: Fetcher, url: string, form: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  const res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  if (!res.ok) throw new InfraHttpError(`${new URL(url).host}: autenticação recusada (HTTP ${res.status})`, res.status);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new InfraHttpError(`${new URL(url).host}: resposta de token inesperada`, res.status);
  return parsed.data;
}
