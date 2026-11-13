import { describe, it, expect } from 'vitest';
import { composeSystemPrompt, applyLinks, trainingSummary, extractAlert, Source } from '../src/lib/training';
import { TEMPLATES, getTemplate } from '../src/lib/templates';
import { normaliseUrl, extractReadable } from '../src/lib/learn';
import { normalizeUpdate } from '../src/channels/telegram';
import { verifyPaymentSignature } from '../src/lib/razorpay';
import { normalizePhone, toWhatsappDigits, toWhatsappChatId } from '../src/lib/phone';
import crypto from 'crypto';

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
  it('omits the owner-alert instruction when no alert number is set', () => {
    expect(p).not.toContain('OWNER ALERTS');
  });
  it('adds the owner-alert instruction (with the default condition) when a number is set', () => {
    const withAlert = composeSystemPrompt({ ...agent, alertNumber: '7287820821' }, profile, sources);
    expect(withAlert).toContain('OWNER ALERTS');
    expect(withAlert).toContain('[[ALERT]]');
    expect(withAlert).toContain('get started right away'); // the default condition text
  });
  it('uses the owner\'s own alert condition verbatim when provided', () => {
    const withAlert = composeSystemPrompt({ ...agent, alertNumber: '7287820821', alertCondition: 'anyone mentions a wedding booking' }, profile, sources);
    expect(withAlert).toContain('anyone mentions a wedding booking');
    expect(withAlert).not.toContain('get started right away');
  });
});

describe('extractAlert', () => {
  it('pulls a leading alert line and strips it from the reply', () => {
    const { reason, clean } = extractAlert('[[ALERT]] wants a cabin today\nSure! We have a cabin free — can you visit at 4pm?');
    expect(reason).toBe('wants a cabin today');
    expect(clean).toBe('Sure! We have a cabin free — can you visit at 4pm?');
    expect(clean).not.toContain('[[ALERT]]');
  });
  it('returns no reason for a normal reply and leaves it intact', () => {
    const { reason, clean } = extractAlert('Our open desks start at ₹3,999/month.');
    expect(reason).toBeNull();
    expect(clean).toBe('Our open desks start at ₹3,999/month.');
  });
  it('tolerates spacing/colon variants and a misplaced line', () => {
    const { reason, clean } = extractAlert('Yes, come over!\n[[ ALERT ]]: ready to pay now');
    expect(reason).toBe('ready to pay now');
    expect(clean).toBe('Yes, come over!');
  });
  it('falls back to a default reason when the token has no text', () => {
    const { reason } = extractAlert('[[ALERT]]\nHello!');
    expect(reason).toBeTruthy();
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

describe('razorpay signature', () => {
  it('verifies a correct HMAC signature and rejects a wrong one', () => {
    const prev = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';
    const sig = crypto.createHmac('sha256', 'test_secret').update('order_1|pay_1').digest('hex');
    expect(verifyPaymentSignature('order_1', 'pay_1', sig)).toBe(true);
    expect(verifyPaymentSignature('order_1', 'pay_1', 'deadbeef')).toBe(false);
    process.env.RAZORPAY_KEY_SECRET = prev;
  });
});

describe('normalizePhone', () => {
  it('accepts a plain 10-digit mobile', () => {
    expect(normalizePhone('9494644848')).toBe('9494644848');
  });
  it('strips +91 / 91 / 0 prefixes and spacing', () => {
    expect(normalizePhone('+91 94946 44848')).toBe('9494644848');
    expect(normalizePhone('919494644848')).toBe('9494644848');
    expect(normalizePhone('09494644848')).toBe('9494644848');
  });
  it('rejects non-mobile / wrong-length numbers', () => {
    expect(normalizePhone('1234567890')).toBeNull(); // must start 6–9
    expect(normalizePhone('94946')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
  it('toWhatsappDigits prepends the country code', () => {
    expect(toWhatsappDigits('9494644848')).toBe('919494644848');
  });
  it('toWhatsappChatId builds a @c.us chat id and rejects junk', () => {
    expect(toWhatsappChatId('7287820821')).toBe('917287820821@c.us');
    expect(toWhatsappChatId('+91 72878 20821')).toBe('917287820821@c.us');
    expect(toWhatsappChatId('919494644848')).toBe('919494644848@c.us');
    expect(toWhatsappChatId('123')).toBeNull();
    expect(toWhatsappChatId('')).toBeNull();
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
