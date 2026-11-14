// LKD-2 (Wave 2) — watch people's LinkedIn posts and draft a reaction for approval.
//
// The owner lists people to watch (e.g. their boss). The monitor tick (run by the worker on the
// owner's machine) reads each watched profile's latest post; the FIRST sighting only records a
// baseline (no draft); a genuinely NEW post is drafted into a comment and/or reshare, which land as
// pending_approval LinkedInActions — the owner still approves before anything is published.
import prisma from '../../lib/prisma';
import { linkedinEnabled } from '../../lib/spineEnv';
import { SessionError, setSessionStatus, type LinkedInReader } from '../../lib/linkedin/driver';
import { createAction } from './service';

const REACTIONS = new Set(['comment', 'reshare', 'both']);

function err(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}
function isLinkedInProfileUrl(u: unknown): u is string {
  return typeof u === 'string' && /^https:\/\/(www\.)?linkedin\.com\/(in|company)\//i.test(u.trim());
}
async function ownedAgent(orgId: string, agentId: string) {
  const a = await prisma.agent.findFirst({ where: { id: agentId, orgId }, select: { id: true } });
  if (!a) throw err('agent not found', 404);
}

export async function createWatch(orgId: string, agentId: string, input: { profileUrl?: unknown; label?: unknown; reaction?: unknown }) {
  await ownedAgent(orgId, agentId);
  if (!isLinkedInProfileUrl(input.profileUrl)) throw err('a valid linkedin.com/in/… or /company/… profileUrl is required');
  const reaction = REACTIONS.has(String(input.reaction)) ? String(input.reaction) : 'comment';
  return prisma.linkedInWatch.create({
    data: { orgId, agentId, profileUrl: String(input.profileUrl).trim(), label: input.label ? String(input.label).slice(0, 120) : null, reaction },
  });
}

export function listWatches(orgId: string, agentId: string) {
  return prisma.linkedInWatch.findMany({ where: { orgId, agentId }, orderBy: { createdAt: 'desc' } });
}

export async function updateWatch(orgId: string, watchId: string, patch: { active?: unknown; reaction?: unknown; label?: unknown }) {
  const w = await prisma.linkedInWatch.findFirst({ where: { id: watchId, orgId } });
  if (!w) throw err('watch not found', 404);
  const data: Record<string, unknown> = {};
  if (typeof patch.active === 'boolean') data.active = patch.active;
  if (patch.reaction != null) { if (!REACTIONS.has(String(patch.reaction))) throw err('reaction must be comment, reshare or both'); data.reaction = String(patch.reaction); }
  if (patch.label != null) data.label = String(patch.label).slice(0, 120);
  return prisma.linkedInWatch.update({ where: { id: w.id }, data });
}

export async function deleteWatch(orgId: string, watchId: string): Promise<boolean> {
  const w = await prisma.linkedInWatch.findFirst({ where: { id: watchId, orgId } });
  if (!w) return false;
  await prisma.linkedInWatch.delete({ where: { id: w.id } });
  return true;
}

// ── The tick (worker side) ──
export interface MonitorDeps {
  reader: LinkedInReader;
  draft: (agentId: string, postText: string, reaction: string) => Promise<{ comment: string; reshareCaption: string }>;
}
export interface MonitorOutcome {
  ran: boolean;
  reason?: string;
  watchId?: string;
  baseline?: boolean;
  newPost?: boolean;
  created?: string[];
}

// Process the single most-stale active watch per tick (gentle, human-paced). Gated by
// LINKEDIN_ENABLED. A dead/challenged session flips the stored session and is not retried blindly.
export async function monitorTickOnce(deps: MonitorDeps): Promise<MonitorOutcome> {
  if (!linkedinEnabled()) return { ran: false, reason: 'disabled' };

  const watch = await prisma.linkedInWatch.findFirst({ where: { active: true }, orderBy: { lastCheckedAt: 'asc' } });
  if (!watch) return { ran: false, reason: 'idle' };

  let latest;
  try {
    latest = await deps.reader.fetchLatestPost(watch.orgId, watch.agentId, watch.profileUrl);
  } catch (e: any) {
    if (e instanceof SessionError) await setSessionStatus(watch.orgId, watch.agentId, e.linkStatus).catch(() => {});
    await prisma.linkedInWatch.update({ where: { id: watch.id }, data: { lastCheckedAt: new Date() } });
    return { ran: true, watchId: watch.id, reason: String(e?.message || e) };
  }
  await prisma.linkedInWatch.update({ where: { id: watch.id }, data: { lastCheckedAt: new Date() } });

  if (!latest) return { ran: true, watchId: watch.id, newPost: false };

  // First sighting → baseline only (don't react to a post that was already there when you started).
  if (!watch.lastPostId) {
    await prisma.linkedInWatch.update({ where: { id: watch.id }, data: { lastPostId: latest.postId } });
    return { ran: true, watchId: watch.id, baseline: true };
  }
  if (latest.postId === watch.lastPostId) return { ran: true, watchId: watch.id, newPost: false };

  // A genuinely new post → draft + queue for approval.
  const drafted = await deps.draft(watch.agentId, latest.text, watch.reaction);
  const created: string[] = [];
  if ((watch.reaction === 'comment' || watch.reaction === 'both') && drafted.comment.trim()) {
    const a = await createAction(watch.orgId, watch.agentId, 'comment', { postUrl: latest.postUrl, text: drafted.comment.trim() });
    created.push(a.id);
  }
  if (watch.reaction === 'reshare' || watch.reaction === 'both') {
    const caption = drafted.reshareCaption?.trim();
    const a = await createAction(watch.orgId, watch.agentId, 'reshare', caption ? { postUrl: latest.postUrl, caption } : { postUrl: latest.postUrl });
    created.push(a.id);
  }
  await prisma.linkedInWatch.update({ where: { id: watch.id }, data: { lastPostId: latest.postId } });
  return { ran: true, watchId: watch.id, newPost: true, created };
}
