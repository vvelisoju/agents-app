// POL-08 — approval queue API. Generalizes approve/reject beyond reply drafts.
import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requirePermission } from '../../middleware/authz';
import { listApprovals, decideApproval } from '../../policy/approvals';

const router = Router();
const u = (req: any) => req.user;

router.get('/', asyncHandler(async (req, res) => {
  const status = String(req.query.status || 'pending');
  res.json({ approvals: await listApprovals(u(req).orgId, status) });
}));

router.post('/:id/approve', requirePermission('approve'), asyncHandler(async (req, res) => {
  const r = await decideApproval(u(req).orgId, String(req.params.id), 'approved', u(req).id);
  if (!r.ok) return res.status(r.reason === 'not_found' ? 404 : 409).json({ error: r.reason, status: r.status });
  res.json(r.approval);
}));

router.post('/:id/reject', requirePermission('approve'), asyncHandler(async (req, res) => {
  const r = await decideApproval(u(req).orgId, String(req.params.id), 'rejected', u(req).id);
  if (!r.ok) return res.status(r.reason === 'not_found' ? 404 : 409).json({ error: r.reason, status: r.status });
  res.json(r.approval);
}));

export default router;
