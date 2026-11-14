import * as React from 'react';
import { getToken } from '@/lib/api';

type Handler = (type: string, payload: any) => void;

// Subscribe to a single agent's realtime events (qr / status / message).
export function useAgentEvents(agentId: string | null, handler: Handler) {
  const handlerRef = React.useRef(handler);
  handlerRef.current = handler;

  React.useEffect(() => {
    if (!agentId) return;
    const base = (import.meta as any).env?.VITE_API_URL || '';
    const url = base
      ? base.replace(/^http/, 'ws') + '/ws'
      : (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws';
    let ws: WebSocket | null = null;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(url);
      // FND-11: the socket must authenticate — send the bearer token with the subscribe.
      ws.onopen = () => ws?.send(JSON.stringify({ subscribe: agentId, token: getToken() }));
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          // Server rejected the subscription (bad/expired token): stop reconnecting so
          // we don't hammer it; a REST 401 will drive the actual logout.
          if (m.type === 'unauthorized') { closed = true; ws?.close(); return; }
          if (m.agentId === agentId) handlerRef.current(m.type, m.payload);
        } catch { /* ignore */ }
      };
      ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
    };
    connect();
    return () => { closed = true; ws?.close(); };
  }, [agentId]);
}
