// Proteções de um servidor que só existe em localhost (herdadas do v2):
// - Host fixo bloqueia DNS rebinding (um site externo resolvendo para 127.0.0.1);
// - escritas exigem o cabeçalho X-Agent-Board, que nenhum site consegue enviar sem preflight CORS,
//   e Origin local (o servidor nunca responde a preflight, então o navegador barra o resto).

export const HOST = '127.0.0.1' as const; // não configurável: regra do projeto

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
