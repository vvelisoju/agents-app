// FND-13 — tiny in-memory fixed-window rate limiter keyed by an arbitrary string
// (e.g. per-agent widget traffic). Single-process only, matching the current single
// replica; a horizontal move swaps this for a Redis/Postgres counter. Returns true if
// the call is allowed, false if the window's limit is already spent.
const buckets = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  // Opportunistic cleanup so the map can't grow unbounded over a long uptime.
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
    lastSweep = now;
  }
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Test seam: clear all windows. */
export function _resetRateLimiter() {
  buckets.clear();
  lastSweep = 0;
}
