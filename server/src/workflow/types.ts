// EWS-07 — the tiny contract the runner drives. A handler is invoked per tick with a
// StepContext and returns exactly one StepResult; the runner's applyResult switches
// exhaustively over the union (no default-fallthrough). Multi-step runs advance by the
// handler reading/writing ctx.state and returning retry{afterMs:0} (run again now) or
// sleep{until} (resume later); 'complete' finishes the whole run.
import type { Job, WorkflowRun } from '@prisma/client';

export type StepResult =
  | { kind: 'complete'; output?: Record<string, unknown> }
  | { kind: 'retry'; afterMs: number; reason?: string }
  | { kind: 'sleep'; until: Date; reason?: string }
  | { kind: 'awaitApproval'; actionType: string; payload?: Record<string, unknown>; reason?: string }
  | { kind: 'fail'; error: string };

export interface StepContext {
  orgId: string;
  agentId: string | null;
  job: Job;
  run: WorkflowRun | null;
  /** Parsed job/run state (read-only snapshot). Mutate via setState(). */
  state: Record<string, unknown>;
  /** Merge a patch into the durable state persisted on the next transition. */
  setState(patch: Record<string, unknown>): void;
  /** Emit a DomainEvent (outbox) — fire-and-forget, gated by WORKFLOW_ENABLED. */
  emit(type: string, data?: Record<string, unknown>): Promise<void>;
  /** Append a plain-language line to the run's step history. */
  log(message: string, detail?: Record<string, unknown>): void;
}

export type WorkflowHandler = (ctx: StepContext) => Promise<StepResult>;

// Convenience constructors so handlers read declaratively.
export const Step = {
  complete: (output?: Record<string, unknown>): StepResult => ({ kind: 'complete', output }),
  retry: (afterMs: number, reason?: string): StepResult => ({ kind: 'retry', afterMs, reason }),
  sleep: (until: Date, reason?: string): StepResult => ({ kind: 'sleep', until, reason }),
  awaitApproval: (actionType: string, payload?: Record<string, unknown>, reason?: string): StepResult =>
    ({ kind: 'awaitApproval', actionType, payload, reason }),
  fail: (error: string): StepResult => ({ kind: 'fail', error }),
};
