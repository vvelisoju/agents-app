// POL-10 / TOOL-19 — when a gated tool call's Approval is approved, run the tool for real.
// tools/execute.ts stored { tool, input } in the Approval payload; here we reconstruct the
// context (agent + org) and execute with preApproved=true, exactly once. Registered via the
// policy approvalExecutor seam so policy never imports tools.
import prisma from '../lib/prisma';
import { log } from '../lib/log';
import { onApproved } from '../policy/approvalExecutor';
import { getTool } from './registry';
import { executeTool } from './execute';

export function registerApprovalRunner(): void {
  onApproved(async (approval) => {
    let payload: any = {};
    try { payload = JSON.parse(approval.payloadJson || '{}'); } catch { /* ignore */ }
    if (!payload?.tool) return; // not a tool-based approval (e.g. bulk_send → workflow resume)

    const tool = getTool(payload.tool);
    if (!tool) { log.warn('approved tool no longer registered', { tool: payload.tool }); return; }

    const agent = approval.agentId ? await prisma.agent.findUnique({ where: { id: approval.agentId } }) : null;
    const r = await executeTool(tool, payload.input, { agent, orgId: approval.orgId, executionId: `appr-${approval.id}` }, { preApproved: true });
    log.info('approved tool executed', { tool: payload.tool, approvalId: approval.id, ok: r.ok });
  });
}
