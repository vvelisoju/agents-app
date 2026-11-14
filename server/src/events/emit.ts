// EWS-06 — outbox writer. Persists a DomainEvent fire-and-forget, mirroring alertOwner's
// try/catch so it NEVER throws into the hot reply path. Gated by WORKFLOW_ENABLED: with the
// flag off this is a complete no-op, so processInbound's output and latency are byte-for-byte
// unchanged and the outbox never grows on default deployments.
import prisma from '../lib/prisma';
import { log } from '../lib/log';
import { workflowEnabled, safeJson } from '../lib/spineEnv';

export interface EmitInput {
  orgId: string;
  source: string;
  type: string;
  subject?: string;
  data?: Record<string, unknown>;
  /** When set, a duplicate emit with the same key is silently ignored (idempotent instrumentation). */
  idempotencyKey?: string;
}

export async function emit(input: EmitInput): Promise<void> {
  if (!workflowEnabled()) return; // default off → hot path untouched
  try {
    await prisma.domainEvent.create({
      data: {
        orgId: input.orgId,
        source: input.source,
        type: input.type,
        subject: input.subject ?? null,
        dataJson: safeJson(input.data),
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
  } catch (e: any) {
    // A unique-key clash (duplicate instrumentation) is expected and benign; anything
    // else we log and swallow — emitting must never break the caller.
    if (!/unique|constraint/i.test(String(e?.message))) {
      log.warn('emit failed', { type: input.type, error: String(e?.message || e) });
    }
  }
}
