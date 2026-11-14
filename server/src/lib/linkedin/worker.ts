// LKD-1 (Wave 1) — LinkedIn worker loop.
//
// This runs as a SEPARATE process on the OWNER'S OWN machine (not the Railway API) — see the owner
// decision in docs/LINKEDIN_AGENT_PLAN.md §5 — because LinkedIn flags datacenter IPs. It polls for
// APPROVED actions, executes exactly one per tick through the browser driver, records the result,
// and (on a session failure) flips the stored session to needs_relink/checkpoint so the owner is
// prompted to re-link. Gated by LINKEDIN_ENABLED: off → every tick is an inert no-op.
import { linkedinEnabled } from '../spineEnv';
import { claimNextApproved, recordResult } from '../../modules/linkedin/service';
import { monitorTickOnce, type MonitorDeps } from '../../modules/linkedin/monitorService';
import { jobTickOnce } from '../../modules/linkedin/jobService';
import { SessionError, setSessionStatus, type LinkedInDriver, type LinkedInJobSearcher } from './driver';

export interface TickOutcome { ran: boolean; actionId?: string; ok?: boolean; reason?: string }

// Execute at most one approved action. Pure of any timing/looping so tests can drive it directly
// with a mock driver.
export async function tickOnce(driver: LinkedInDriver): Promise<TickOutcome> {
  if (!linkedinEnabled()) return { ran: false, reason: 'disabled' };

  const action = await claimNextApproved();
  if (!action) return { ran: false, reason: 'idle' };

  let payload: any = {};
  try { payload = JSON.parse(action.payloadJson); } catch { /* ignore */ }

  try {
    let result;
    if (action.kind === 'post') result = await driver.publishPost(action.orgId, action.agentId, payload.text);
    else if (action.kind === 'comment') result = await driver.commentOnPost(action.orgId, action.agentId, payload.postUrl, payload.text);
    else if (action.kind === 'reshare') result = await driver.resharePost(action.orgId, action.agentId, payload.postUrl, payload.caption);
    else throw new Error(`unknown action kind: ${action.kind}`);

    await recordResult(action.id, true, result || {});
    return { ran: true, actionId: action.id, ok: true };
  } catch (e: any) {
    // A dead/challenged session is not a per-action failure to retry — mark the session so the
    // owner re-links, and record this action as failed.
    if (e instanceof SessionError) {
      await setSessionStatus(action.orgId, action.agentId, e.linkStatus).catch(() => {});
    }
    await recordResult(action.id, false, { error: String(e?.message || e) });
    return { ran: true, actionId: action.id, ok: false };
  }
}

const BASE_INTERVAL_MS = Number(process.env.LINKEDIN_POLL_MS) || 20_000;
const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));

// Long-running loop for the standalone worker process. Human-paced: a randomised gap between
// actions, a longer idle gap when the queue is empty. Approved actions take priority; when none are
// pending, an idle cycle is used to poll a watched profile (LKD-2). Both are gated by
// LINKEDIN_ENABLED. Resilient — a thrown tick never kills the loop.
export async function runWorker(driver: LinkedInDriver, monitor?: MonitorDeps, jobSearcher?: LinkedInJobSearcher): Promise<void> {
  if (!linkedinEnabled()) {
    console.log('[linkedin-worker] LINKEDIN_ENABLED is not set — worker idle. Set it to 1 to run.');
    return;
  }
  console.log(`[linkedin-worker] started — approved actions${monitor ? ' + watching profiles' : ''}${jobSearcher ? ' + job searches' : ''}.`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let outcome: TickOutcome = { ran: false };
    try {
      // Priority: approved writes first (stay prompt), then a pending job search, then poll one
      // watch. Only one browser task per cycle so nothing competes for the single session.
      outcome = await tickOnce(driver);
      if (!outcome.ran && jobSearcher) {
        const job = await jobTickOnce(jobSearcher);
        if (!job.ran && monitor) await monitorTickOnce(monitor);
      } else if (!outcome.ran && monitor) {
        await monitorTickOnce(monitor);
      }
    } catch (e: any) {
      console.error('[linkedin-worker] tick error:', e?.message || e);
    }
    const gap = outcome.ran ? rand(BASE_INTERVAL_MS, BASE_INTERVAL_MS * 2) : BASE_INTERVAL_MS;
    await new Promise((r) => setTimeout(r, gap));
  }
}
