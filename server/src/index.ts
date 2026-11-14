// Server boot: wrap the Express app with http + WebSocket, register the WhatsApp
// channel, and restore sessions that were connected before a restart.
require('dotenv').config();
import http from 'http';
import prisma from './lib/prisma';
import { buildApp } from './app';
import { attachWs } from './lib/realtime';
import { assertProdSecrets } from './lib/env';
import './channels/whatsapp'; // register the WhatsApp adapter
import * as wa from './channels/whatsapp';
import { startSpine, stopSpine } from './jobs/spine'; // EWS-14: Phase-5 spine (gated by WORKFLOW_ENABLED)

assertProdSecrets(); // SEC-17: die loudly in prod if a required secret is missing
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
  // EWS-14: start the workflow spine only when explicitly enabled (default off).
  if (startSpine()) console.log('   ⚙️  Workflow spine enabled (runner + scheduler).');
});

// EWS-14: on redeploy, stop the tickers and release held leases so no job is stranded.
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await stopSpine();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
