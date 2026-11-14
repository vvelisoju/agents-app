// SCN-42 — Watch CRUD + spine Trigger wiring. Creating a Watch validates its URL against the
// FND-15 SSRF allowlist and registers a paired cron Trigger (handlerName='scheduled-monitor',
// filter={watchId}) so the scheduler drives it. Deleting a Watch removes its Trigger. All
// operations are org-scoped.
import prisma from '../../lib/prisma';
import { assertPublicUrl } from '../../lib/ssrfGuard';
import { MONITOR_HANDLER } from '../../workflow/handlers/scheduledMonitor';

// Keep cadence choices simple + polite (min hourly) — invisible-UI, zero-decision default.
const CADENCE: Record<string, string> = {
  hourly: '0 * * * *',
  '6h': '0 */6 * * *',
  daily: '0 9 * * *', // 9am local
};
export function cronForCadence(cadence?: string): string {
  return CADENCE[cadence || 'hourly'] || CADENCE.hourly;
}

export interface CreateWatchInput {
  orgId: string;
  agentId: string;
  url: string;
  label?: string;
  cadence?: string;
  notifyNumber?: string;
}

export async function createWatch(input: CreateWatchInput) {
  // SSRF-validate on create (throws a friendly error on a private/metadata/loopback target).
  const parsed = await assertPublicUrl(input.url);
  const cronExpr = cronForCadence(input.cadence);

  const watch = await prisma.watch.create({
    data: {
      orgId: input.orgId,
      agentId: input.agentId,
      url: parsed.toString(),
      label: input.label?.slice(0, 120) || null,
      cronExpr,
      notifyNumber: input.notifyNumber || null,
    },
  });

  const trigger = await prisma.trigger.create({
    data: {
      orgId: input.orgId,
      agentId: input.agentId,
      kind: 'cron',
      cronExpr,
      handlerName: MONITOR_HANDLER,
      filterJson: JSON.stringify({ watchId: watch.id }),
      enabled: true,
    },
  });

  return prisma.watch.update({ where: { id: watch.id }, data: { triggerId: trigger.id } });
}

export function listWatches(orgId: string, agentId: string) {
  return prisma.watch.findMany({ where: { orgId, agentId }, orderBy: { createdAt: 'desc' } });
}

export async function setWatchActive(orgId: string, agentId: string, watchId: string, active: boolean) {
  // Scope by agentId too: a watch belongs to one agent, so a sibling agent's route must not touch it.
  const watch = await prisma.watch.findFirst({ where: { id: watchId, orgId, agentId } });
  if (!watch) return null;
  // Pause/resume the paired Trigger too, so a paused watch stops being scheduled.
  if (watch.triggerId) await prisma.trigger.update({ where: { id: watch.triggerId }, data: { enabled: active } }).catch(() => {});
  return prisma.watch.update({ where: { id: watch.id }, data: { active } });
}

export async function deleteWatch(orgId: string, agentId: string, watchId: string): Promise<boolean> {
  const watch = await prisma.watch.findFirst({ where: { id: watchId, orgId, agentId } });
  if (!watch) return false;
  if (watch.triggerId) await prisma.trigger.delete({ where: { id: watch.triggerId } }).catch(() => {});
  await prisma.watch.delete({ where: { id: watch.id } });
  return true;
}
