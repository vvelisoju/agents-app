// EWS-05 — CloudEvents field-shape envelope. Field-shape only: no CloudEvents SDK,
// no broker (the DomainEvent outbox is the transport). A pure makeEvent() so the
// envelope is deterministic when id/time are supplied (the spine passes neither in
// the hot path; tests pass both to assert shape).
import { randomUUID } from 'node:crypto';

export interface EventEnvelope {
  id: string;
  source: string;
  type: string;
  time: string; // ISO-8601
  subject?: string;
  data: Record<string, unknown>;
}

export function makeEvent(input: {
  source: string;
  type: string;
  subject?: string;
  data?: Record<string, unknown>;
  id?: string;
  time?: string;
}): EventEnvelope {
  return {
    id: input.id ?? randomUUID(),
    source: input.source,
    type: input.type,
    time: input.time ?? new Date().toISOString(),
    subject: input.subject,
    data: input.data ?? {},
  };
}
