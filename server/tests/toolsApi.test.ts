// TOOL-15/18 — HTTP coverage for the agent tools catalog + selection and the execution
// viewer. Importing the builtin bundle self-registers every first-party tool so the catalog
// is populated (mirrors the server boot path). Deterministic + offline: no tool is executed,
// executions are seeded directly as ExecutionStep rows.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import prisma from '../src/lib/prisma';
import { buildApp } from '../src/app';
import '../src/tools/builtin'; // self-registers knowledge.search, crm.create_lead, etc.
import { createOrg, createUser, createAgent } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('Agent tools + executions API', () => {
  let orgId: string;
  let token: string;
  let agentId: string;

  beforeEach(async () => {
    const org = await createOrg();
    orgId = org.id;
    token = (await createUser(orgId, 'owner')).token;
    agentId = (await createAgent(orgId)).id;
  });

  describe('GET /tools', () => {
    it('lists registered tools with side-effect + approval implication', async () => {
      const r = await request(app).get(`/api/agents/${agentId}/tools`).set(auth(token));
      expect(r.status).toBe(200);
      expect(r.body.executionMode).toBe('reply'); // default — nothing enabled yet
      const byName: Record<string, any> = Object.fromEntries(r.body.tools.map((t: any) => [t.name, t]));

      // A read-only tool needs no approval; a write tool does.
      const read = byName['knowledge.search'];
      expect(read).toBeTruthy();
      expect(read.sideEffect).toBe('read');
      expect(read.needsApproval).toBe(false);
      expect(read.enabled).toBe(false);

      const write = byName['crm.create_lead'];
      expect(write).toBeTruthy();
      expect(write.sideEffect).toBe('write');
      expect(write.needsApproval).toBe(true); // anything that isn't 'read' is gated
      expect(write.enabled).toBe(false);
    });
  });

  describe('PUT /tools', () => {
    it('enabling a known tool flips the agent to agentic; clearing reverts to reply', async () => {
      const on = await request(app)
        .put(`/api/agents/${agentId}/tools`)
        .set(auth(token))
        .send({ tools: ['knowledge.search'] });
      expect(on.status).toBe(200);
      expect(on.body.ok).toBe(true);
      expect(on.body.tools).toEqual(['knowledge.search']);
      expect(on.body.executionMode).toBe('agentic');

      // Persisted: the catalog now reports the tool enabled under agentic mode.
      const after = await request(app).get(`/api/agents/${agentId}/tools`).set(auth(token));
      expect(after.body.executionMode).toBe('agentic');
      expect(after.body.tools.find((t: any) => t.name === 'knowledge.search').enabled).toBe(true);

      // Clearing all tools returns the agent to the byte-for-byte reply path.
      const off = await request(app)
        .put(`/api/agents/${agentId}/tools`)
        .set(auth(token))
        .send({ tools: [] });
      expect(off.status).toBe(200);
      expect(off.body.tools).toEqual([]);
      expect(off.body.executionMode).toBe('reply');
      const reloaded = await prisma.agent.findUnique({ where: { id: agentId } });
      expect(reloaded?.executionMode).toBe('reply');
      expect(JSON.parse(reloaded?.enabledToolsJson || '[]')).toEqual([]);
    });

    it('ignores unknown tool names', async () => {
      const r = await request(app)
        .put(`/api/agents/${agentId}/tools`)
        .set(auth(token))
        .send({ tools: ['knowledge.search', 'does.not.exist', 42] });
      expect(r.status).toBe(200);
      expect(r.body.tools).toEqual(['knowledge.search']); // unknown + non-string dropped
      expect(r.body.executionMode).toBe('agentic');
    });

    it('persists nothing agentic when every requested tool is unknown', async () => {
      const r = await request(app)
        .put(`/api/agents/${agentId}/tools`)
        .set(auth(token))
        .send({ tools: ['ghost.tool'] });
      expect(r.status).toBe(200);
      expect(r.body.tools).toEqual([]);
      expect(r.body.executionMode).toBe('reply'); // no known tool → stays on reply
    });
  });

  describe('GET /executions', () => {
    it('returns recent ExecutionStep rows grouped by executionId with ordered steps', async () => {
      // Two executions for this agent; seed steps out of order to prove sorting by stepIndex.
      await prisma.executionStep.createMany({
        data: [
          { orgId, agentId, executionId: 'exec-A', stepIndex: 1, toolName: 'crm.create_lead', outcome: 'pending_approval', approvalState: 'pending_approval', latencyMs: 12 },
          { orgId, agentId, executionId: 'exec-A', stepIndex: 0, toolName: 'knowledge.search', outcome: 'ok', approvalState: 'inline', latencyMs: 5 },
          { orgId, agentId, executionId: 'exec-B', stepIndex: 0, toolName: 'knowledge.search', outcome: 'ok', approvalState: 'inline', latencyMs: 7 },
        ],
      });

      const r = await request(app).get(`/api/agents/${agentId}/executions`).set(auth(token));
      expect(r.status).toBe(200);
      expect(r.body.executions).toHaveLength(2);

      const execA = r.body.executions.find((e: any) => e.executionId === 'exec-A');
      expect(execA).toBeTruthy();
      expect(execA.steps.map((s: any) => s.stepIndex)).toEqual([0, 1]); // ordered by stepIndex
      expect(execA.steps.map((s: any) => s.tool)).toEqual(['knowledge.search', 'crm.create_lead']);
      expect(execA.steps[1].outcome).toBe('pending_approval');
      expect(execA.steps[1].approvalState).toBe('pending_approval');
      expect(execA.steps[0].latencyMs).toBe(5);

      const execB = r.body.executions.find((e: any) => e.executionId === 'exec-B');
      expect(execB.steps).toHaveLength(1);
    });

    it('is scoped to the agent/org — other agents and orgs are not returned', async () => {
      const otherAgent = (await createAgent(orgId)).id;
      await prisma.executionStep.create({ data: { orgId, agentId: otherAgent, executionId: 'exec-other-agent', stepIndex: 0, toolName: 'knowledge.search', outcome: 'ok' } });

      const other = await createOrg();
      const otherOrgAgent = (await createAgent(other.id)).id;
      await prisma.executionStep.create({ data: { orgId: other.id, agentId: otherOrgAgent, executionId: 'exec-other-org', stepIndex: 0, toolName: 'knowledge.search', outcome: 'ok' } });

      await prisma.executionStep.create({ data: { orgId, agentId, executionId: 'exec-mine', stepIndex: 0, toolName: 'knowledge.search', outcome: 'ok' } });

      const r = await request(app).get(`/api/agents/${agentId}/executions`).set(auth(token));
      expect(r.status).toBe(200);
      const ids = r.body.executions.map((e: any) => e.executionId);
      expect(ids).toEqual(['exec-mine']);
    });
  });
});
