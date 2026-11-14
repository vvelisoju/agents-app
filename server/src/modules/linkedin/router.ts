// LKD-1 (Wave 1) — LinkedIn agent API (owner-operated). Mounted at /api/linkedin behind auth.
//
// Connect = paste your session cookie (stored encrypted); actions = draft a post/comment/reshare
// that waits for your approval; approve = release it to the worker on your machine. Secrets are
// write-only and never returned. See docs/LINKEDIN_AGENT_PLAN.md.
import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requirePermission } from '../../middleware/authz';
import { audit } from '../../lib/audit';
import { saveSession, getSessionStatus, clearSession } from '../../lib/linkedin/session';
import { createAction, listActions, approveAction, cancelAction } from './service';
import { createWatch, listWatches, updateWatch, deleteWatch } from './monitorService';
import { createJobSearch, listJobSearches, getJobSearch } from './jobService';
import prisma from '../../lib/prisma';

const router = Router();
const u = (req: any) => req.user;
const credGate = requirePermission('connected_accounts'); // connecting a session = a credential
const editGate = requirePermission('train_edit');          // drafting/approving = agent config

async function assertOwnedAgent(orgId: string, agentId: string): Promise<boolean> {
  const a = await prisma.agent.findFirst({ where: { id: agentId, orgId }, select: { id: true } });
  return !!a;
}

// Connect / re-link: paste the li_at session cookie (any accepted format).
router.post('/:agentId/connect', credGate, asyncHandler(async (req, res) => {
  const agentId = String(req.params.agentId);
  if (!(await assertOwnedAgent(u(req).orgId, agentId))) return res.status(404).json({ error: 'agent not found' });
  const saved = await saveSession(u(req).orgId, agentId, String(req.body?.cookie || ''));
  if (!saved.ok) return res.status(400).json({ error: 'error' in saved ? saved.error : 'invalid session cookie' });
  audit({ orgId: u(req).orgId, actorUserId: u(req).id, action: 'linkedin.connect', targetType: 'agent', targetId: agentId });
  res.json({ ok: true, status: 'active' });
}));

router.get('/:agentId/status', asyncHandler(async (req, res) => {
  const agentId = String(req.params.agentId);
  if (!(await assertOwnedAgent(u(req).orgId, agentId))) return res.status(404).json({ error: 'agent not found' });
  res.json({ status: await getSessionStatus(u(req).orgId, agentId) });
}));

router.post('/:agentId/disconnect', credGate, asyncHandler(async (req, res) => {
  const agentId = String(req.params.agentId);
  if (!(await assertOwnedAgent(u(req).orgId, agentId))) return res.status(404).json({ error: 'agent not found' });
  await clearSession(u(req).orgId, agentId);
  audit({ orgId: u(req).orgId, actorUserId: u(req).id, action: 'linkedin.disconnect', targetType: 'agent', targetId: agentId });
  res.json({ ok: true, status: 'none' });
}));

// Draft an action (post | comment | reshare). It waits in pending_approval — nothing is published yet.
router.post('/:agentId/actions', editGate, asyncHandler(async (req, res) => {
  const agentId = String(req.params.agentId);
  try {
    const action = await createAction(u(req).orgId, agentId, String(req.body?.kind || ''), req.body || {});
    audit({ orgId: u(req).orgId, actorUserId: u(req).id, action: 'linkedin.action_create', targetType: 'linkedin_action', targetId: action.id, metadata: { kind: action.kind } });
    res.json({ action });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: e?.message || 'could not create the action' });
  }
}));

router.get('/:agentId/actions', asyncHandler(async (req, res) => {
  const agentId = String(req.params.agentId);
  if (!(await assertOwnedAgent(u(req).orgId, agentId))) return res.status(404).json({ error: 'agent not found' });
  res.json({ actions: await listActions(u(req).orgId, agentId) });
}));

// Approve → the worker on the owner's machine will pick it up and execute it.
router.post('/:agentId/actions/:actionId/approve', editGate, asyncHandler(async (req, res) => {
  try {
    const action = await approveAction(u(req).orgId, String(req.params.actionId));
    audit({ orgId: u(req).orgId, actorUserId: u(req).id, action: 'linkedin.action_approve', targetType: 'linkedin_action', targetId: action.id });
    res.json({ action });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: e?.message || 'could not approve the action' });
  }
}));

router.post('/:agentId/actions/:actionId/cancel', editGate, asyncHandler(async (req, res) => {
  try {
    res.json({ action: await cancelAction(u(req).orgId, String(req.params.actionId)) });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: e?.message || 'could not cancel the action' });
  }
}));

// ── LKD-2: watched people (e.g. your boss) → the monitor drafts a reaction on each new post ──
router.get('/:agentId/watches', asyncHandler(async (req, res) => {
  const agentId = String(req.params.agentId);
  if (!(await assertOwnedAgent(u(req).orgId, agentId))) return res.status(404).json({ error: 'agent not found' });
  res.json({ watches: await listWatches(u(req).orgId, agentId) });
}));

router.post('/:agentId/watches', editGate, asyncHandler(async (req, res) => {
  try {
    const watch = await createWatch(u(req).orgId, String(req.params.agentId), { profileUrl: req.body?.profileUrl, label: req.body?.label, reaction: req.body?.reaction });
    audit({ orgId: u(req).orgId, actorUserId: u(req).id, action: 'linkedin.watch_create', targetType: 'linkedin_watch', targetId: watch.id });
    res.json({ watch });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: e?.message || 'could not add the watch' });
  }
}));

router.patch('/:agentId/watches/:watchId', editGate, asyncHandler(async (req, res) => {
  try {
    res.json({ watch: await updateWatch(u(req).orgId, String(req.params.watchId), { active: req.body?.active, reaction: req.body?.reaction, label: req.body?.label }) });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: e?.message || 'could not update the watch' });
  }
}));

router.delete('/:agentId/watches/:watchId', editGate, asyncHandler(async (req, res) => {
  const ok = await deleteWatch(u(req).orgId, String(req.params.watchId));
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));

// ── LKD-3: job searches (read-only). Request a search; the worker runs it and stores a digest. ──
router.post('/:agentId/jobs', editGate, asyncHandler(async (req, res) => {
  try {
    const search = await createJobSearch(u(req).orgId, String(req.params.agentId), { query: req.body?.query, location: req.body?.location });
    audit({ orgId: u(req).orgId, actorUserId: u(req).id, action: 'linkedin.job_search_create', targetType: 'linkedin_job_search', targetId: search.id });
    res.json({ search });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: e?.message || 'could not start the job search' });
  }
}));

router.get('/:agentId/jobs', asyncHandler(async (req, res) => {
  const agentId = String(req.params.agentId);
  if (!(await assertOwnedAgent(u(req).orgId, agentId))) return res.status(404).json({ error: 'agent not found' });
  res.json({ searches: await listJobSearches(u(req).orgId, agentId) });
}));

router.get('/:agentId/jobs/:searchId', asyncHandler(async (req, res) => {
  try {
    res.json({ search: await getJobSearch(u(req).orgId, String(req.params.searchId)) });
  } catch (e: any) {
    res.status(e?.status || 404).json({ error: e?.message || 'not found' });
  }
}));

export default router;
