// QA-03 — reusable DB fixtures for tests. One place to build an org/agent/training
// so every test reads the same shape and future schema changes touch one file.
import { Prisma } from '@prisma/client';
import prisma from '../../src/lib/prisma';
import { newToken } from '../../src/middleware/auth';

export function createOrg(name = 'Test Org') {
  return prisma.org.create({ data: { name } });
}

let userSeq = 0;
/** A user with a bearer token, for auth-scoped tests (WS, RBAC, …). */
export function createUser(orgId: string, role = 'owner') {
  const phone = '9' + (String(Date.now()).slice(-6) + String(userSeq++).padStart(3, '0')).slice(-9);
  return prisma.user.create({ data: { orgId, phone, passwordHash: 'x', token: newToken(), role } });
}

/** Create an agent (defaults to the capturing 'test' channel) + an empty TrainingProfile. */
export async function createAgent(
  orgId: string,
  data: Partial<Omit<Prisma.AgentUncheckedCreateInput, 'orgId'>> = {},
) {
  const agent = await prisma.agent.create({
    data: { orgId, name: 'Biz', channelType: 'test', autoSend: true, ...data },
  });
  await prisma.trainingProfile.create({ data: { agentId: agent.id, orgId } });
  return agent;
}

export async function addSource(
  agentId: string,
  type: 'fact' | 'link' | 'faq',
  data: Record<string, unknown>,
  enabled = true,
) {
  // Mirror the real write path (agents router), which stamps orgId for tenant scoping.
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
  return prisma.trainingSource.create({
    data: { agentId, orgId: agent?.orgId ?? null, type, dataJson: JSON.stringify(data), enabled },
  });
}

/** Convenience: an org + one agent in one call. */
export async function createOrgWithAgent(agentData: Partial<Omit<Prisma.AgentUncheckedCreateInput, 'orgId'>> = {}) {
  const org = await createOrg();
  const agent = await createAgent(org.id, agentData);
  return { org, agent };
}
