// Builds the Express app (middleware + routes) without listening — so tests can
// import it with supertest, and index.ts can wrap it with http + WebSocket.
require('dotenv').config();
import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { registerRoutes } from './routes';
import { razorpayWebhook } from './modules/webhooks/razorpay';
import './channels/website';  // register the website adapter
import './channels/telegram'; // register the telegram adapter

// FND-19: never reflect an arbitrary Origin in production. If CORS_ORIGIN is set, use
// that allowlist; if it is unset, reflect-any is allowed only in dev — in production we
// lock to same-origin (false) instead of echoing whatever site called.
export function corsOriginFor(corsEnv: string | undefined, isProd: boolean): string[] | boolean {
  const origins = (corsEnv || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length) return origins;
  return isProd ? false : true;
}

export function buildApp() {
  const app = express();
  app.use(helmet());
  const corsOrigin = corsOriginFor(process.env.CORS_ORIGIN, process.env.NODE_ENV === 'production');
  app.use(cors({ origin: corsOrigin, credentials: true }));
  // FND-20: webhooks need the raw body for signature verification — mount BEFORE json.
  app.post('/api/webhooks/razorpay', express.raw({ type: '*/*' }), razorpayWebhook);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false }));
  // Tighter limit on auth to slow brute force (relaxed under test).
  const authMax = process.env.NODE_ENV === 'test' ? 1000 : 20;
  app.use('/api/auth', rateLimit({ windowMs: 60_000, max: authMax, standardHeaders: true, legacyHeaders: false }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  registerRoutes(app);

  // Unknown API routes return JSON (not Express's default HTML).
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('API error:', err?.message || err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}
