// SPEC-6/10/24 / STU-4 — Agent Spec round-trip, versioning, rollback, clone.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import prisma from '../src/lib/prisma';
import { specFromAgent, applySpec } from '../src/lib/agentSpec';
import { createOrg, createUser, createAgent, addSource } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('Agent Spec', () => {
  it('round-trips through applySpec (specFromAgent ∘ applySpec === spec)', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, { name: 'Round', channelType: 'website', autoSend: true, alertNumber: '9876543210' });
    await addSource(agent.id, 'fact', { content: 'Open 9-5' });
    await addSource(agent.id, 'link', { name: 'Book', url: 'https://x.com' });
    await prisma.trainingProfile.update({ where: { agentId: agent.id }, data: { instructions: 'Be helpful', tone: 'warm' } });

    const spec1 = await specFromAgent(agent.id);
    await applySpec(agent.id, spec1!);
    const spec2 = await specFromAgent(agent.id);

    expect(spec2).toEqual(spec1);
    expect(spec2!.knowledge).toHaveLength(2);
    expect(spec2!.behavior.approval).toBe('auto');
  });

  it('publish → edit → rollback restores the prior training', async () => {
    const org = await createOrg();
    const owner = await createUser(org.id, 'owner');
    const agent = await createAgent(org.id, { name: 'V1' });
    await prisma.trainingProfile.update({ where: { agentId: agent.id }, data: { instructions: 'first' } });

    const pub = await request(app).post(`/api/agents/${agent.id}/versions`).set(auth(owner.token)).send({ note: 'v1' });
    expect(pub.status).toBe(200);
    expect(pub.body.version).toBe(1);

    const spec = (await specFromAgent(agent.id))!;
    await applySpec(agent.id, { ...spec, persona: { ...spec.persona, instructions: 'second' } });
    expect((await prisma.trainingProfile.findUnique({ where: { agentId: agent.id } }))!.instructions).toBe('second');

    const rb = await request(app).post(`/api/agents/${agent.id}/rollback`).set(auth(owner.token)).send({ version: 1 });
    expect(rb.status).toBe(200);
    expect((await prisma.trainingProfile.findUnique({ where: { agentId: agent.id } }))!.instructions).toBe('first');
  });

  it('clone creates a new agent with the same training', async () => {
    const org = await createOrg();
    const owner = await createUser(org.id, 'owner');
    const agent = await createAgent(org.id, { name: 'Original' });
    await addSource(agent.id, 'fact', { content: 'cloned fact' });

    const res = await request(app).post(`/api/agents/${agent.id}/clone`).set(auth(owner.token)).send({ name: 'Copy' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Copy');
    const sources = await prisma.trainingSource.findMany({ where: { agentId: res.body.id } });
    expect(sources).toHaveLength(1);
    expect(JSON.parse(sources[0].dataJson).content).toBe('cloned fact');
  });

  it('rejects an invalid spec with 400', async () => {
    const org = await createOrg();
    const owner = await createUser(org.id, 'owner');
    const agent = await createAgent(org.id);
    const res = await request(app).post(`/api/agents/${agent.id}/apply-spec`).set(auth(owner.token)).send({ spec: { identity: {} } });
    expect(res.status).toBe(400);
  });
});
