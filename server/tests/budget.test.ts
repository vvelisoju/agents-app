// Per-tenant daily spend gate — canSpend flips allowed=false once the plan cap is hit.
import { describe, it, expect } from 'vitest';
import prisma from '../src/lib/prisma';
import { canSpend, DAILY_MESSAGE_CAP_BY_PLAN } from '../src/lib/budget';
import { createOrgWithAgent } from './helpers/factories';

/** Insert n UsageEvent rows for this org/agent, all stamped today. */
async function seedUsage(orgId: string, agentId: string, n: number) {
  await prisma.usageEvent.createMany({
    data: Array.from({ length: n }, () => ({ orgId, agentId, type: 'reply' })),
  });
}

describe('budget gate (canSpend)', () => {
  it('allows while under the plan cap and blocks at the cap', async () => {
    const { org, agent } = await createOrgWithAgent();
    await prisma.subscription.create({ data: { orgId: org.id, plan: 'free' } });
    const cap = DAILY_MESSAGE_CAP_BY_PLAN.free;

    // Fresh org: nothing used yet.
    let check = await canSpend(org.id);
    expect(check).toEqual({ allowed: true, used: 0, cap });

    // One below the cap — still allowed.
    await seedUsage(org.id, agent.id, cap - 1);
    check = await canSpend(org.id);
    expect(check.used).toBe(cap - 1);
    expect(check.allowed).toBe(true);

    // The row that reaches the cap flips it off.
    await seedUsage(org.id, agent.id, 1);
    check = await canSpend(org.id);
    expect(check.used).toBe(cap);
    expect(check.allowed).toBe(false);
  });

  it('defaults to the free cap when the org has no subscription', async () => {
    const { org } = await createOrgWithAgent();
    const check = await canSpend(org.id);
    expect(check.cap).toBe(DAILY_MESSAGE_CAP_BY_PLAN.free);
    expect(check.allowed).toBe(true);
  });

  it('uses the higher growth cap for a growth plan', async () => {
    const { org } = await createOrgWithAgent();
    await prisma.subscription.create({ data: { orgId: org.id, plan: 'growth' } });
    const check = await canSpend(org.id);
    expect(check.cap).toBe(DAILY_MESSAGE_CAP_BY_PLAN.growth);
  });
});
