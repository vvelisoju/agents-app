// Unit tests for bearer-token hardening helpers (SEC). Pure + offline — no DB.
import { describe, it, expect } from 'vitest';
import {
  hashToken,
  newRawToken,
  tokenExpiry,
  isExpired,
  TOKEN_TTL_MS,
} from '../src/lib/tokenAuth';

describe('hashToken', () => {
  it('is deterministic for the same input', () => {
    const raw = 'abc123-some-raw-token';
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });

  it('returns a 64-char lowercase hex SHA-256 digest', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns the raw token itself', () => {
    const raw = newRawToken();
    expect(hashToken(raw)).not.toBe(raw);
  });
});

describe('newRawToken', () => {
  it('returns 64 hex chars (32 random bytes)', () => {
    expect(newRawToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unique across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(newRawToken());
    expect(seen.size).toBe(100);
  });
});

describe('tokenExpiry', () => {
  it('is now + TTL for an explicit now', () => {
    const now = 1_000_000_000_000;
    expect(tokenExpiry(now).getTime()).toBe(now + TOKEN_TTL_MS);
  });

  it('defaults to roughly now + TTL', () => {
    const before = Date.now();
    const exp = tokenExpiry().getTime();
    const after = Date.now();
    expect(exp).toBeGreaterThanOrEqual(before + TOKEN_TTL_MS);
    expect(exp).toBeLessThanOrEqual(after + TOKEN_TTL_MS);
  });
});

describe('isExpired', () => {
  it('is true for a past expiry', () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
  });

  it('is false for a future expiry', () => {
    expect(isExpired(new Date(Date.now() + TOKEN_TTL_MS))).toBe(false);
  });

  it('treats null/undefined as not expired (legacy, migration-safe)', () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired(undefined)).toBe(false);
  });
});
