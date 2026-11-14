// SEC-3 — encrypted connected-account credential store.
// Offline + deterministic: uses the isolated SQLite test DB from tests/setup.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '../src/lib/prisma';
import { saveSecret, getSecret, listAccounts } from '../src/lib/connectedAccount';

const ORG = 'org_test_ca';
const PLAINTEXT = 'ghp_SECRET-oauth-token_do-not-leak_12345';

describe('connected-account credential store (SEC-3)', () => {
  beforeEach(async () => {
    await prisma.connectedAccount.deleteMany({ where: { orgId: ORG } });
  });

  it('stores ciphertext (never plaintext) and round-trips via getSecret', async () => {
    const id = await saveSecret(ORG, 'github', PLAINTEXT);
    expect(id).toBeTruthy();

    // The persisted blob must be encrypted, not the raw secret.
    const row = await prisma.connectedAccount.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.encBlob).not.toContain(PLAINTEXT);
    expect(row!.encBlob.startsWith('k1:')).toBe(true);
    expect(row!.keyId).toBe('k1');

    // Decryption returns the original secret.
    expect(await getSecret(ORG, 'github')).toBe(PLAINTEXT);
  });

  it('getSecret returns null when nothing is stored', async () => {
    expect(await getSecret(ORG, 'nope')).toBeNull();
  });

  it('replaces the active credential for the same (org, provider, agent) tuple', async () => {
    await saveSecret(ORG, 'github', 'first-token');
    await saveSecret(ORG, 'github', 'second-token', { scopes: 'repo' });

    const rows = await prisma.connectedAccount.findMany({
      where: { orgId: ORG, provider: 'github' },
    });
    expect(rows).toHaveLength(1); // replaced, not duplicated
    expect(await getSecret(ORG, 'github')).toBe('second-token');
  });

  it('keeps org-level and agent-scoped credentials distinct', async () => {
    await saveSecret(ORG, 'slack', 'org-level');
    await saveSecret(ORG, 'slack', 'agent-level', { agentId: 'agent_1' });

    expect(await getSecret(ORG, 'slack')).toBe('org-level');
    expect(await getSecret(ORG, 'slack', 'agent_1')).toBe('agent-level');
  });

  it('listAccounts never exposes the secret or its ciphertext', async () => {
    await saveSecret(ORG, 'github', PLAINTEXT);
    const list = await listAccounts(ORG);

    expect(list).toHaveLength(1);
    const masked = list[0];
    expect(masked.provider).toBe('github');
    expect(masked.status).toBe('active');
    expect(masked).not.toHaveProperty('encBlob');
    // Defensive: no field in the masked record carries the secret.
    expect(JSON.stringify(masked)).not.toContain(PLAINTEXT);
  });
});
