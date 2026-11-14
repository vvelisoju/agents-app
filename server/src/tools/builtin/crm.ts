// TOOL-08 — crm.create_lead / crm.update_lead over the existing Conversation model (no new
// tables). Writes, so they route through approve-before-act. Strictly scoped to ctx.orgId: a
// conversation from another org is never written.
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { registerTool } from '../registry';
import type { Tool } from '../types';

export const crmCreateLead: Tool = {
  name: 'crm.create_lead',
  description: 'Record a new lead by starting (or finding) a conversation for a contact.',
  inputSchema: z.object({ contactNumber: z.string().min(3), contactName: z.string().optional() }),
  outputSchema: z.object({ conversationId: z.string() }),
  sideEffect: 'write',
  approvalAction: 'crm_write',
  idempotent: true,
  async execute(input, ctx) {
    const conv = await prisma.conversation.upsert({
      where: { agentId_contactNumber: { agentId: ctx.agent.id, contactNumber: input.contactNumber } },
      update: { ...(input.contactName ? { contactName: input.contactName } : {}) },
      create: { agentId: ctx.agent.id, orgId: ctx.orgId, contactNumber: input.contactNumber, contactName: input.contactName ?? input.contactNumber },
    });
    return { conversationId: conv.id };
  },
};

export const crmUpdateLead: Tool = {
  name: 'crm.update_lead',
  description: "Update a lead's status or notes.",
  inputSchema: z.object({ contactNumber: z.string().min(3), leadStatus: z.string().optional(), leadNotes: z.string().optional() }),
  outputSchema: z.object({ ok: z.boolean() }),
  sideEffect: 'write',
  approvalAction: 'crm_write',
  async execute(input, ctx) {
    const conv = await prisma.conversation.findFirst({ where: { agentId: ctx.agent.id, contactNumber: input.contactNumber } });
    if (!conv) throw new Error('no conversation for that contact');
    if (conv.orgId !== ctx.orgId) throw new Error('denied'); // cross-tenant guard
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { ...(input.leadStatus ? { leadStatus: input.leadStatus } : {}), ...(input.leadNotes ? { leadNotes: input.leadNotes } : {}) },
    });
    return { ok: true };
  },
};

registerTool(crmCreateLead);
registerTool(crmUpdateLead);
