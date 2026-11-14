// FND-10 / FND-42 / QA-07 — WS subscription authorization.
// Proves the fix for the account-takeover + cross-tenant leak: a socket may only
// subscribe to an agent whose org the token's user owns.
import { describe, it, expect } from 'vitest';
import { userOwnsAgent } from '../src/lib/realtime';
import { createOrg, createUser, createAgent } from './helpers/factories';

describe('WS subscription authorization', () => {
  it('permits own-org agents only; rejects cross-tenant, bad, and empty tokens', async () => {
    const orgA = await createOrg('A');
    const userA = await createUser(orgA.id);
    const agentA = await createAgent(orgA.id);

    const orgB = await createOrg('B');
    const agentB = await createAgent(orgB.id); // another tenant's agent

    expect(await userOwnsAgent(userA.token, agentA.id)).toBe(true);
    expect(await userOwnsAgent(userA.token, agentB.id)).toBe(false); // cross-tenant → no QR/message leak
    expect(await userOwnsAgent('forged-token', agentA.id)).toBe(false);
    expect(await userOwnsAgent('', agentA.id)).toBe(false);
    expect(await userOwnsAgent(userA.token, 'nonexistent-agent')).toBe(false);
  });
});
