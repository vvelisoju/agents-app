// QA-03 — reusable DB fixtures for tests. One place to build an org/agent/training
// so every test reads the same shape and future schema changes touch one file.
import { Prisma } from '@prisma/client';
import prisma from '../../src/lib/prisma';

export function createOrg(name = 'Test Org') {
  return prisma.org.create({ data: { name } });
}

/** Create an agent (defaults to the capturing 'test' channel) + an empty TrainingProfile. */
export async function createAgent(
  orgId: string,
  data: Partial<Omit<Prisma.AgentUncheckedCreateInput, 'orgId'>> = {},
) {
  const agent = await prisma.agent.create({
    data: { orgId, name: 'Biz', channelType: 'test', autoSend: true, ...data },
  });
  await prisma.trainingProfile.create({ data: { agentId: agent.id } });
  return agent;
}

export function addSource(
  agentId: string,
  type: 'fact' | 'link' | 'faq',
  data: Record<string, unknown>,
  enabled = true,
) {
  return prisma.trainingSource.create({
    data: { agentId, type, dataJson: JSON.stringify(data), enabled },
  });
}

/** Convenience: an org + one agent in one call. */
export async function createOrgWithAgent(agentData: Partial<Omit<Prisma.AgentUncheckedCreateInput, 'orgId'>> = {}) {
  const org = await createOrg();
  const agent = await createAgent(org.id, agentData);
  return { org, agent };
}
