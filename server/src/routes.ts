import { Express } from 'express';
import authRouter from './modules/auth/router';
import agentsRouter from './modules/agents/router';
import publicRouter from './modules/public/router';
import leadsRouter from './modules/leads/router';
import teamRouter from './modules/team/router';
import billingRouter from './modules/billing/router';
import analyticsRouter from './modules/analytics/router';
import approvalsRouter from './modules/approvals/router';
import workflowsRouter from './modules/workflows/router';
import prisma from './lib/prisma';
import { authMiddleware } from './middleware/auth';
import { requirePermission } from './middleware/authz';
import { audit } from './lib/audit';
import { asyncHandler } from './middleware/asyncHandler';
import { TEMPLATES } from './lib/templates';
import { listAdapters } from './channels/registry';
import { workflowEnabled, monitorEnabled, outboundEnabled, memoryEnabled } from './lib/spineEnv';

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
  // Server-authoritative feature flags so the UI only surfaces a scenario when its handler
  // is actually enabled (no dead-end controls). SCN-36 scenario flags + the spine flag.
  app.get('/api/config', authMiddleware, (_req, res) =>
    res.json({ features: { workflow: workflowEnabled(), monitor: monitorEnabled(), outbound: outboundEnabled(), memory: memoryEnabled() } }),
  );

  // SEC — connected integration credentials (masked; never returns a secret). Owner can revoke.
  app.get('/api/connected-accounts', authMiddleware, asyncHandler(async (req, res) => {
    const { listAccounts } = await import('./lib/connectedAccount');
    res.json({ accounts: await listAccounts((req as any).user.orgId) });
  }));
  app.delete('/api/connected-accounts/:id', authMiddleware, requirePermission('connected_accounts'), asyncHandler(async (req, res) => {
    const { revokeAccount } = await import('./lib/connectedAccount');
    const ok = await revokeAccount((req as any).user.orgId, String(req.params.id));
    if (!ok) return res.status(404).json({ error: 'not found' });
    audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'connected_account.revoke', targetType: 'connected_account', targetId: String(req.params.id) });
    res.json({ ok: true });
  }));
  app.get('/api/templates', authMiddleware, (_req, res) =>
    res.json(TEMPLATES.map((t) => ({ id: t.id, label: t.label, emoji: t.emoji }))),
  );
  // STU-17: the channel catalog is generated from the adapter registry (kills the
  // hardcoded client channel list). 'test' (a test-only adapter) is excluded.
  app.get('/api/channels', authMiddleware, (_req, res) =>
    res.json({
      channels: listAdapters()
        .filter((a) => a.type !== 'test')
        .map((a) => ({
          type: a.type, label: a.label || a.type, blurb: a.blurb || '',
          onboarding: a.onboarding, ready: a.ready !== false, capabilities: a.capabilities || [],
        })),
    }),
  );
  app.use('/api/agents', authMiddleware, agentsRouter);
  app.use('/api/leads', authMiddleware, leadsRouter);
  app.use('/api/team', authMiddleware, teamRouter);
  app.use('/api/billing', authMiddleware, billingRouter);
  app.use('/api/analytics', authMiddleware, analyticsRouter);
  app.use('/api/approvals', authMiddleware, approvalsRouter);
  app.use('/api/workflows', authMiddleware, workflowsRouter);

  // Workspace (org) info + rename.
  app.get('/api/org', authMiddleware, asyncHandler(async (req, res) => {
    const org = await prisma.org.findUnique({ where: { id: (req as any).user.orgId }, include: { subscription: true } });
    res.json({ id: org?.id, name: org?.name, plan: org?.subscription?.plan, maxAgents: org?.subscription?.maxAgents });
  }));
  app.patch('/api/org', authMiddleware, requirePermission('org_admin'), asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const org = await prisma.org.update({ where: { id: (req as any).user.orgId }, data: { name } });
    audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'org.rename', metadata: { name }, ip: req.ip });
    res.json({ id: org.id, name: org.name });
  }));

  // POL-15: owner-only audit trail.
  app.get('/api/audit', authMiddleware, requirePermission('audit_view'), asyncHandler(async (req, res) => {
    const rows = await prisma.auditLog.findMany({
      where: { orgId: (req as any).user.orgId }, orderBy: { createdAt: 'desc' }, take: 100,
    });
    res.json({ events: rows });
  }));
}
