// Connector tools — the agent invokes an OWNER-DEFINED operation by name (never raw SQL). data.query
// runs read operations inline; data.action runs write operations, routed through approve-before-act
// by the execute pipeline (sideEffect 'write'). The op lookup is scoped to the agent's org AND its
// connectorAccess level, so a customer-facing agent can never run an admin-only operation.
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { registerTool } from '../registry';
import type { Tool, ToolContext } from '../types';
import { runConnectorOp, type OpResult } from '../../lib/connectors';

async function runOp(ctx: ToolContext, operation: string, params: Record<string, unknown> | undefined, sideEffect: 'read' | 'write'): Promise<OpResult> {
  const access = (ctx.agent as any)?.connectorAccess === 'admin' ? ['customer', 'admin'] : ['customer'];
  const op = await prisma.connectorOp.findFirst({ where: { orgId: ctx.orgId, name: operation, sideEffect, access: { in: access } } });
  if (!op) return { ok: false, error: `no such ${sideEffect} operation available: ${operation}` };
  const connector = await prisma.connector.findFirst({ where: { id: op.connectorId, orgId: ctx.orgId, active: true } });
  if (!connector) return { ok: false, error: 'that connector is not available' };
  return runConnectorOp(connector, op, params || {});
}

const io = {
  inputSchema: z.object({ operation: z.string().min(1), params: z.record(z.string(), z.any()).optional() }),
  outputSchema: z.object({ ok: z.boolean(), rows: z.array(z.any()).optional(), data: z.any().optional(), status: z.number().optional(), error: z.string().optional() }),
};

export const dataQuery: Tool = {
  name: 'data.query',
  description: 'Look up live business data (a customer/lead record, order or booking status, etc.) by calling a configured read operation by name with its parameters.',
  ...io,
  sideEffect: 'read',
  async execute(input, ctx) { return runOp(ctx, input.operation, input.params, 'read'); },
};

export const dataAction: Tool = {
  name: 'data.action',
  description: 'Change business data (update a lead status, create/modify a record) by calling a configured write operation by name with its parameters. Requires owner approval before it runs.',
  ...io,
  sideEffect: 'write',
  approvalAction: 'data_write',
  async execute(input, ctx) { return runOp(ctx, input.operation, input.params, 'write'); },
};

registerTool(dataQuery);
registerTool(dataAction);
