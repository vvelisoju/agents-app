// LKD-3 (Wave 3) — LinkedIn job searches (READ-ONLY).
//
// The owner requests a search (query + optional location); the worker on the owner's machine runs
// it in the logged-in browser and stores a digest of matching listings. There is NO auto-apply and
// nothing is written to LinkedIn — this is a read, so it needs no approval gate. The owner reads the
// digest (API/UI). See docs/LINKEDIN_AGENT_PLAN.md.
import prisma from '../../lib/prisma';
import { linkedinEnabled } from '../../lib/spineEnv';
import { SessionError, setSessionStatus, type LinkedInJobSearcher } from '../../lib/linkedin/driver';

export const JOB_STATUS = { pending: 'pending', done: 'done', failed: 'failed' } as const;

function err(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}
async function ownedAgent(orgId: string, agentId: string) {
  const a = await prisma.agent.findFirst({ where: { id: agentId, orgId }, select: { id: true } });
  if (!a) throw err('agent not found', 404);
}

function shape(s: any) {
  let result: unknown = null;
  try { result = s.resultJson ? JSON.parse(s.resultJson) : null; } catch { /* ignore */ }
  return { id: s.id, agentId: s.agentId, query: s.query, location: s.location, status: s.status, result, error: s.error, createdAt: s.createdAt, executedAt: s.executedAt };
}

export async function createJobSearch(orgId: string, agentId: string, input: { query?: unknown; location?: unknown }) {
  await ownedAgent(orgId, agentId);
  const query = String(input.query ?? '').trim();
  if (!query) throw err('a search query is required');
  if (query.length > 200) throw err('query is too long');
  const location = input.location != null ? String(input.location).trim().slice(0, 120) : null;
  const s = await prisma.linkedInJobSearch.create({ data: { orgId, agentId, query, location, status: JOB_STATUS.pending } });
  return shape(s);
}

export async function listJobSearches(orgId: string, agentId: string) {
  const rows = await prisma.linkedInJobSearch.findMany({ where: { orgId, agentId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return rows.map(shape);
}

export async function getJobSearch(orgId: string, id: string) {
  const s = await prisma.linkedInJobSearch.findFirst({ where: { id, orgId } });
  if (!s) throw err('job search not found', 404);
  return shape(s);
}

// ── Worker side ──
async function claimNextPending() {
  const next = await prisma.linkedInJobSearch.findFirst({ where: { status: JOB_STATUS.pending }, orderBy: { createdAt: 'asc' } });
  if (!next) return null;
  const claimed = await prisma.linkedInJobSearch.updateMany({ where: { id: next.id, status: JOB_STATUS.pending }, data: { status: 'running' } });
  if (claimed.count === 0) return null;
  return prisma.linkedInJobSearch.findUnique({ where: { id: next.id } });
}

export interface JobTickOutcome { ran: boolean; reason?: string; searchId?: string; ok?: boolean; count?: number }

// Run at most one pending job search per tick. Gated by LINKEDIN_ENABLED. A dead/challenged session
// flips the stored session (like the other reads) and records the search as failed.
export async function jobTickOnce(searcher: LinkedInJobSearcher): Promise<JobTickOutcome> {
  if (!linkedinEnabled()) return { ran: false, reason: 'disabled' };
  const search = await claimNextPending();
  if (!search) return { ran: false, reason: 'idle' };
  try {
    const jobs = await searcher.searchJobs(search.orgId, search.agentId, search.query, search.location || undefined);
    await prisma.linkedInJobSearch.update({
      where: { id: search.id },
      data: { status: JOB_STATUS.done, resultJson: JSON.stringify({ jobs }), executedAt: new Date() },
    });
    return { ran: true, searchId: search.id, ok: true, count: jobs.length };
  } catch (e: any) {
    if (e instanceof SessionError) await setSessionStatus(search.orgId, search.agentId, e.linkStatus).catch(() => {});
    await prisma.linkedInJobSearch.update({
      where: { id: search.id },
      data: { status: JOB_STATUS.failed, error: String(e?.message || e), executedAt: new Date() },
    });
    return { ran: true, searchId: search.id, ok: false };
  }
}
