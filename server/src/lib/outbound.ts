// SCN-09/18 — outbound drip policy helpers: send window, warmup-ramped daily cap, jitter, and
// the mandatory opt-out footer baked into every promo (accepted-risk mitigation).
import type { OutboundConnection } from '@prisma/client';

export const OPT_OUT_FOOTER = 'Reply STOP to unsubscribe.';

// Current hour (0-23) in the given IANA timezone (defaults to IST), matching engine.ts.
export function hourInTz(tz = 'Asia/Kolkata', at: Date = new Date()): number {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(at);
    return parseInt(s, 10) % 24;
  } catch {
    return at.getHours();
  }
}

export function inWindow(conn: Pick<OutboundConnection, 'windowStart' | 'windowEnd'>, tz?: string, at: Date = new Date()): boolean {
  const h = hourInTz(tz, at);
  return conn.windowStart <= conn.windowEnd
    ? h >= conn.windowStart && h < conn.windowEnd
    : h >= conn.windowStart || h < conn.windowEnd; // overnight window
}

// The next moment the send window is open, from `at`. If already open, returns `at`.
export function nextWindowOpen(conn: Pick<OutboundConnection, 'windowStart' | 'windowEnd'>, tz?: string, at: Date = new Date()): Date {
  if (inWindow(conn, tz, at)) return at;
  const h = hourInTz(tz, at);
  const d = new Date(at.getTime());
  // Advance hour-by-hour (bounded) until the window opens — tz-safe without date math.
  for (let i = 1; i <= 48; i++) {
    d.setTime(at.getTime() + i * 60 * 60_000);
    if (hourInTz(tz, d) === conn.windowStart) return d;
    void h;
  }
  return new Date(at.getTime() + 60 * 60_000);
}

// Warmup ramp: day 1 sends warmupStart, ramping linearly to dailyCap over warmupDays.
export function effectiveCap(conn: Pick<OutboundConnection, 'dailyCap' | 'warmupDays' | 'warmupStart'>, dayIndex: number): number {
  if (conn.warmupDays <= 0 || dayIndex >= conn.warmupDays) return conn.dailyCap;
  const start = Math.min(conn.warmupStart, conn.dailyCap); // never ramp above the cap
  const span = conn.dailyCap - start;
  const ramped = start + Math.round((span * dayIndex) / conn.warmupDays);
  return Math.max(1, Math.min(conn.dailyCap, ramped));
}

// Start of the local day (midnight in tz), as a UTC Date, for counting today's ledger sends.
export function localMidnight(tz = 'Asia/Kolkata', at: Date = new Date()): Date {
  const h = hourInTz(tz, at);
  const d = new Date(at.getTime() - h * 60 * 60_000);
  d.setMinutes(0, 0, 0);
  return d;
}

export function randomGapMs(minSec: number, maxSec: number): number {
  const lo = Math.max(1, minSec);
  const hi = Math.max(lo, maxSec);
  return Math.round((lo + Math.random() * (hi - lo)) * 1000);
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : '••••';
}
