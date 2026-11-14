// SEC-6 — POST /api/auth/logout rotates the caller's bearer token so the presented
// one stops working immediately. Auth-gated and idempotent.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import { createOrg, createUser } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('POST /api/auth/logout', () => {
  it('invalidates the current token after logout', async () => {
    const org = await createOrg();
    const { token } = await createUser(org.id, 'owner');

    // The token works before logout.
    expect((await request(app).get('/api/me').set(auth(token))).status).toBe(200);

    // Logout succeeds.
    const out = await request(app).post('/api/auth/logout').set(auth(token));
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);

    // The same token is now rejected.
    expect((await request(app).get('/api/me').set(auth(token))).status).toBe(401);
  });

  it('rejects logout without a valid token', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(401);
    expect((await request(app).post('/api/auth/logout').set(auth('nope'))).status).toBe(401);
  });
});
