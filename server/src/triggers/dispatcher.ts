// EWS-09 — outbox drain + event→trigger matching. Reads unprocessed DomainEvents, matches
// enabled event-Triggers by type and a shallow filter, enqueues one Job per match with a
// derived idempotencyKey (so re-draining the same event enqueues nothing), then marks the
// event processed. event.data is treated as opaque (EWS-20): it is matched and stored, never
// concatenated into a prompt.
import prisma from '../lib/prisma';
import { enqueueJob } from '../jobs/enqueue';

function parse(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return {}; }
}

// A trigger matches when every key in its filter equals the event's data (or subject).
// An empty filter matches any event of the right type.
export function matchesFilter(filterJson: string, event: { subject: string | null; dataJson: string }): boolean {
  const filter = parse(filterJson);
  const keys = Object.keys(filter);
  if (!keys.length) return true;
  const data = parse(event.dataJson);
  return keys.every((k) => (k === 'subject' ? event.subject === filter[k] : data[k] === filter[k]));
}

export async function drainEvents(limit = 50): Promise<{ processed: number; enqueued: number }> {
  const events = await prisma.domainEvent.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let enqueued = 0;
  for (const ev of events) {
    const triggers = await prisma.trigger.findMany({
      where: { enabled: true, kind: 'event', eventType: ev.type },
    });
    for (const t of triggers) {
      if (t.orgId !== ev.orgId) continue; // tenant isolation (EWS-20)
      if (!matchesFilter(t.filterJson, ev)) continue;
      const job = await enqueueJob({
        orgId: ev.orgId,
        handlerName: t.handlerName,
        idempotencyKey: `trig:${t.id}:ev:${ev.id}`,
        state: { triggerId: t.id, agentId: t.agentId, eventId: ev.id, eventType: ev.type, data: parse(ev.dataJson) },
      });
      if (job) enqueued++;
    }
    await prisma.domainEvent.update({ where: { id: ev.id }, data: { processedAt: new Date() } });
  }
  return { processed: events.length, enqueued };
}
