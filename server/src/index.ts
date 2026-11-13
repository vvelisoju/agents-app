// Server boot: wrap the Express app with http + WebSocket, register the WhatsApp
// channel, and restore sessions that were connected before a restart.
require('dotenv').config();
import http from 'http';
import prisma from './lib/prisma';
import { buildApp } from './app';
import { attachWs } from './lib/realtime';
import './channels/whatsapp'; // register the WhatsApp adapter
import * as wa from './channels/whatsapp';

const app = buildApp();
const server = http.createServer(app);
attachWs(server);

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, async () => {
  console.log(`\n✅ Server listening on http://localhost:${PORT}  (API at /api)`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('   ⚠️  ANTHROPIC_API_KEY not set — replies/learn will fail until you add it to server/.env');
  try {
    const connected = await prisma.agent.findMany({ where: { status: 'connected', channelType: 'whatsapp-web' }, select: { id: true } });
    if (connected.length) {
      console.log(`Restoring ${connected.length} WhatsApp session(s)...`);
      wa.restoreSessions(connected.map((a) => a.id));
    }
  } catch (e: any) {
    console.error('session restore error:', e?.message || e);
  }
});
