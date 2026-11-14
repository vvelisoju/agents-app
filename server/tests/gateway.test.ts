// MGW-1/2/3/17 — model gateway: token capture, refusal handling, bounded retry.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { callModel, isRetryable } from '../src/lib/model-gateway';

beforeEach(() => createMock.mockReset());

describe('model gateway', () => {
  it('returns reply text and captures token usage', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'hi there' }],
      usage: { input_tokens: 10, output_tokens: 4 },
      stop_reason: 'end_turn',
    });
    const r = await callModel({ system: 's', prompt: 'p' });
    expect(r.text).toBe('hi there');
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(4);
    expect(r.refused).toBe(false);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty text on a refusal (unchanged behaviour)', async () => {
    createMock.mockResolvedValue({ content: [], usage: {}, stop_reason: 'refusal' });
    const r = await callModel({ system: 's', prompt: 'p' });
    expect(r.text).toBe('');
    expect(r.refused).toBe(true);
  });

  it('retries a transient 429 then succeeds', async () => {
    createMock
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' });
    const r = await callModel({ system: 's', prompt: 'p' });
    expect(r.text).toBe('ok');
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('classifies which errors are retryable', () => {
    expect(isRetryable({ status: 429 })).toBe(true); // rate limited
    expect(isRetryable({ status: 503 })).toBe(true); // server error
    expect(isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryable({ status: 400 })).toBe(false); // bad request — not retried
    expect(isRetryable({ status: 401 })).toBe(false); // auth — not retried
  });
});
