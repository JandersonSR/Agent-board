// Local API client. Writes carry X-Agent-Board (required by the server against CSRF).
import { serverText } from './i18n';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  // Content-Type only with a body: Fastify refuses empty JSON (a POST without a body would give 400).
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-Agent-Board': '1', ...(init.headers ?? {}) },
  });
  const type = res.headers.get('content-type') ?? '';
  const body: unknown = type.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const msg = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new ApiError(serverText(msg), res.status);
  }
  return body as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  patch: <T>(url: string, body: unknown) => request<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) => request<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
};
