// Connector management API — owner-only (credentials). Secrets are write-only (never returned).
import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requirePermission } from '../../middleware/authz';
import { audit } from '../../lib/audit';
import { createConnector, listConnectors, deleteConnector, addOp, listOps, deleteOp } from './service';

const router = Router();
const u = (req: any) => req.user;
const gate = requirePermission('connected_accounts');

router.get('/', asyncHandler(async (req, res) => {
  res.json({ connectors: await listConnectors(u(req).orgId) });
}));

router.post('/', gate, asyncHandler(async (req, res) => {
  try {
    const c = await createConnector(u(req).orgId, { name: req.body?.name, kind: String(req.body?.kind || ''), secret: String(req.body?.secret || '') });
    audit({ orgId: u(req).orgId, actorUserId: u(req).id, action: 'connector.create', targetType: 'connector', targetId: c.id, metadata: { kind: c.kind } });
    res.json({ id: c.id, name: c.name, kind: c.kind });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: e?.message || 'Could not create the connector' });
  }
}));

router.delete('/:id', gate, asyncHandler(async (req, res) => {
  const ok = await deleteConnector(u(req).orgId, String(req.params.id));
  if (!ok) return res.status(404).json({ error: 'not found' });
  audit({ orgId: u(req).orgId, actorUserId: u(req).id, action: 'connector.delete', targetType: 'connector', targetId: String(req.params.id) });
  res.json({ ok: true });
}));

router.post('/:id/test', gate, asyncHandler(async (req, res) => {
  const connector = await prisma.connector.findFirst({ where: { id: String(req.params.id), orgId: u(req).orgId } });
  if (!connector) return res.status(404).json({ error: 'not found' });
  const { testConnector } = await import('../../lib/connectors');
  res.json(await testConnector(connector));
}));

router.get('/:id/ops', asyncHandler(async (req, res) => {
  res.json({ ops: await listOps(u(req).orgId, String(req.params.id)) });
}));

router.post('/:id/ops', gate, asyncHandler(async (req, res) => {
  try {
    const op = await addOp(u(req).orgId, String(req.params.id), {
      name: req.body?.name, description: req.body?.description, access: req.body?.access, sideEffect: req.body?.sideEffect, spec: req.body?.spec,
    });
    audit({ orgId: u(req).orgId, actorUserId: u(req).id, action: 'connector.add_op', targetType: 'connector_op', targetId: op.id, metadata: { name: op.name, access: op.access, sideEffect: op.sideEffect } });
    res.json({ id: op.id, name: op.name });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: e?.message || 'Could not add the operation' });
  }
}));

router.delete('/ops/:opId', gate, asyncHandler(async (req, res) => {
  const ok = await deleteOp(u(req).orgId, String(req.params.opId));
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));

export default router;
