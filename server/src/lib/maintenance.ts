// EWS-34 — one always-on, in-process maintenance ticker, started at boot INDEPENDENT of
// WORKFLOW_ENABLED (housekeeping must run on every deployment, even with the spine off). Every
// retention/TTL sweep registers here instead of standing up its own setInterval, so there is one
// ticker. With no sweeps registered the process behaves exactly as before. A double-start guard
// and stop() (for SIGTERM) are provided. Sweeps are best-effort: one failing sweep never stops
// the others, and the ticker never throws into the event loop.
import { log } from './log';

export interface MaintenanceSweep {
  name: string;
  run: () => Promise<{ [k: string]: number } | void>;
}

const sweeps: MaintenanceSweep[] = [];
let timer: NodeJS.Timeout | null = null;
let started = false;

const INTERVAL_MS = Number(process.env.MAINTENANCE_INTERVAL_MS) || 6 * 60 * 60_000; // every 6h

export function registerMaintenanceSweep(name: string, run: MaintenanceSweep['run']): void {
  sweeps.push({ name, run });
}

/** Run every registered sweep once. Exposed for tests + the boot warm-up. */
export async function runMaintenanceOnce(): Promise<void> {
  for (const s of sweeps) {
    try {
      const counts = await s.run();
      if (counts && Object.values(counts).some((n) => n > 0)) log.info('maintenance', { sweep: s.name, ...counts });
    } catch (e: any) {
      log.warn('maintenance sweep failed', { sweep: s.name, error: String(e?.message || e) });
    }
  }
}

export function startMaintenance(): boolean {
  if (started) return false;
  started = true;
  timer = setInterval(() => { void runMaintenanceOnce(); }, INTERVAL_MS);
  // A delayed first pass so boot stays fast and a redeploy loop can't hammer the DB.
  setTimeout(() => { void runMaintenanceOnce(); }, 30_000).unref?.();
  log.info('maintenance ticker started', { intervalMs: INTERVAL_MS, sweeps: sweeps.length });
  return true;
}

export function stopMaintenance(): void {
  if (timer) { clearInterval(timer); timer = null; }
  started = false;
}

export function listSweeps(): string[] {
  return sweeps.map((s) => s.name);
}
