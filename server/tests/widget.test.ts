// FND-12/13/14/54 / QA-08 — website widget signed key + per-agent rate cap.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/lib/brain', () => ({ askClaude: vi.fn(), generate: vi.fn() }));

import request from 'supertest';
import { buildApp } from '../src/app';
import { generate } from '../src/lib/brain';
import { widgetKey, verifyWidgetKey } from '../src/lib/widgetKey';
import { _resetRateLimiter } from '../src/lib/rateLimiter';
import { createOrgWithAgent } from './helpers/factories';

const app = buildApp();
const gen = vi.mocked(generate);

beforeEach(() => {
  gen.mockReset();
  gen.mockResolvedValue({ text: 'Hi from the widget', model: 'm', provider: 'anthropic', inputTokens: 1, outputTokens: 1, latencyMs: 1, stopReason: 'end_turn', refused: false });
  _resetRateLimiter();
});

describe('website widget key', () => {
  it('signs and verifies per agent', () => {
    const k = widgetKey('agent-abc');
    expect(verifyWidgetKey('agent-abc', k)).toBe(true);
    expect(verifyWidgetKey('agent-abc', 'nope')).toBe(false);
    expect(verifyWidgetKey('other-agent', k)).toBe(false);
  });

  it('POST message rejects missing/wrong key, accepts the correct key', async () => {
    const { agent } = await createOrgWithAgent({ channelType: 'website', autoSend: true });
    const base = `/api/public/widget/${agent.id}/message`;

    expect((await request(app).post(base).send({ contactId: 'c1', text: 'hi' })).status).toBe(401);
    expect((await request(app).post(`${base}?key=wrong`).send({ contactId: 'c1', text: 'hi' })).status).toBe(401);

    const ok = await request(app).post(`${base}?key=${widgetKey(agent.id)}`).send({ contactId: 'c1', text: 'hi' });
    expect(ok.status).toBe(200);
    expect(ok.body.reply).toBe('Hi from the widget');
  });

  it('GET messages requires the key', async () => {
    const { agent } = await createOrgWithAgent({ channelType: 'website' });
    const url = `/api/public/widget/${agent.id}/messages?contactId=c1`;
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(`${url}&key=${widgetKey(agent.id)}`)).status).toBe(200);
  });

  it('rate-caps messages per agent (FND-13)', async () => {
    const { agent } = await createOrgWithAgent({ channelType: 'website', autoSend: true });
    const base = `/api/public/widget/${agent.id}/message?key=${widgetKey(agent.id)}`;
    let limited = false;
    for (let i = 0; i < 22; i++) {
      const r = await request(app).post(base).send({ contactId: 'c' + i, text: 'hi' });
      if (r.status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });
});
