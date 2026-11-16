// Sessões de agentes ao vivo via SSE (/events), com reconexão automática do EventSource
// e aviso no desktop quando uma sessão passa a precisar de você ou fica pronta para revisar.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import type { AgentSession } from '@/lib/types';

export type ConnState = 'connecting' | 'live' | 'reconnecting';

export interface AgentSessionsValue {
  sessions: AgentSession[];
  conn: ConnState;
  /** IDs que acabaram de mudar para needs_you/review (para destacar o card). */
  flashed: Set<string>;
}

export const AgentSessionsContext = createContext<AgentSessionsValue>({ sessions: [], conn: 'connecting', flashed: new Set() });
export const useAgentSessionsContext = () => useContext(AgentSessionsContext);

const LOUD = new Set(['needs_you', 'review']);

export function useAgentSessionsStream(notify: boolean): AgentSessionsValue {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [flashed, setFlashed] = useState<Set<string>>(new Set());
  const previous = useRef<Map<string, string> | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    const es = new EventSource('/events');
    es.onopen = () => setConn('live');
    es.onerror = () => setConn('reconnecting');
    es.onmessage = (e: MessageEvent<string>) => {
      let next: AgentSession[];
      try { next = JSON.parse(e.data) as AgentSession[]; } catch { return; }
      setSessions(next);

      const before = previous.current;
      if (before) {
        const loud = next.filter(s => LOUD.has(s.state) && before.get(s.id) !== undefined && before.get(s.id) !== s.state);
        if (loud.length) {
          setFlashed(new Set(loud.map(s => s.id)));
          window.setTimeout(() => setFlashed(new Set()), 2400);
          if (notifyRef.current && 'Notification' in window && Notification.permission === 'granted') {
            for (const s of loud) {
              new Notification(`${s.project ?? t('Agente')}: ${t(s.state === 'needs_you' ? 'precisa de você' : 'pronto para revisar')}`, {
                body: s.message || s.title || s.task || '',
                tag: s.id,
              });
            }
          }
        }
      }
      previous.current = new Map(next.map(s => [s.id, s.state]));
    };
    return () => es.close();
  }, []);

  return { sessions, conn, flashed };
}
