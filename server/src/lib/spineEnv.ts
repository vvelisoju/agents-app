// Phase-5 spine gates. WORKFLOW_ENABLED defaults OFF → the whole spine is dormant and
// the process behaves byte-for-byte as today. isPostgres() drives the dialect-aware claim
// (SKIP LOCKED on prod Postgres vs a serialized transaction on the SQLite dev/test DB).

export function workflowEnabled(): boolean {
  const v = process.env.WORKFLOW_ENABLED;
  return v === '1' || v === 'true';
}

// SCN-36 — per-scenario flag, default off. The scheduled-monitor handler is inert unless set.
export function monitorEnabled(): boolean {
  const v = process.env.MONITOR_ENABLED;
  return v === '1' || v === 'true';
}

// SCN-36 — outbound QR drip flag, default off. With it off the STOP opt-out pre-check and the
// drip handler are inert, so processInbound is byte-for-byte today's.
export function outboundEnabled(): boolean {
  const v = process.env.OUTBOUND_ENABLED;
  return v === '1' || v === 'true';
}

export function isPostgres(): boolean {
  const url = process.env.DATABASE_URL || '';
  // The dev/test datasource is SQLite (file:...); everything else is Postgres.
  return !/^file:/.test(url) && !/^sqlite:/.test(url);
}

// Hard cap on untrusted event/state payloads (EWS-20): opaque data is never injected into
// a prompt, but we still bound its size so a malicious/oversized blob can't bloat the queue.
export const MAX_PAYLOAD_BYTES = 16 * 1024;

export function safeJson(value: unknown): string {
  let s = '{}';
  try { s = JSON.stringify(value ?? {}); } catch { s = '{}'; }
  if (s.length > MAX_PAYLOAD_BYTES) s = JSON.stringify({ _truncated: true, bytes: s.length });
  return s;
}
