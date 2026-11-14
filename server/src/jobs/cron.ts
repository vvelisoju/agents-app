// EWS-13 (helper) — a tiny, dependency-free cron evaluator. Supports the standard 5-field
// expression (minute hour day-of-month month day-of-week) with '*', lists (a,b), ranges
// (a-b), and steps (*/n, a-b/n) — enough for the in-scope schedules (every N minutes,
// hourly, daily-at-HH:MM, weekly). day-of-month and day-of-week are ANDed (documented
// simplification; the scenarios never restrict both at once). No npm dependency is added.

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? Math.max(1, parseInt(stepStr, 10)) : 1;
    let lo = min;
    let hi = max;
    if (range !== '*' && range !== '') {
      if (range.includes('-')) {
        const [a, b] = range.split('-');
        lo = parseInt(a, 10);
        hi = parseInt(b, 10);
      } else {
        lo = hi = parseInt(range, 10);
      }
    }
    for (let v = lo; v <= hi; v += step) if (v >= min && v <= max) out.add(v);
  }
  return out;
}

/** The next fire time strictly after `from` that matches the expression (local time). */
export function cronNext(expr: string, from: Date): Date {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return new Date(from.getTime() + 60 * 60_000); // malformed → 1h fallback
  const [mi, ho, dom, mo, dow] = fields;
  const M = parseField(mi, 0, 59);
  const H = parseField(ho, 0, 23);
  const D = parseField(dom, 1, 31);
  const Mo = parseField(mo, 1, 12);
  const W = parseField(dow, 0, 6);

  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  // Bounded scan: at most ~1 year of minutes before giving up.
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (M.has(d.getMinutes()) && H.has(d.getHours()) && Mo.has(d.getMonth() + 1) && D.has(d.getDate()) && W.has(d.getDay())) {
      return new Date(d.getTime());
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return new Date(from.getTime() + 60 * 60_000);
}
