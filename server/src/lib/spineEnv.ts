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

// MK-9 — per-contact memory flag, default off. With it off the engine neither recalls nor stores
// memory and the reply is byte-for-byte today's.
export function memoryEnabled(): boolean {
  const v = process.env.MEMORY_ENABLED;
  return v === '1' || v === 'true';
}

// MK-1 — conversation rolling-summary flag, default off. With it off the engine never injects or
// refreshes a summary and the reply is byte-for-byte today's. On, long conversations carry a
// compact running summary of turns older than the recent window so context isn't lost.
export function summaryEnabled(): boolean {
  const v = process.env.SUMMARY_ENABLED;
  return v === '1' || v === 'true';
}

// LKD-1 — LinkedIn browser agent master flag, default off. With it off the LinkedIn adapter is a
// coming-soon catalog tile only and no browser worker / action ever runs. See
// docs/LINKEDIN_AGENT_PLAN.md. This is owner-operated browser automation (no LinkedIn API) and
// every outbound action is approval-gated.
export function linkedinEnabled(): boolean {
  const v = process.env.LINKEDIN_ENABLED;
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
