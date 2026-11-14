// Cross-cutting Phase-0 security unit tests.
import { describe, it, expect } from 'vitest';
import { corsOriginFor } from '../src/app';

describe('CORS origin resolution (FND-19 / QA-56)', () => {
  it('never reflects an arbitrary origin in production', () => {
    expect(corsOriginFor(undefined, true)).toBe(false); // prod + unset → same-origin only
    expect(corsOriginFor('', true)).toBe(false);
  });
  it('reflects any origin only in development', () => {
    expect(corsOriginFor(undefined, false)).toBe(true);
  });
  it('uses the explicit allowlist when CORS_ORIGIN is set', () => {
    expect(corsOriginFor('https://app.example, https://admin.example', true))
      .toEqual(['https://app.example', 'https://admin.example']);
    expect(corsOriginFor('https://app.example', false)).toEqual(['https://app.example']);
  });
});
