// SCN-01 — the reply prompt names the agent's OWN channel (from the adapter), and a WhatsApp
// agent's prompt is byte-for-byte what it was before (adapter label 'WhatsApp').
import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from '../src/lib/training';
import { register, getAdapter } from '../src/channels/registry';

// Register labeled adapters once (idempotent Map.set).
if (!getAdapter('whatsapp-web')) register({ type: 'whatsapp-web', onboarding: 'qr', label: 'WhatsApp', send: async () => {} } as any);
register({ type: 'website', onboarding: 'none', label: 'Website', send: async () => {} } as any);

const agent = (channelType: string) => ({ name: 'Secure Studio', channelType });

describe('channel-aware reply prompt (SCN-01)', () => {
  it('names WhatsApp for a whatsapp-web agent (byte-identical to the old hardcoded text)', () => {
    const p = composeSystemPrompt(agent('whatsapp-web'), null, []);
    expect(p).toContain('You are the friendly WhatsApp assistant for "Secure Studio". You reply to people who message the business on WhatsApp.');
    expect(p).toContain('this is WhatsApp.');
    expect(p).not.toContain('Website');
  });

  it('names the website for a website agent (no WhatsApp literal)', () => {
    const p = composeSystemPrompt(agent('website'), null, []);
    expect(p).toContain('You are the friendly Website assistant for "Secure Studio". You reply to people who message the business on Website.');
    expect(p).toContain('this is Website.');
    expect(p).not.toContain('on WhatsApp');
  });

  it('falls back to WhatsApp when the adapter has no label', () => {
    const p = composeSystemPrompt(agent('unregistered-type'), null, []);
    expect(p).toContain('friendly WhatsApp assistant');
  });
});
