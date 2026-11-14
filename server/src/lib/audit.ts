// SEC-7 / AUD-1 — append-only audit writer. Every security-relevant action
// (approval decisions, credential changes, policy overrides, logins) drops one
// immutable AuditLog row here. The trail is write-only from the app's view: we
// never update or delete rows, so it stays tamper-evident.
//
// Design notes:
//   - Fire-and-forget: audit() returns void and NEVER throws into the caller.
//     A failed write must not break the business action it was recording, so the
//     insert runs on its own promise and a rejection is swallowed into log.error.
//   - Secrets never land in the trail: metadata is passed through redact() (same
//     key list as the logger) before being JSON.stringify'd into metadataJson, so
//     a token/password/authorization field is masked at rest.

import prisma from './prisma';
import { log, redact } from './log';

export interface AuditEvent {
  orgId: string; // tenant the action belongs to (required — the trail is per-org)
  actorUserId?: string; // the user who acted, when a human did
  actorType?: string; // 'user' | 'system' | 'agent' (defaults to 'user' in schema)
  action: string; // short verb, e.g. 'approval.approve', 'credential.create'
  targetType?: string; // the kind of thing acted on, e.g. 'Approval', 'ConnectedAccount'
  targetId?: string; // the acted-on row's id
  metadata?: Record<string, any>; // extra context; redacted + JSON-encoded
  ip?: string; // request IP, when available
}

// Record one audit event. Returns immediately; the row is written in the
// background and any failure is logged (never re-thrown to the caller).
export function audit(e: AuditEvent): void {
  // Redact + serialize outside the promise so a bad metadata object is caught by
  // the surrounding try and still can't throw into the caller.
  let metadataJson: string | undefined;
  try {
    metadataJson =
      e.metadata === undefined ? undefined : JSON.stringify(redact(e.metadata));
  } catch (err) {
    // Non-serializable metadata (cycles, BigInt, …) must not lose the whole row.
    metadataJson = JSON.stringify({ _auditMetadataError: String(err) });
  }

  prisma.auditLog
    .create({
      data: {
        orgId: e.orgId,
        actorType: e.actorType ?? 'user',
        actorUserId: e.actorUserId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        metadataJson,
        ip: e.ip,
      },
    })
    .catch((err) => {
      // The audit write is best-effort; surface the failure in the log stream but
      // never let it reach the caller's control flow.
      log.error('audit.write_failed', {
        action: e.action,
        orgId: e.orgId,
        err: String(err),
      });
    });
}

export default audit;
