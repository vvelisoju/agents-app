// PDF / document ingestion — text extraction + the upload endpoint (condense into a training
// draft). pdf-parse and the model are mocked for determinism.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pdf-parse', () => ({
  default: vi.fn(async () => ({
    text: 'Secure Studio offers hot desks at Rs 3999 per month. Open Mon-Sat 9am to 6pm. Free wifi and coffee.',
    numpages: 2,
    info: { Title: 'Brochure' },
  })),
}));
vi.mock('../src/lib/brain', () => ({ askClaude: vi.fn(), generate: vi.fn() }));

import request from 'supertest';
import { buildApp } from '../src/app';
import { askClaude } from '../src/lib/brain';
import { extractPdfText } from '../src/lib/pdf';
import { createOrgWithAgent, createUser } from './helpers/factories';

const app = buildApp();
const ask = vi.mocked(askClaude);
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

beforeEach(() => ask.mockReset());

describe('PDF text extraction', () => {
  it('returns trimmed text, page count and title', async () => {
    const r = await extractPdfText(Buffer.from('%PDF-1.4 fake'));
    expect(r.text).toContain('hot desks');
    expect(r.pages).toBe(2);
    expect(r.title).toBe('Brochure');
  });
});

describe('POST /training/learn-document', () => {
  async function ownerAgent() {
    const { org, agent } = await createOrgWithAgent();
    const token = (await createUser(org.id, 'owner')).token;
    return { agentId: agent.id, token };
  }

  it('condenses an uploaded PDF into a confirmable training draft', async () => {
    const { agentId, token } = await ownerAgent();
    ask.mockResolvedValue(JSON.stringify({
      summary: 'A coworking space', instructions: 'Help customers and offer a visit.', tone: 'warm', language: 'match the customer',
      facts: ['Hot desk is Rs 3999/month', 'Open Mon-Sat 9-6'], faqs: [{ question: 'Wifi?', answer: 'Yes, free.' }], links: [],
    }));
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('binary-ish content here')]);
    const r = await request(app)
      .post(`/api/agents/${agentId}/training/learn-document?filename=brochure.pdf`)
      .set(auth(token)).set('Content-Type', 'application/pdf').send(pdf);
    expect(r.status).toBe(200);
    expect(r.body.suggestion.facts).toContain('Hot desk is Rs 3999/month');
    expect(r.body.suggestion.faqs[0].question).toBe('Wifi?');
    expect(r.body.source.title).toBe('Brochure');
    expect(ask).toHaveBeenCalledOnce(); // the condense step ran
  });

  it('rejects a body that is not a PDF (422)', async () => {
    const { agentId, token } = await ownerAgent();
    const r = await request(app)
      .post(`/api/agents/${agentId}/training/learn-document`)
      .set(auth(token)).set('Content-Type', 'application/pdf').send(Buffer.from('this is not a pdf'));
    expect(r.status).toBe(422);
    expect(ask).not.toHaveBeenCalled();
  });
});
