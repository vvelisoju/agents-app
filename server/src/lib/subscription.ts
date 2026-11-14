// Shared plan-application used by both the billing router (/verify, dev /subscribe)
// and the Razorpay webhook (FND-20), so the two can never drift.
import prisma from './prisma';
import { getPlan } from './plans';

export async function applyPlan(orgId: string, planId: string) {
  const plan = getPlan(planId);
  if (!plan) return null;
  return prisma.subscription.update({
    where: { orgId },
    data: { plan: plan.id, maxAgents: plan.maxAgents, status: 'active' },
  });
}
