// OBS-1 — tiny structured JSON logger. No pino (zero new deps): we just print one
// JSON line per event with level/time/msg plus any fields. Pairs with redact() so
// secrets (tokens, auth headers, message bodies) never reach the log stream.
//
// time comes from Date.now() (ms epoch) — fine for prod; deterministic to parse.

export type Level = 'info' | 'warn' | 'error';

// Field names we always mask, whatever their casing (token, botToken, …).
const SENSITIVE = ['token', 'botToken', 'authorization', 'password', 'body'];

// Return a shallow copy of `obj` with any listed key masked to '[redacted]'.
// Case-insensitive on key name; never throws (a non-object just comes back as-is).
export function redact<T = any>(obj: T, keys: string[] = SENSITIVE): T {
  try {
    if (!obj || typeof obj !== 'object') return obj;
    const lower = new Set(keys.map((k) => k.toLowerCase()));
    const out: any = Array.isArray(obj) ? [...(obj as any)] : { ...(obj as any) };
    for (const k of Object.keys(out)) {
      if (lower.has(k.toLowerCase())) out[k] = '[redacted]';
    }
    return out;
  } catch {
    return obj; // logging must never crash the caller
  }
}

// Emit one JSON line. Fields are redacted (default keys) before printing.
function emit(level: Level, msg: string, fields?: Record<string, any>): void {
  try {
    const line = { level, time: Date.now(), msg, ...(fields ? redact(fields) : {}) };
    // eslint-disable-next-line no-console
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(
      JSON.stringify(line),
    );
  } catch {
    /* a logger must never throw */
  }
}

export const log = {
  info: (msg: string, fields?: Record<string, any>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, any>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, any>) => emit('error', msg, fields),
};

export default log;
