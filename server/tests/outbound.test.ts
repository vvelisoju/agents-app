// SCN-07/10/19 (foundation) — STOP opt-out matcher + hot-path behavior, suppression store,
// and the per-agent send mutex. Drip-handler/cap/window tests land with SCN-09.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/lib/brain', () => ({ askClaude: vi.fn(), generate: vi.fn() }));

import prisma from '../src/lib/prisma';
import { generate } from '../src/lib/brain';
import { processInbound } from '../src/engine/engine';
import { isOptOutMessage, isSuppressed } from '../src/lib/optout';
import { withSendLock } from '../src/lib/sendMutex';
import { createOrgWithAgent } from './helpers/factories';
import { sends, resetSends } from './helpers/mockChannel';

const gen = vi.mocked(generate);
const reply = (text: string) => ({ text, model: 'm', provider: 'anthropic', inputTokens: 1, outputTokens: 1, latencyMs: 1, stopReason: 'end_turn', refused: false });
const inbound = (text: string, from = '919000000001@c.us') => ({ from, contactName: 'C', text });

beforeEach(() => { gen.mockReset(); resetSends(); });

describe('opt-out matcher (SCN-10)', () => {
  it('matches short stop/unsubscribe messages (multi-lingual)', () => {
    for (const s of ['STOP', 'stop', 'Unsubscribe', 'opt out', 'band karo', 'STOP please', 'remove me', 'ఆపు']) {
      expect(isOptOutMessage(s)).toBe(true);
    }
  });
  it('does NOT match a normal sentence that merely contains "stop"', () => {
    for (const s of ['can you stop by at 5pm?', 'where is the bus stop', 'please do not stop the service, I love it']) {
      expect(isOptOutMessage(s)).toBe(false);
    }
  });
});

describe('STOP opt-out in processInbound (SCN-10)', () => {
  const prev = process.env.OUTBOUND_ENABLED;
  afterEach(() => { if (prev === undefined) delete process.env.OUTBOUND_ENABLED; else process.env.OUTBOUND_ENABLED = prev; });

  it('suppresses the contact, confirms once, and does NOT call the model', async () => {
    process.env.OUTBOUND_ENABLED = '1';
    const { agent } = await createOrgWithAgent({ autoSend: true });
    const res = await processInbound(agent.id, inbound('STOP'));
    expect(res.status).toBe('opted_out');
    expect(gen).not.toHaveBeenCalled(); // never spends a model call
    expect(sends).toHaveLength(1); // one neutral confirmation
    expect(await isSuppressed(agent.id, '919000000001@c.us')).toBe(true);
    const out = await prisma.message.findMany({ where: { agentId: agent.id, direction: 'outbound' } });
    expect(out.some((m) => m.status === 'opted_out')).toBe(true);
  });

  it('with OUTBOUND_ENABLED off, a "STOP" flows to the AI exactly as today (byte-for-byte)', async () => {
    delete process.env.OUTBOUND_ENABLED;
    const { agent } = await createOrgWithAgent({ autoSend: true });
    gen.mockResolvedValue(reply('Sure — how can we help?'));
    const res = await processInbound(agent.id, inbound('stop'));
    expect(res.status).toBe('sent'); // normal reply path
    expect(gen).toHaveBeenCalledOnce();
    expect(await isSuppressed(agent.id, '919000000001@c.us')).toBe(false);
  });

  it('a non-STOP message still reaches the AI when outbound is enabled', async () => {
    process.env.OUTBOUND_ENABLED = '1';
    const { agent } = await createOrgWithAgent({ autoSend: true });
    gen.mockResolvedValue(reply('Hello!'));
    const res = await processInbound(agent.id, inbound('what are your prices?'));
    expect(res.status).toBe('sent');
    expect(gen).toHaveBeenCalledOnce();
  });
});

describe('per-agent send mutex (SCN-07)', () => {
  it('serializes sends for one agent (no interleave)', async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const makeSend = (i: number) => async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      order.push(i);
      active--;
      return i;
    };
    await Promise.all([1, 2, 3].map((i) => withSendLock('agent-1', makeSend(i))));
    expect(maxActive).toBe(1); // never two sends at once for the same agent
    expect(order).toEqual([1, 2, 3]); // FIFO
  });

  it('allows different agents to send concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const slow = async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 15)); active--; };
    await Promise.all([withSendLock('a', slow), withSendLock('b', slow)]);
    expect(maxActive).toBe(2);
  });
});
