// SCN-28 — scheduled website monitor handler, registered on the spine. Each tick: load the
// Watch behind the firing Trigger, fetch (SSRF-guarded) + snapshot + hash, and notify only on
// a real change. The first run just stores the baseline (lastHash null → no notify). Gated by
// MONITOR_ENABLED: off → the handler is a benign no-op even if a Watch/Trigger exists.
import prisma from '../../lib/prisma';
import { registerWorkflow } from '../registry';
import { Step, type WorkflowHandler } from '../types';
import { monitorEnabled } from '../../lib/spineEnv';
import { snapshot, diffSummary } from '../../lib/monitor';
import { notify } from '../../lib/notify';

export const MONITOR_HANDLER = 'scheduled-monitor';

const handler: WorkflowHandler = async (ctx) => {
  if (!monitorEnabled()) return Step.complete({ skipped: 'monitor_disabled' });

  const triggerId = ctx.state.triggerId as string | undefined;
  const trigger = triggerId ? await prisma.trigger.findUnique({ where: { id: triggerId } }) : null;
  if (!trigger) return Step.complete({ skipped: 'no_trigger' });

  let watchId: string | undefined;
  try { watchId = JSON.parse(trigger.filterJson || '{}').watchId; } catch { /* ignore */ }
  const watch = watchId ? await prisma.watch.findFirst({ where: { id: watchId, orgId: trigger.orgId } }) : null;
  if (!watch || !watch.active) return Step.complete({ skipped: 'no_active_watch' });

  let snap;
  try {
    snap = await snapshot(watch.url);
  } catch (e: any) {
    // Transient fetch/SSRF failure → retry with backoff (handled by the runner). A permanently
    // bad URL simply keeps retrying until maxAttempts then dead-letters this one job; the next
    // scheduled tick enqueues a fresh job, so the watch is self-healing.
    return Step.retry(5 * 60_000, `fetch failed: ${String(e?.message || e)}`);
  }

  const changed = !!watch.lastHash && watch.lastHash !== snap.hash;
  const summary = changed ? diffSummary(watch.lastSnapshot || '', snap.text) : null;

  await prisma.watch.update({
    where: { id: watch.id },
    data: {
      lastHash: snap.hash,
      lastSnapshot: snap.text,
      lastCheckedAt: new Date(),
      ...(changed ? { lastChangedAt: new Date(), lastChangeNote: summary } : {}),
    },
  });

  if (changed && summary) {
    const agent = await prisma.agent.findUnique({ where: { id: watch.agentId } });
    const to = watch.notifyNumber || agent?.alertNumber || '';
    const label = watch.label || watch.url;
    await notify(watch.agentId, agent?.channelType || 'whatsapp-web', to, `🔔 Update on ${label}:\n${summary}\n${watch.url}`);
    ctx.log(`change detected on ${label}`, { summary });
    await ctx.emit('watch.changed', { watchId: watch.id, url: watch.url });
  } else {
    ctx.log(watch.lastHash ? 'no change' : 'baseline captured');
  }

  return Step.complete({ changed });
};

registerWorkflow(MONITOR_HANDLER, handler);
