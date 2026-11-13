// =============================================================
// src/realtime.ts — WebSocket hub. The server pushes per-agent
// events (qr, status, message) to any browser subscribed to that
// agent. (Skeleton: no per-socket auth yet — see docs/BACKLOG.md.)
// =============================================================
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

const subs = new Map<string, Set<WebSocket>>(); // agentId -> sockets

export function emit(agentId: string, type: string, payload: any) {
  const set = subs.get(agentId);
  if (!set) return;
  const msg = JSON.stringify({ agentId, type, payload });
  for (const ws of set) {
    try { if (ws.readyState === ws.OPEN) ws.send(msg); } catch { /* ignore */ }
  }
}

export function attachWs(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString());
        if (m.subscribe) {
          if (!subs.has(m.subscribe)) subs.set(m.subscribe, new Set());
          subs.get(m.subscribe)!.add(ws);
        }
      } catch { /* ignore malformed */ }
    });
    ws.on('close', () => {
      for (const set of subs.values()) set.delete(ws);
    });
  });
  return wss;
}
