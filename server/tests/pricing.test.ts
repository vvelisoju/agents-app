// Phase 2 (OBS) — cost math for captured token usage. Pure/offline: no DB, no network.
import { describe, it, expect } from 'vitest';
import { PRICES, costMicros } from '../src/lib/pricing';

describe('costMicros (model pricing)', () => {
  it('computes a known model exactly in micro-USD', () => {
    // claude-haiku-5-5: $1.0/1M in, $5.0/1M out. 1M in + 1M out = 1_000_000 + 5_000_000.
    expect(costMicros('claude-haiku-5-5', 1_000_000, 1_000_000)).toBe(6_000_000);
    // A token costs exactly its per-M price in micro-USD: 1000 in + 200 out = 1000 + 1000.
    expect(costMicros('claude-haiku-5-5', 1000, 200)).toBe(2000);
  });

  it('falls back to PRICES["*"] for an unknown model', () => {
    const { inputPerM, outputPerM } = PRICES['*'];
    const expected = Math.round(1000 * inputPerM + 2000 * outputPerM);
    expect(costMicros('some-future-model', 1000, 2000)).toBe(expected);
  });

  it('returns an integer and clamps negatives/zero to 0', () => {
    expect(costMicros('claude-haiku-5-5', 0, 0)).toBe(0);
    expect(costMicros('claude-haiku-5-5', -5, -5)).toBe(0);
    expect(Number.isInteger(costMicros('claude-haiku-5-5', 123, 456))).toBe(true);
  });
});
