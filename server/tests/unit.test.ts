import { describe, it, expect } from 'vitest';
import { composeSystemPrompt, applyLinks, trainingSummary, Source } from '../src/lib/training';
import { TEMPLATES, getTemplate } from '../src/lib/templates';
import { normaliseUrl, extractReadable } from '../src/lib/learn';
import { normalizeUpdate } from '../src/channels/telegram';

const agent = { name: 'Secure Studio' };
const profile = {
  instructions: 'Greet warmly and offer a free tour.',
  restrictions: 'Never quote a final price.',
  tone: 'warm', language: 'match the customer', escalationKeyword: 'NEEDS_HUMAN',
};
const sources: Source[] = [
  { id: '1', type: 'fact', data: { content: 'Open desk from Rs 3,999/month.' }, enabled: true },
  { id: '2', type: 'link', data: { name: 'Location', url: 'https://g.co/kgs/HSBJ9v8' }, enabled: true },
  { id: '3', type: 'faq', data: { question: 'Parking?', answer: 'Yes, free.' }, enabled: true },
  { id: '4', type: 'fact', data: { content: 'DISABLED FACT' }, enabled: false },
];

describe('composeSystemPrompt', () => {
  const p = composeSystemPrompt(agent, profile, sources);
  it('includes the agent name, instructions and restrictions', () => {
    expect(p).toContain('Secure Studio');
    expect(p).toContain('Greet warmly');
    expect(p).toContain('Never quote a final price');
  });
  it('includes enabled facts + faqs but not disabled sources', () => {
    expect(p).toContain('Open desk from Rs 3,999/month.');
    expect(p).toContain('Parking?');
    expect(p).not.toContain('DISABLED FACT');
  });
  it('instructs the model to use the exact {{LINK:Name}} token', () => {
    expect(p).toContain('{{LINK:Location}}');
  });
  it('includes the escalation keyword', () => {
    expect(p).toContain('NEEDS_HUMAN');
  });
});

describe('applyLinks', () => {
  it('swaps {{LINK:Name}} for the exact URL', () => {
    const out = applyLinks('Here: {{LINK:Location}} — come by!', sources);
    expect(out).toBe('Here: https://g.co/kgs/HSBJ9v8 — come by!');
  });
  it('leaves tokens for disabled/missing links untouched', () => {
    expect(applyLinks('{{LINK:Nope}}', sources)).toBe('{{LINK:Nope}}');
  });
});

describe('trainingSummary', () => {
  it('counts only enabled sources', () => {
    const s = trainingSummary(profile, sources);
    expect(s).toContain('1 fact(s)');
    expect(s).toContain('1 link(s)');
    expect(s).toContain('1 FAQ(s)');
  });
});

describe('templates', () => {
  it('has 7 verticals and resolves by id', () => {
    expect(TEMPLATES.length).toBe(7);
    expect(getTemplate('coworking')?.instructions).toMatch(/coworking/i);
    expect(getTemplate('does-not-exist')).toBeUndefined();
  });
});

describe('telegram normalizeUpdate', () => {
  it('normalizes a text message to the common InboundMessage', () => {
    const r = normalizeUpdate({ update_id: 1, message: { chat: { id: 123 }, from: { first_name: 'Asha', last_name: 'K' }, text: 'hi' } });
    expect(r).toEqual({ from: 'tg:123', contactName: 'Asha K', text: 'hi' });
  });
  it('ignores non-text or malformed updates', () => {
    expect(normalizeUpdate({ message: { chat: { id: 1 }, photo: [] } })).toBeNull();
    expect(normalizeUpdate({})).toBeNull();
    expect(normalizeUpdate(null)).toBeNull();
  });
});

describe('learn helpers', () => {
  it('normaliseUrl adds https and validates', () => {
    expect(normaliseUrl('secure.studio')).toBe('https://secure.studio/');
    expect(() => normaliseUrl('')).toThrow();
  });
  it('extractReadable pulls title + text, strips scripts', () => {
    const html = '<html><head><title>My Shop</title></head><body><script>var x=1</script><p>We sell shoes</p></body></html>';
    const { title, text } = extractReadable(html);
    expect(title).toBe('My Shop');
    expect(text).toContain('We sell shoes');
    expect(text).not.toContain('var x=1');
  });
});
