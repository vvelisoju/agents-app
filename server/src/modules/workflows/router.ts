// EWS-18/19 — Runs read + control API. Org-scoped list + run detail (with step timeline) and
// idempotent pause/resume/cancel/approve, gated by the Phase-3 authz chokepoint.
import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requirePermission } from '../../middleware/authz';
import { listRuns, getRun, controlRun, spineMetrics, type ControlAction } from './service';

const router = Router();
const u = (req: any) => req.user;

// GET /api/workflows?status=&agentId=&limit=
router.get('/', asyncHandler(async (req, res) => {
  const runs = await listRuns(u(req).orgId, {
    status: req.query.status ? String(req.query.status) : undefined,
    agentId: req.query.agentId ? String(req.query.agentId) : undefined,
    limit: req.query.limit ? Math.min(500, Number(req.query.limit)) : undefined,
  });
  res.json({ runs });
}));

// GET /api/workflows/metrics — spine queue/DLQ/run metrics (must precede /:runId).
router.get('/metrics', asyncHandler(async (req, res) => {
  res.json(await spineMetrics(u(req).orgId));
}));

// GET /api/workflows/:runId — run + ordered step timeline (cross-tenant → 404).
router.get('/:runId', asyncHandler(async (req, res) => {
  const found = await getRun(u(req).orgId, String(req.params.runId));
  if (!found) return res.status(404).json({ error: 'not found' });
  res.json(found);
}));

// POST /api/workflows/:runId/:action — pause | resume | cancel | approve.
const ACTIONS = new Set<ControlAction>(['pause', 'resume', 'cancel', 'approve']);
router.post('/:runId/:action', requirePermission('approve'), asyncHandler(async (req, res) => {
  const action = String(req.params.action) as ControlAction;
  if (!ACTIONS.has(action)) return res.status(400).json({ error: 'unknown action' });
  const r = await controlRun(u(req).orgId, String(req.params.runId), action, u(req).id);
  if (r.ok) return res.json({ ok: true, run: r.run, changed: r.changed });
  return res.status(r.reason === 'not_found' ? 404 : 409).json({ error: r.reason, status: r.status });
}));

export default router;
