// Protections for a server that only exists on localhost (inherited from v2):
// - A fixed Host blocks DNS rebinding (an external site resolving to 127.0.0.1);
// - writes require the X-Agent-Board header, which no website can send without a CORS preflight,
//   and a local Origin (the server never answers preflights, so the browser blocks the rest).

export const HOST = '127.0.0.1' as const; // not configurable: project rule

export interface GuardInput {
  method: string;
  host: string | undefined;
  origin: string | undefined;
  marker: string | undefined;
}

export function makeGuard(ports: number[]) {
  const portAlt = ports.map(String).join('|');
  const localHost = new RegExp(`^(127\\.0\\.0\\.1|localhost):(${portAlt})$`);
  const localOrigin = new RegExp(`^http://(127\\.0\\.0\\.1|localhost):(${portAlt})$`);

  return function allowed({ method, host, origin, marker }: GuardInput): boolean {
    if (!localHost.test(host ?? '')) return false;
    if (method === 'GET' || method === 'HEAD') return true;
    if (marker !== '1') return false;
    return !origin || localOrigin.test(origin);
  };
}
