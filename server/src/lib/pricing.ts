// Phase 2 (OBS) — indicative model pricing for cost capture. callModel already returns
// inputTokens/outputTokens (see model-gateway.ts); this turns those into a stored cost
// so per-tenant budget gating and execution traces have a number to sum.
//
// Prices are INDICATIVE USD per 1,000,000 tokens (list price, no discounts). Treat them
// as an estimate for accounting, not billing truth. Keep keys aligned with AGENT_MODEL
// and callModel's DEFAULT_MODEL ('claude-haiku-5-5').

export interface ModelPrice {
  inputPerM: number;  // USD per 1M input tokens
  outputPerM: number; // USD per 1M output tokens
}

// '*' is the fallback used for any model not listed below.
export const PRICES: Record<string, ModelPrice> = {
  'claude-haiku-5-5': { inputPerM: 1.0, outputPerM: 5.0 },
  '*': { inputPerM: 3.0, outputPerM: 15.0 },
};

/**
 * Estimated cost of a single model call, as an integer number of MICRO-USD
 * (1 USD = 1,000,000 micro-USD) so callers can sum costs without float drift.
 *
 * Since a price is USD per 1M tokens, one token costs exactly `pricePerM` micro-USD,
 * i.e. micros = inputTokens * inputPerM + outputTokens * outputPerM (then rounded).
 * Unknown models fall back to PRICES['*']; negative token counts are clamped to 0.
 */
export function costMicros(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? PRICES['*'];
  const inTok = Math.max(0, inputTokens || 0);
  const outTok = Math.max(0, outputTokens || 0);
  return Math.round(inTok * p.inputPerM + outTok * p.outputPerM);
}
