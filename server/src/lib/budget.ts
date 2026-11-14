// Per-tenant daily spend gate. Every model reply writes a UsageEvent; this caps how
// many a tenant may send per calendar day (local time) based on their plan. Pure
// prisma reads — it never writes, so it's safe to call before the model gateway.
import prisma from './prisma';

// Daily reply cap per plan id. Keyed by Subscription.plan ('free' is the default).
export const DAILY_MESSAGE_CAP_BY_PLAN: Record<string, number> = {
  free: 200,
  growth: 2000,
  pro: 10000,
};

const DEFAULT_PLAN = 'free';

/** Start of the current day in the server's local timezone (midnight). */
function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface SpendCheck {
  allowed: boolean; // false once used >= cap for the day
  used: number;     // UsageEvent rows for this org since local midnight
  cap: number;      // the org's plan daily cap
}

/**
 * Whether this org may send another reply today. Counts today's UsageEvent rows and
 * compares to the plan cap. Unknown/missing plan falls back to 'free'.
 */
export async function canSpend(orgId: string): Promise<SpendCheck> {
  const sub = await prisma.subscription.findUnique({
    where: { orgId },
    select: { plan: true },
  });
  const plan = sub?.plan ?? DEFAULT_PLAN;
  const cap = DAILY_MESSAGE_CAP_BY_PLAN[plan] ?? DAILY_MESSAGE_CAP_BY_PLAN[DEFAULT_PLAN];

  const used = await prisma.usageEvent.count({
    where: { orgId, createdAt: { gte: startOfToday() } },
  });

  return { allowed: used < cap, used, cap };
}
