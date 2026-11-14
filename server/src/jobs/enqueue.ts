// EWS-03 (producer side) — enqueue a Job. The idempotencyKey @unique constraint makes a
// duplicate enqueue a no-op (returns null), which is how the dispatcher and scheduler stay
// exactly-once across overlapping ticks and event re-drains.
import type { Job } from '@prisma/client';
import prisma from '../lib/prisma';
import { safeJson } from '../lib/spineEnv';

export interface EnqueueInput {
  orgId: string;
  handlerName: string;
  workflowRunId?: string | null;
  idempotencyKey?: string;
  state?: Record<string, unknown>;
  nextRunAt?: Date;
  maxAttempts?: number;
}

/** Create a Job, or return null if an identical idempotencyKey already exists. */
export async function enqueueJob(input: EnqueueInput): Promise<Job | null> {
  try {
    return await prisma.job.create({
      data: {
        orgId: input.orgId,
        handlerName: input.handlerName,
        workflowRunId: input.workflowRunId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        stateJson: safeJson(input.state),
        nextRunAt: input.nextRunAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
      },
    });
  } catch (e: any) {
    if (/unique|constraint/i.test(String(e?.message))) return null; // duplicate → exactly-once
    throw e;
  }
}
