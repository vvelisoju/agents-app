// Cross-cutting Phase-0 security unit tests.
import { describe, it, expect } from 'vitest';
import { corsOriginFor } from '../src/app';
import { encryptSecret, decryptSecret, isEncrypted, decryptMaybe } from '../src/lib/crypto';
import { assertProdSecrets } from '../src/lib/env';

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

describe('secret encryption at rest (SEC-1 / SEC-2)', () => {
  it('round-trips and never stores plaintext', () => {
    const secret = '123456:ABC-DEF_telegram-bot-token';
    const blob = encryptSecret(secret);
    expect(blob).not.toContain('telegram-bot-token');
    expect(blob.startsWith('k1:')).toBe(true);
    expect(decryptSecret(blob)).toBe(secret);
  });
  it('isEncrypted + decryptMaybe handle legacy plaintext', () => {
    const blob = encryptSecret('tok');
    expect(isEncrypted(blob)).toBe(true);
    expect(isEncrypted('plain-legacy-token')).toBe(false);
    expect(decryptMaybe(blob)).toBe('tok');
    expect(decryptMaybe('plain-legacy-token')).toBe('plain-legacy-token'); // migration-safe
    expect(decryptMaybe('')).toBe('');
  });
});

describe('production secret fail-fast (SEC-17)', () => {
  it('passes outside production', () => {
    expect(() => assertProdSecrets()).not.toThrow(); // NODE_ENV=test
  });
  it('throws in production when a required secret is missing', () => {
    const prev = { node: process.env.NODE_ENV, key: process.env.ENCRYPTION_KEY };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ENCRYPTION_KEY;
      expect(() => assertProdSecrets()).toThrow(/ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENV = prev.node;
      if (prev.key !== undefined) process.env.ENCRYPTION_KEY = prev.key;
    }
  });
});
