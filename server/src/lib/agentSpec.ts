// SPEC-2..5 / SPEC-27 — the canonical Agent Specification: a validated, versioned JSON
// serialization of an agent's Agent row + TrainingProfile + TrainingSource. It introduces
// no new executable concepts; it is a superset of what already exists. Both the NL builder
// and the form/template path compile through applySpec(), so they produce the SAME agent.
import { z } from 'zod';
import prisma from './prisma';

const personaSchema = z.object({
  instructions: z.string().default(''),
  restrictions: z.string().default(''),
  tone: z.string().default('warm, concise, helpful'),
  language: z.string().default('match the customer'),
  escalationKeyword: z.string().default('NEEDS_HUMAN'),
});

const behaviorSchema = z.object({
  approval: z.enum(['auto', 'draft']).default('draft'),
  hoursStart: z.number().int().min(0).max(23).nullable().default(null),
  hoursEnd: z.number().int().min(0).max(23).nullable().default(null),
  timezone: z.string().default('Asia/Kolkata'),
  awayMessage: z.string().nullable().default(null),
  alertNumber: z.string().nullable().default(null),
  alertCondition: z.string().nullable().default(null),
});

export const AgentSpecSchema = z.object({
  specVersion: z.literal(1).default(1),
  identity: z.object({ name: z.string().min(1) }),
  channel: z.object({ type: z.string().min(1), channelConfig: z.record(z.string(), z.any()).default({}) }),
  persona: personaSchema.default(personaSchema.parse({})),
  knowledge: z
    .array(
      z.object({
        type: z.enum(['fact', 'faq', 'link']),
        data: z.record(z.string(), z.any()),
        enabled: z.boolean().default(true),
      }),
    )
    .default([]),
  behavior: behaviorSchema.default(behaviorSchema.parse({})),
  // Forward-declared, empty until the tool/trigger/workflow phases — keeps the shape stable.
  tools: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  triggers: z.array(z.any()).default([]),
  workflowRefs: z.array(z.string()).default([]),
});

export type AgentSpec = z.infer<typeof AgentSpecSchema>;

export type ValidateResult =
  | { ok: true; spec: AgentSpec; errors?: undefined }
  | { ok: false; spec?: undefined; errors: string[] };

export function validateSpec(input: unknown): ValidateResult {
  const r = AgentSpecSchema.safeParse(input);
  if (r.success) return { ok: true, spec: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

function safeJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}

export async function specFromAgent(agentId: string): Promise<AgentSpec | null> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;
  const profile = await prisma.trainingProfile.findUnique({ where: { agentId } });
  const sources = await prisma.trainingSource.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } });

  const channelConfig = agent.channelConfig ? safeJson(agent.channelConfig) : {};
  // SPEC-27: never serialize channel secrets into the spec / version snapshots / GET spec.
  delete (channelConfig as any).botToken;

  return AgentSpecSchema.parse({
    specVersion: 1,
    identity: { name: agent.name },
    channel: { type: agent.channelType, channelConfig },
    persona: profile
      ? {
          instructions: profile.instructions,
          restrictions: profile.restrictions,
          tone: profile.tone,
          language: profile.language,
          escalationKeyword: profile.escalationKeyword,
        }
      : {},
    knowledge: sources.map((s) => ({ type: s.type as 'fact' | 'faq' | 'link', data: safeJson(s.dataJson), enabled: s.enabled })),
    // TOOL-13: the agent's enabled tools round-trip through the spec + version snapshots.
    tools: (agent as any).enabledToolsJson ? safeJson((agent as any).enabledToolsJson) : [],
    behavior: {
      approval: agent.autoSend ? 'auto' : 'draft',
      hoursStart: agent.hoursStart,
      hoursEnd: agent.hoursEnd,
      timezone: agent.timezone,
      awayMessage: agent.awayMessage,
      alertNumber: agent.alertNumber,
      alertCondition: agent.alertCondition,
    },
  });
}

/** Compile a validated spec back into the agent's rows. The single write path shared by
 *  the NL builder, templates, and the form. Channel secrets (botToken) are preserved from
 *  the existing row — the spec never carries them. */
export async function applySpec(agentId: string, spec: AgentSpec): Promise<void> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
  if (!agent) throw new Error('agent not found');

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      name: spec.identity.name,
      channelType: spec.channel.type,
      autoSend: spec.behavior.approval === 'auto',
      hoursStart: spec.behavior.hoursStart,
      hoursEnd: spec.behavior.hoursEnd,
      timezone: spec.behavior.timezone,
      awayMessage: spec.behavior.awayMessage,
      alertNumber: spec.behavior.alertNumber,
      alertCondition: spec.behavior.alertCondition,
      // TOOL-13: compile enabled tools back; a non-empty tool set runs the agentic path.
      enabledToolsJson: JSON.stringify(spec.tools ?? []),
      executionMode: (spec.tools?.length ?? 0) > 0 ? 'agentic' : 'reply',
    } as any,
  });

  await prisma.trainingProfile.upsert({
    where: { agentId },
    update: { ...spec.persona },
    create: { agentId, orgId: agent.orgId, ...spec.persona },
  });

  await prisma.trainingSource.deleteMany({ where: { agentId } });
  for (const k of spec.knowledge) {
    await prisma.trainingSource.create({
      data: { agentId, orgId: agent.orgId, type: k.type, dataJson: JSON.stringify(k.data), enabled: k.enabled },
    });
  }
}
