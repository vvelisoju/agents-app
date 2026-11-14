// SEC-3 (Phase 3) — encrypted credential store over the ConnectedAccount table.
//
// Third-party credentials (OAuth tokens, API keys for connected providers) are never
// stored as plaintext: we encrypt with lib/crypto.encryptSecret (AES-256-GCM, keyId
// `k1`) and persist only the ciphertext blob in `encBlob`. Reads decrypt on demand;
// listings are masked and can never surface the secret.
//
// "One active credential per (orgId, provider, agentId)": saveSecret replaces the
// existing active row for that tuple rather than piling up duplicates. agentId is
// optional — an org-level credential (no agent) and an agent-scoped one are distinct.
import prisma from './prisma';
import { encryptSecret, decryptSecret } from './crypto';

const KEY_ID = 'k1'; // current encryption key id (mirrors crypto.CURRENT_KEY_ID)
const ACTIVE = 'active';

export interface SaveSecretOpts {
  agentId?: string;
  scopes?: string;
  expiresAt?: Date;
}

/** A masked view of a stored credential — never includes the secret or its ciphertext. */
export interface MaskedAccount {
  id: string;
  provider: string;
  agentId: string | null;
  status: string;
  createdAt: Date;
}

// Prisma's nullable scalar filters need an explicit `null` (not `undefined`) to match
// rows where the column IS NULL — normalise once so org-level lookups are consistent.
function agentFilter(agentId?: string) {
  return agentId == null ? null : agentId;
}

/**
 * Encrypt `plaintext` and store it as the single active credential for
 * (orgId, provider, agentId). If an active row already exists for that tuple it is
 * replaced (updated in place); otherwise a new row is created. Returns the row id.
 */
export async function saveSecret(
  orgId: string,
  provider: string,
  plaintext: string,
  opts: SaveSecretOpts = {},
): Promise<string> {
  const agentId = agentFilter(opts.agentId);
  const encBlob = encryptSecret(plaintext);

  const existing = await prisma.connectedAccount.findFirst({
    where: { orgId, provider, agentId, status: ACTIVE },
    select: { id: true },
  });

  if (existing) {
    await prisma.connectedAccount.update({
      where: { id: existing.id },
      data: {
        encBlob,
        keyId: KEY_ID,
        scopes: opts.scopes ?? null,
        expiresAt: opts.expiresAt ?? null,
        status: ACTIVE,
      },
    });
    return existing.id;
  }

  const created = await prisma.connectedAccount.create({
    data: {
      orgId,
      agentId,
      provider,
      encBlob,
      keyId: KEY_ID,
      scopes: opts.scopes ?? null,
      expiresAt: opts.expiresAt ?? null,
      status: ACTIVE,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Return the decrypted plaintext for the active (orgId, provider, agentId) credential,
 * or null if there is none. Never returns the ciphertext.
 */
export async function getSecret(
  orgId: string,
  provider: string,
  agentId?: string,
): Promise<string | null> {
  const row = await prisma.connectedAccount.findFirst({
    where: { orgId, provider, agentId: agentFilter(agentId), status: ACTIVE },
    select: { encBlob: true },
  });
  if (!row || !row.encBlob) return null;
  return decryptSecret(row.encBlob);
}

/**
 * List an org's credentials, masked. The secret and its ciphertext are deliberately
 * not selected, so they can never leak through this path (UI, admin, logs).
 */
export async function listAccounts(orgId: string): Promise<MaskedAccount[]> {
  return prisma.connectedAccount.findMany({
    where: { orgId },
    select: { id: true, provider: true, agentId: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

/** Revoke (delete) a stored credential, org-scoped. Returns false if it doesn't belong to the org. */
export async function revokeAccount(orgId: string, id: string): Promise<boolean> {
  const row = await prisma.connectedAccount.findFirst({ where: { id, orgId } });
  if (!row) return false;
  await prisma.connectedAccount.delete({ where: { id: row.id } });
  return true;
}
