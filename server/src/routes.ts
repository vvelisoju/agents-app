import { Express } from 'express';
import authRouter from './modules/auth/router';
import agentsRouter from './modules/agents/router';
import publicRouter from './modules/public/router';
import leadsRouter from './modules/leads/router';
import teamRouter from './modules/team/router';
import billingRouter from './modules/billing/router';
import analyticsRouter from './modules/analytics/router';
import prisma from './lib/prisma';
import { authMiddleware } from './middleware/auth';
import { asyncHandler } from './middleware/asyncHandler';
import { TEMPLATES } from './lib/templates';

// Mount every API module. One aggregator (ClassPe pattern).
export function registerRoutes(app: Express) {
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  // MGW-14/OBS-15: readiness — returns 503 if the DB is unreachable (liveness vs readiness).
  app.get('/api/health/ready', asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ready: true, db: true });
    } catch {
      res.status(503).json({ ready: false, db: false });
    }
  }));
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.get('/api/me', authMiddleware, asyncHandler(async (req, res) =>
    res.json({ phone: (req as any).user.phone, orgId: (req as any).user.orgId, role: (req as any).user.role }),
  ));
  app.get('/api/templates', authMiddleware, (_req, res) =>
    res.json(TEMPLATES.map((t) => ({ id: t.id, label: t.label, emoji: t.emoji }))),
  );
  app.use('/api/agents', authMiddleware, agentsRouter);
  app.use('/api/leads', authMiddleware, leadsRouter);
  app.use('/api/team', authMiddleware, teamRouter);
  app.use('/api/billing', authMiddleware, billingRouter);
  app.use('/api/analytics', authMiddleware, analyticsRouter);

  // Workspace (org) info + rename.
  app.get('/api/org', authMiddleware, asyncHandler(async (req, res) => {
    const org = await prisma.org.findUnique({ where: { id: (req as any).user.orgId }, include: { subscription: true } });
    res.json({ id: org?.id, name: org?.name, plan: org?.subscription?.plan, maxAgents: org?.subscription?.maxAgents });
  }));
  app.patch('/api/org', authMiddleware, asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const org = await prisma.org.update({ where: { id: (req as any).user.orgId }, data: { name } });
    res.json({ id: org.id, name: org.name });
  }));
}
