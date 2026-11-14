// FND-40 / QA-04 / QA-05 — money & safety path regression tests.
// Pin the current reply behaviour (auto-send vs draft, NEEDS_HUMAN escalation, the
// [[ALERT]] owner ping, and {{LINK}} substitution) so the gateway/trace/budget work
// cannot silently change what an agent sends. The engine calls brain.generate (usage
// capture), so that is what we mock.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/lib/brain', () => ({ askClaude: vi.fn(), generate: vi.fn() }));

import prisma from '../src/lib/prisma';
import { generate } from '../src/lib/brain';
import { processInbound } from '../src/engine/engine';
import { createOrgWithAgent, addSource } from './helpers/factories';
import { sends, resetSends } from './helpers/mockChannel';

const gen = vi.mocked(generate);
const reply = (text: string) => ({
  text, model: 'claude-haiku-5-5', provider: 'anthropic',
  inputTokens: 5, outputTokens: 2, latencyMs: 1, stopReason: 'end_turn', refused: false,
});

beforeEach(() => {
  gen.mockReset();
  resetSends();
});

const inbound = (text: string, from = '919000000001@c.us') => ({ from, contactName: 'Customer', text });

describe('reply engine — money & safety path', () => {
  it('auto-send: delivers the model reply and logs it as sent', async () => {
    const { agent } = await createOrgWithAgent({ autoSend: true });
    gen.mockResolvedValue(reply('Hello! How can we help?'));

    const res = await processInbound(agent.id, inbound('hi, what are your prices?'));

    expect(res.status).toBe('sent');
    expect(sends).toHaveLength(1);
    expect(sends[0].text).toBe('Hello! How can we help?');
    const msgs = await prisma.message.findMany({ where: { agentId: agent.id, direction: 'outbound' } });
    expect(msgs.some((m) => m.status === 'sent' && m.body === 'Hello! How can we help?')).toBe(true);
  });

  it('approve-before-send: saves a draft and sends nothing when autoSend is off', async () => {
    const { agent } = await createOrgWithAgent({ autoSend: false });
    gen.mockResolvedValue(reply('Draft reply'));

    const res = await processInbound(agent.id, inbound('a question'));

    expect(res.status).toBe('draft');
    expect(sends).toHaveLength(0);
    const draft = await prisma.message.findFirst({ where: { agentId: agent.id, status: 'draft' } });
    expect(draft?.body).toBe('Draft reply');
  });

  it('ack filter: a bare "ok" is ignored and never calls the model', async () => {
    const { agent } = await createOrgWithAgent();
    const res = await processInbound(agent.id, inbound('ok'));
    expect(res.status).toBe('ignored');
    expect(gen).not.toHaveBeenCalled();
    expect(sends).toHaveLength(0);
  });

  it('NEEDS_HUMAN: escalates, sends nothing to the customer', async () => {
    const { agent } = await createOrgWithAgent({ autoSend: true });
    gen.mockResolvedValue(reply('NEEDS_HUMAN'));

    const res = await processInbound(agent.id, inbound('I want a refund, this is terrible'));

    expect(res.status).toBe('needs_human');
    expect(sends).toHaveLength(0);
    const msg = await prisma.message.findFirst({ where: { agentId: agent.id, status: 'needs_human' } });
    expect(msg).toBeTruthy();
  });

  it('[[ALERT]]: pings the owner, strips the control line from the customer reply', async () => {
    const { agent } = await createOrgWithAgent({ autoSend: true, alertNumber: '9876543210' });
    gen.mockResolvedValue(reply('[[ALERT]] ready-to-buy lead\nHi! Yes, we can set that up today.'));

    const res = await processInbound(agent.id, inbound('I want to sign up right now'));

    expect(res.status).toBe('sent');
    expect(sends).toHaveLength(2); // owner alert + clean customer reply
    const customerReply = sends.find((s) => s.text.includes('set that up today'));
    expect(customerReply).toBeTruthy();
    expect(customerReply!.text).not.toContain('[[ALERT]]');
    const ownerAlert = sends.find((s) => s.text.includes('flagged') || s.text.includes('ready-to-buy'));
    expect(ownerAlert).toBeTruthy();
    const conv = await prisma.conversation.findFirst({ where: { agentId: agent.id } });
    expect(conv?.alertedAt).toBeTruthy();
  });

  it('{{LINK:Name}}: substitutes the exact owner-whitelisted URL, never the model text', async () => {
    const { agent } = await createOrgWithAgent({ autoSend: true });
    await addSource(agent.id, 'link', { name: 'Book', url: 'https://book.example/slot' });
    gen.mockResolvedValue(reply('Sure — book here: {{LINK:Book}}'));

    const res = await processInbound(agent.id, inbound('can I book a visit?'));

    expect(res.status).toBe('sent');
    expect(sends[0].text).toBe('Sure — book here: https://book.example/slot');
    expect(sends[0].text).not.toContain('{{LINK');
  });
});

describe('reply engine — per-conversation serialization (FND-30 / QA-06)', () => {
  it('serializes concurrent messages from the same contact; parallelizes different contacts', async () => {
    const { agent } = await createOrgWithAgent({ autoSend: true });
    let active = 0;
    let maxActive = 0;
    gen.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return reply('reply');
    });

    await Promise.all([
      processInbound(agent.id, inbound('first', '915550000001@c.us')),
      processInbound(agent.id, inbound('second', '915550000001@c.us')),
    ]);
    expect(maxActive).toBe(1);
    const convs = await prisma.conversation.findMany({ where: { agentId: agent.id, contactNumber: '915550000001@c.us' } });
    expect(convs).toHaveLength(1);
    const outbound = await prisma.message.findMany({ where: { agentId: agent.id, direction: 'outbound' } });
    expect(outbound).toHaveLength(2);

    active = 0;
    maxActive = 0;
    await Promise.all([
      processInbound(agent.id, inbound('a', '917770000001@c.us')),
      processInbound(agent.id, inbound('b', '918880000001@c.us')),
    ]);
    expect(maxActive).toBe(2);
  });
});
