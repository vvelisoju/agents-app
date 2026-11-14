// SEC — connected-accounts API: list (masked, no secrets) + owner-only revoke, org-scoped.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import prisma from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { saveSecret } from '../src/lib/connectedAccount';
import { createOrg, createUser } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('Connected accounts API', () => {
  let orgId: string;
  let ownerToken: string;

  beforeEach(async () => {
    orgId = (await createOrg()).id;
    ownerToken = (await createUser(orgId, 'owner')).token;
  });

  it('lists accounts without exposing the stored secret', async () => {
    await saveSecret(orgId, 'telegram', 'super-secret-bot-token');
    const r = await request(app).get('/api/connected-accounts').set(auth(ownerToken));
    expect(r.status).toBe(200);
    expect(r.body.accounts).toHaveLength(1);
    const acct = r.body.accounts[0];
    expect(acct.provider).toBe('telegram');
    // No secret/ciphertext field is ever returned.
    expect(JSON.stringify(acct)).not.toContain('super-secret-bot-token');
    expect(acct.encBlob).toBeUndefined();
  });

  it('owner can revoke; a member cannot; cross-org is 404', async () => {
    const savedId = await saveSecret(orgId, 'meta', 'x');
    const memberToken = (await createUser(orgId, 'member')).token;

    // Member is denied by the policy chokepoint.
    const denied = await request(app).delete(`/api/connected-accounts/${savedId}`).set(auth(memberToken));
    expect(denied.status).toBe(403);

    // Another org cannot revoke it (404).
    const otherOwner = await createUser((await createOrg()).id, 'owner');
    const cross = await request(app).delete(`/api/connected-accounts/${savedId}`).set(auth(otherOwner.token));
    expect(cross.status).toBe(404);

    // Owner revokes successfully.
    const ok = await request(app).delete(`/api/connected-accounts/${savedId}`).set(auth(ownerToken));
    expect(ok.status).toBe(200);
    expect(await prisma.connectedAccount.count({ where: { id: savedId } })).toBe(0);
  });
});
