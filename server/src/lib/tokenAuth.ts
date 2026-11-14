// SEC — bearer-token hardening helpers (pure, no DB).
//
// We never want to store raw bearer tokens at rest: a DB leak would hand an
// attacker live credentials. Instead we store only a one-way hash and compare
// hash(incoming) on each request. Bearer tokens are high-entropy random values
// (not user-chosen passwords), so a plain unsalted SHA-256 is both safe (no
// practical preimage/brute-force) and fast enough for a per-request lookup —
// bcrypt/argon2 would needlessly slow the hot auth path and can't be used in a
// simple `where: { tokenHash }` index lookup anyway.
//
// Tokens also expire: we stamp an expiry on issue and reject stale ones so a
// leaked-but-forgotten token can't live forever.
import crypto from 'node:crypto';

/** How long an issued bearer token stays valid. 30 days. */
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One-way hash of a raw bearer token for storage/lookup.
 * Deterministic (same input → same output) so we can index and look up by it.
 * SHA-256 hex; unsalted is fine because tokens are high-entropy random secrets.
 */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

/** Generate a fresh, cryptographically-random raw token (32 bytes → 64 hex chars). */
export function newRawToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Expiry instant for a token issued now (or at `now` ms epoch, for tests). */
export function tokenExpiry(now: number = Date.now()): Date {
  return new Date(now + TOKEN_TTL_MS);
}

/**
 * True if the token is past its expiry. A null/undefined expiry is treated as
 * NOT expired (legacy tokens issued before expiry tracking existed stay valid
 * until rotated), keeping the migration non-breaking.
 */
export function isExpired(expiresAt?: Date | null): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now();
}
