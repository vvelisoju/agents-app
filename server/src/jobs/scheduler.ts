// EWS-13 — the cron/schedule ticker. Evaluates due cron-Triggers and enqueues their jobs; it
// never runs handlers itself (the runner does). The idempotencyKey is minute-bucketed so two
// overlapping ticks (or a slow tick) can't double-enqueue the same slot. Generalizes the
// persisted-timer idiom (ALERT_COOLDOWN_MS/alertedAt) to arbitrary cron expressions.
import prisma from '../lib/prisma';
import { enqueueJob } from './enqueue';
import { cronNext } from './cron';

export async function tickCron(now: Date = new Date()): Promise<{ enqueued: number }> {
  const triggers = await prisma.trigger.findMany({ where: { enabled: true, kind: 'cron' } });
  let enqueued = 0;

  for (const t of triggers) {
    // First evaluation (nextRunAt null) fires now; otherwise fire once nextRunAt is due.
    const due = t.nextRunAt == null || t.nextRunAt <= now;
    if (!due) continue;

    const slot = t.nextRunAt ?? now;
    const bucket = slot.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm → one job per minute-slot
    const job = await enqueueJob({
      orgId: t.orgId,
      handlerName: t.handlerName,
      idempotencyKey: `cron:${t.id}:${bucket}`,
      state: { triggerId: t.id, agentId: t.agentId, scheduledFor: slot.toISOString() },
    });
    if (job) enqueued++;

    const next = cronNext(t.cronExpr || '*/5 * * * *', now);
    await prisma.trigger.update({ where: { id: t.id }, data: { nextRunAt: next } });
  }
  return { enqueued };
}
