// EWS-14 — boot wiring. Starts the runner loop + the scheduler ticker ONCE, and only when
// WORKFLOW_ENABLED is set (default off → neither starts and the process is byte-for-byte as
// today). A double-start guard makes a second call a no-op; stopSpine() clears the tickers and
// releases this process's held leases so a redeploy never strands jobs.
import prisma from '../lib/prisma';
import { log } from '../lib/log';
import { workflowEnabled } from '../lib/spineEnv';
import { runOnce } from './runner';
import { tickCron } from './scheduler';
import { drainEvents } from '../triggers/dispatcher';

let runnerTimer: NodeJS.Timeout | null = null;
let tickerTimer: NodeJS.Timeout | null = null;
let started = false;

const RUNNER_MS = Number(process.env.WORKFLOW_RUNNER_MS) || 2_000;
const TICK_MS = Number(process.env.WORKFLOW_TICK_MS) || 30_000;

/** Start the spine if enabled and not already running. Returns true if it started. */
export function startSpine(): boolean {
  if (!workflowEnabled() || started) return false;
  started = true;

  const safe = (fn: () => Promise<unknown>, label: string) => async () => {
    try { await fn(); } catch (e: any) { log.error(`spine ${label} error`, { error: String(e?.message || e) }); }
  };

  runnerTimer = setInterval(safe(() => runOnce(), 'runner'), RUNNER_MS);
  tickerTimer = setInterval(safe(async () => { await drainEvents(); await tickCron(); }, 'ticker'), TICK_MS);
  log.info('workflow spine started', { runnerMs: RUNNER_MS, tickMs: TICK_MS });
  return true;
}

/** Stop the tickers and release held leases so a redeploy leaves no stranded 'leased' jobs. */
export async function stopSpine(): Promise<void> {
  if (runnerTimer) { clearInterval(runnerTimer); runnerTimer = null; }
  if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
  started = false;
  try {
    const { count } = await prisma.job.updateMany({
      where: { status: 'leased' },
      data: { status: 'pending', lease: null, leaseUntil: null },
    });
    if (count) log.info('released leases on shutdown', { count });
  } catch (e: any) {
    log.warn('lease release failed', { error: String(e?.message || e) });
  }
}

export function spineRunning(): boolean {
  return started;
}
