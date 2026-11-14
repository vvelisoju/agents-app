// WebSocket hub. The server pushes per-agent events (qr, status, message, alert) to
// browsers subscribed to that agent.
//
// FND-10: a socket may ONLY subscribe to an agent whose org the authenticated user
// owns. Previously any client could {subscribe:<agentId>} and receive that agent's
// QR code (account-takeover) and all messages (cross-tenant leak). The subscribe
// message must now carry the caller's bearer token, which is verified before any
// events flow.
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import prisma from './prisma';

const subs = new Map<string, Set<WebSocket>>(); // agentId -> sockets

export function emit(agentId: string, type: string, payload: any) {
  const set = subs.get(agentId);
  if (!set) return;
  const msg = JSON.stringify({ agentId, type, payload });
  for (const ws of set) {
    try { if (ws.readyState === ws.OPEN) ws.send(msg); } catch { /* ignore */ }
  }
}

/** The subscription authorization decision: does this token's user own this agent's org? */
export async function userOwnsAgent(token: string, agentId: string): Promise<boolean> {
  if (!token || !agentId) return false;
  const user = await prisma.user.findUnique({ where: { token }, select: { orgId: true } });
  if (!user) return false;
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
  return !!agent && agent.orgId === user.orgId;
}

export function attachWs(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
      let m: any;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || !m.subscribe) return;

      const agentId = String(m.subscribe);
      const ok = await userOwnsAgent(String(m.token || ''), agentId);
      if (!ok) {
        // Tell the client (so it can stop reconnecting / log out) then close.
        try { ws.send(JSON.stringify({ agentId, type: 'unauthorized', payload: {} })); } catch { /* ignore */ }
        try { ws.close(4401, 'unauthorized'); } catch { /* ignore */ }
        return;
      }
      if (!subs.has(agentId)) subs.set(agentId, new Set());
      subs.get(agentId)!.add(ws);
    });
    ws.on('close', () => { for (const set of subs.values()) set.delete(ws); });
  });
  return wss;
}
