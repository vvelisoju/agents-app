// STU-7/8/17/19 — channel catalog from the registry + NL agent builder.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/lib/brain', () => ({ askClaude: vi.fn(), generate: vi.fn() }));

import request from 'supertest';
import { buildApp } from '../src/app';
import { generate } from '../src/lib/brain';
import { createOrg, createUser } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });
const gen = vi.mocked(generate);
const model = (text: string) => ({ text, model: 'm', provider: 'anthropic', inputTokens: 1, outputTokens: 1, latencyMs: 1, stopReason: 'end_turn', refused: false });

beforeEach(() => gen.mockReset());

describe('Agent Studio', () => {
  it('GET /api/channels lists channels from the adapter registry (not a hardcoded list)', async () => {
    const org = await createOrg();
    const u = await createUser(org.id, 'owner');
    const r = await request(app).get('/api/channels').set(auth(u.token));
    expect(r.status).toBe(200);
    const types = r.body.channels.map((c: any) => c.type);
    expect(types).toContain('website');
    expect(types).toContain('telegram');
    expect(types).not.toContain('test'); // test-only adapter excluded
    expect(r.body.channels.find((c: any) => c.type === 'website').label).toBe('Website');
  });

  it('POST /api/agents/build drafts a validated spec from a plain description', async () => {
    const org = await createOrg();
    const u = await createUser(org.id, 'owner');
    gen.mockResolvedValue(model(JSON.stringify({
      name: 'Salon Bot', instructions: 'Help salon customers and offer to book.', tone: 'warm',
      language: 'match the customer', facts: ['Open 9-6 Mon-Sat'], faqs: [{ question: 'Hours?', answer: '9-6' }], links: [],
    })));
    const r = await request(app).post('/api/agents/build').set(auth(u.token))
      .send({ description: 'A bot for my salon that answers questions and books appointments' });
    expect(r.status).toBe(200);
    expect(r.body.spec.identity.name).toBe('Salon Bot');
    expect(r.body.spec.knowledge).toHaveLength(2); // 1 fact + 1 faq
    expect(r.body.spec.behavior.approval).toBe('draft'); // never auto-send a brand-new agent
  });

  it('rejects an empty description (400)', async () => {
    const org = await createOrg();
    const u = await createUser(org.id, 'owner');
    const r = await request(app).post('/api/agents/build').set(auth(u.token)).send({ description: '' });
    expect(r.status).toBe(400);
  });
});
