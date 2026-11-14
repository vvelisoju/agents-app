// POL-10 — approval executor seam. decideApproval() calls fireApproved() after an Approval flips
// to 'approved'; a consumer (the tools module) registers the actual executor via onApproved(),
// so policy never imports tools (no cycle). The executor runs the previously-gated action
// exactly once; it is best-effort and never throws back into the decision path.
import { log } from '../lib/log';

export type ApprovalExecutor = (approval: any) => Promise<void>;

let executor: ApprovalExecutor | null = null;

export function onApproved(fn: ApprovalExecutor): void {
  executor = fn;
}

export async function fireApproved(approval: any): Promise<void> {
  if (!executor) return;
  try {
    await executor(approval);
  } catch (e: any) {
    log.warn('approval executor failed', { approvalId: approval?.id, error: String(e?.message || e) });
  }
}
