// Connector + operation management. Secrets are encrypted at rest and NEVER returned. An operation
// is the owner's named, parameterized SQL/endpoint; the agent can only invoke it by name.
import prisma from '../../lib/prisma';
import { encryptSecret } from '../../lib/crypto';

const KINDS = new Set(['postgres', 'mysql', 'rest']);
const ACCESS = new Set(['customer', 'admin']);
const EFFECTS = new Set(['read', 'write']);

export async function createConnector(orgId: string, input: { name: string; kind: string; secret: string }) {
  if (!KINDS.has(input.kind)) throw Object.assign(new Error('kind must be postgres, mysql or rest'), { status: 400 });
  if (!input.secret) throw Object.assign(new Error('a connection string (DB) or base config (REST) is required'), { status: 400 });
  return prisma.connector.create({ data: { orgId, name: String(input.name || 'Connector').slice(0, 80), kind: input.kind, secretEnc: encryptSecret(input.secret) } });
}

export function listConnectors(orgId: string) {
  return prisma.connector.findMany({
    where: { orgId },
    select: { id: true, name: true, kind: true, active: true, createdAt: true, _count: { select: { ops: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteConnector(orgId: string, id: string): Promise<boolean> {
  const c = await prisma.connector.findFirst({ where: { id, orgId } });
  if (!c) return false;
  await prisma.connector.delete({ where: { id: c.id } });
  return true;
}

export async function addOp(orgId: string, connectorId: string, input: { name: string; description: string; access?: string; sideEffect?: string; spec: unknown }) {
  const connector = await prisma.connector.findFirst({ where: { id: connectorId, orgId } });
  if (!connector) throw Object.assign(new Error('connector not found'), { status: 404 });
  const access = ACCESS.has(String(input.access)) ? String(input.access) : 'customer';
  const sideEffect = EFFECTS.has(String(input.sideEffect)) ? String(input.sideEffect) : 'read';
  const name = String(input.name || '').trim();
  if (!/^[a-z][a-z0-9_]{1,60}$/i.test(name)) throw Object.assign(new Error('operation name must be letters/numbers/underscores'), { status: 400 });
  if (!input.spec) throw Object.assign(new Error('spec (sql+params, or method+path+params) is required'), { status: 400 });
  return prisma.connectorOp.create({
    data: { orgId, connectorId, name, description: String(input.description || '').slice(0, 300), access, sideEffect, specJson: JSON.stringify(input.spec) },
  }).catch((e: any) => {
    if (/unique|constraint/i.test(String(e?.message))) throw Object.assign(new Error('an operation with that name already exists'), { status: 409 });
    throw e;
  });
}

export function listOps(orgId: string, connectorId: string) {
  return prisma.connectorOp.findMany({ where: { orgId, connectorId }, orderBy: { createdAt: 'asc' } });
}

export async function deleteOp(orgId: string, opId: string): Promise<boolean> {
  const op = await prisma.connectorOp.findFirst({ where: { id: opId, orgId } });
  if (!op) return false;
  await prisma.connectorOp.delete({ where: { id: op.id } });
  return true;
}
