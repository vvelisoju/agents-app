// LKD-1 (Wave 1) — LinkedIn actions: service, worker (mock driver), and API.
// Offline + deterministic: isolated SQLite test DB; the browser driver is never launched (a mock
// LinkedInDriver is injected into the worker).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import prisma from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { createOrg, createUser, createAgent } from './helpers/factories';
import {
  createAction, approveAction, cancelAction, listActions, normalizePayload, STATUS,
} from '../src/modules/linkedin/service';
import { tickOnce } from '../src/lib/linkedin/worker';
import { SessionError, type LinkedInDriver } from '../src/lib/linkedin/driver';
import { saveSession, getSessionStatus } from '../src/lib/linkedin/session';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

// The worker claims the oldest approved action DB-wide (one owner, one worker), so each test must
// start with no leftover actions/sessions from a prior test in this file.
beforeEach(async () => {
  await prisma.linkedInAction.deleteMany({});
  await prisma.connectedAccount.deleteMany({});
});
const LI_AT = 'AQEDAReallyLongLookingSessionCookieValue1234567890';
const POST_URL = 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000000/';

describe('LinkedIn payload validation (LKD-1)', () => {
  it('requires post text', () => expect(() => normalizePayload('post', {})).toThrow());
  it('accepts a post', () => expect(normalizePayload('post', { text: 'hi' })).toEqual({ text: 'hi' }));
  it('comment needs a valid linkedin url + text', () => {
    expect(() => normalizePayload('comment', { text: 'nice', postUrl: 'https://evil.com/x' })).toThrow();
    expect(normalizePayload('comment', { text: 'nice', postUrl: POST_URL })).toEqual({ postUrl: POST_URL, text: 'nice' });
  });
  it('reshare caption is optional', () => {
    expect(normalizePayload('reshare', { postUrl: POST_URL })).toEqual({ postUrl: POST_URL });
    expect(normalizePayload('reshare', { postUrl: POST_URL, caption: 'wow' })).toEqual({ postUrl: POST_URL, caption: 'wow' });
  });
  it('rejects an unknown kind', () => expect(() => normalizePayload('dm', {})).toThrow());
});

describe('LinkedIn action service (LKD-1)', () => {
  let orgId: string; let agentId: string;
  beforeEach(async () => {
    orgId = (await createOrg()).id;
    agentId = (await createAgent(orgId)).id;
  });

  it('creates a pending action and lists it', async () => {
    const a = await createAction(orgId, agentId, 'post', { text: 'hello world' });
    expect(a.status).toBe(STATUS.pending);
    expect(a.payload).toEqual({ text: 'hello world' });
    const list = await listActions(orgId, agentId);
    expect(list).toHaveLength(1);
  });

  it('rejects an action for an agent in another org', async () => {
    const other = (await createOrg()).id;
    await expect(createAction(other, agentId, 'post', { text: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  it('approve moves pending → approved; a second approve 409s', async () => {
    const a = await createAction(orgId, agentId, 'post', { text: 'x' });
    const approved = await approveAction(orgId, a.id);
    expect(approved.status).toBe(STATUS.approved);
    expect(approved.approvedAt).toBeTruthy();
    await expect(approveAction(orgId, a.id)).rejects.toMatchObject({ status: 409 });
  });

  it('cancel works on pending; not on an executed action', async () => {
    const a = await createAction(orgId, agentId, 'post', { text: 'x' });
    const c = await cancelAction(orgId, a.id);
    expect(c.status).toBe(STATUS.cancelled);
  });
});

describe('LinkedIn worker tick (LKD-1, mock driver)', () => {
  let orgId: string; let agentId: string;
  const calls: any[] = [];
  const okDriver: LinkedInDriver = {
    async publishPost(o, ag, text) { calls.push(['post', o, ag, text]); return { url: 'https://www.linkedin.com/feed/posted' }; },
    async commentOnPost(o, ag, url, text) { calls.push(['comment', o, ag, url, text]); return { url }; },
    async resharePost(o, ag, url, cap) { calls.push(['reshare', o, ag, url, cap]); return { url }; },
  };

  beforeEach(async () => {
    process.env.LINKEDIN_ENABLED = '1';
    calls.length = 0;
    orgId = (await createOrg()).id;
    agentId = (await createAgent(orgId)).id;
  });
  afterEach(() => { delete process.env.LINKEDIN_ENABLED; });

  it('is a no-op when the flag is off', async () => {
    delete process.env.LINKEDIN_ENABLED;
    const a = await createAction(orgId, agentId, 'post', { text: 'x' });
    await approveAction(orgId, a.id);
    expect(await tickOnce(okDriver)).toEqual({ ran: false, reason: 'disabled' });
  });

  it('is idle when nothing is approved (a pending action is not executed)', async () => {
    await createAction(orgId, agentId, 'post', { text: 'x' }); // pending, NOT approved
    expect((await tickOnce(okDriver)).reason).toBe('idle');
    expect(calls).toHaveLength(0);
  });

  it('executes an approved post and marks it done', async () => {
    const a = await createAction(orgId, agentId, 'post', { text: 'ship it' });
    await approveAction(orgId, a.id);
    const out = await tickOnce(okDriver);
    expect(out).toMatchObject({ ran: true, ok: true, actionId: a.id });
    expect(calls[0]).toEqual(['post', orgId, agentId, 'ship it']);
    const row = await prisma.linkedInAction.findUnique({ where: { id: a.id } });
    expect(row!.status).toBe(STATUS.done);
    expect(JSON.parse(row!.resultJson!)).toHaveProperty('url');
  });

  it('dispatches comment and reshare by kind', async () => {
    const c = await createAction(orgId, agentId, 'comment', { postUrl: POST_URL, text: 'great' });
    await approveAction(orgId, c.id);
    await tickOnce(okDriver);
    const r = await createAction(orgId, agentId, 'reshare', { postUrl: POST_URL, caption: 'must read' });
    await approveAction(orgId, r.id);
    await tickOnce(okDriver);
    expect(calls.map((c2) => c2[0])).toEqual(['comment', 'reshare']);
  });

  it('records failed + flips the session on a SessionError (checkpoint)', async () => {
    await saveSession(orgId, agentId, `li_at=${LI_AT}`);
    const failDriver: LinkedInDriver = {
      async publishPost() { throw new SessionError('checkpoint', 'security check'); },
      async commentOnPost() { return {}; },
      async resharePost() { return {}; },
    };
    const a = await createAction(orgId, agentId, 'post', { text: 'x' });
    await approveAction(orgId, a.id);
    const out = await tickOnce(failDriver);
    expect(out).toMatchObject({ ran: true, ok: false });
    const row = await prisma.linkedInAction.findUnique({ where: { id: a.id } });
    expect(row!.status).toBe(STATUS.failed);
    expect(row!.error).toMatch(/security check/);
    expect(await getSessionStatus(orgId, agentId)).toBe('checkpoint');
  });

  it('does not double-run: once claimed+done, a second tick is idle', async () => {
    const a = await createAction(orgId, agentId, 'post', { text: 'x' });
    await approveAction(orgId, a.id);
    await tickOnce(okDriver);
    const second = await tickOnce(okDriver);
    expect(second.reason).toBe('idle');
    expect(calls).toHaveLength(1);
  });
});

describe('LinkedIn API (LKD-1)', () => {
  let orgId: string; let ownerToken: string; let agentId: string;
  beforeEach(async () => {
    orgId = (await createOrg()).id;
    ownerToken = (await createUser(orgId, 'owner')).token;
    agentId = (await createAgent(orgId)).id;
  });

  it('connect stores a session (status active) and never echoes the cookie', async () => {
    const r = await request(app).post(`/api/linkedin/${agentId}/connect`).set(auth(ownerToken)).send({ cookie: `li_at=${LI_AT}` });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(LI_AT);
    const s = await request(app).get(`/api/linkedin/${agentId}/status`).set(auth(ownerToken));
    expect(s.body.status).toBe('active');
  });

  it('rejects an invalid cookie with 400', async () => {
    const r = await request(app).post(`/api/linkedin/${agentId}/connect`).set(auth(ownerToken)).send({ cookie: 'nonsense' });
    expect(r.status).toBe(400);
  });

  it('a member cannot connect (RBAC)', async () => {
    const memberToken = (await createUser(orgId, 'member')).token;
    const r = await request(app).post(`/api/linkedin/${agentId}/connect`).set(auth(memberToken)).send({ cookie: `li_at=${LI_AT}` });
    expect(r.status).toBe(403);
  });

  it('cross-org agent is 404', async () => {
    const otherToken = (await createUser((await createOrg()).id, 'owner')).token;
    const r = await request(app).get(`/api/linkedin/${agentId}/status`).set(auth(otherToken));
    expect(r.status).toBe(404);
  });

  it('full flow: draft → approve, over HTTP', async () => {
    const create = await request(app).post(`/api/linkedin/${agentId}/actions`).set(auth(ownerToken)).send({ kind: 'post', text: 'hello from the API' });
    expect(create.status).toBe(200);
    expect(create.body.action.status).toBe(STATUS.pending);

    const approve = await request(app).post(`/api/linkedin/${agentId}/actions/${create.body.action.id}/approve`).set(auth(ownerToken));
    expect(approve.status).toBe(200);
    expect(approve.body.action.status).toBe(STATUS.approved);

    const list = await request(app).get(`/api/linkedin/${agentId}/actions`).set(auth(ownerToken));
    expect(list.body.actions).toHaveLength(1);
  });

  it('a bad action payload is 400', async () => {
    const r = await request(app).post(`/api/linkedin/${agentId}/actions`).set(auth(ownerToken)).send({ kind: 'comment', text: 'hi', postUrl: 'https://evil.example/x' });
    expect(r.status).toBe(400);
  });
});
