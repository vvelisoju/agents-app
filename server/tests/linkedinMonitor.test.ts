// LKD-2 (Wave 2) — watch CRUD + the monitor tick that drafts a reaction on a new post.
// Offline: the browser reader and the model drafter are stubbed; no Chrome, no model call.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import prisma from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { createOrg, createUser, createAgent } from './helpers/factories';
import { createWatch, listWatches, monitorTickOnce, type MonitorDeps } from '../src/modules/linkedin/monitorService';
import { SessionError, type LatestPost } from '../src/lib/linkedin/driver';
import { getSessionStatus, saveSession } from '../src/lib/linkedin/session';
import { STATUS } from '../src/modules/linkedin/service';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });
const BOSS = 'https://www.linkedin.com/in/the-boss/';
const LI_AT = 'AQEDAReallyLongLookingSessionCookieValue1234567890';

// A stub reader whose "latest post" we control, and a stub drafter that echoes a canned reaction.
function stubDeps(latest: LatestPost | null, draftCalls: any[] = []): MonitorDeps {
  return {
    reader: { async fetchLatestPost() { return latest; } },
    draft: async (agentId, postText, reaction) => { draftCalls.push({ agentId, postText, reaction }); return { comment: 'Congrats on this!', reshareCaption: 'Worth a read:' }; },
  };
}

beforeEach(async () => {
  await prisma.linkedInAction.deleteMany({});
  await prisma.linkedInWatch.deleteMany({});
  await prisma.connectedAccount.deleteMany({});
  process.env.LINKEDIN_ENABLED = '1';
});
afterEach(() => { delete process.env.LINKEDIN_ENABLED; });

describe('LinkedIn watch service (LKD-2)', () => {
  let orgId: string; let agentId: string;
  beforeEach(async () => { orgId = (await createOrg()).id; agentId = (await createAgent(orgId)).id; });

  it('creates a watch (defaults reaction=comment, active)', async () => {
    const w = await createWatch(orgId, agentId, { profileUrl: BOSS, label: 'My boss' });
    expect(w.reaction).toBe('comment');
    expect(w.active).toBe(true);
    expect(w.lastPostId).toBeNull();
    expect(await listWatches(orgId, agentId)).toHaveLength(1);
  });

  it('rejects a non-linkedin profile url', async () => {
    await expect(createWatch(orgId, agentId, { profileUrl: 'https://twitter.com/x' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('LinkedIn monitor tick (LKD-2)', () => {
  let orgId: string; let agentId: string;
  beforeEach(async () => { orgId = (await createOrg()).id; agentId = (await createAgent(orgId)).id; });

  it('is a no-op when disabled', async () => {
    delete process.env.LINKEDIN_ENABLED;
    await createWatch(orgId, agentId, { profileUrl: BOSS });
    expect(await monitorTickOnce(stubDeps(null))).toEqual({ ran: false, reason: 'disabled' });
  });

  it('idle when there are no active watches', async () => {
    expect((await monitorTickOnce(stubDeps(null))).reason).toBe('idle');
  });

  it('first sighting only records a baseline — no draft, no action', async () => {
    const w = await createWatch(orgId, agentId, { profileUrl: BOSS });
    const draftCalls: any[] = [];
    const out = await monitorTickOnce(stubDeps({ postId: 'urn:li:activity:1', postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1/', text: 'hello' }, draftCalls));
    expect(out).toMatchObject({ ran: true, baseline: true, watchId: w.id });
    expect(draftCalls).toHaveLength(0);
    expect(await prisma.linkedInAction.count()).toBe(0);
    const reread = await prisma.linkedInWatch.findUnique({ where: { id: w.id } });
    expect(reread!.lastPostId).toBe('urn:li:activity:1');
  });

  it('a NEW post drafts a pending comment action', async () => {
    const w = await createWatch(orgId, agentId, { profileUrl: BOSS, reaction: 'comment' });
    await prisma.linkedInWatch.update({ where: { id: w.id }, data: { lastPostId: 'urn:li:activity:OLD' } });
    const post: LatestPost = { postId: 'urn:li:activity:NEW', postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:NEW/', text: 'We are hiring!' };
    const out = await monitorTickOnce(stubDeps(post));
    expect(out).toMatchObject({ ran: true, newPost: true });
    expect(out.created).toHaveLength(1);
    const action = await prisma.linkedInAction.findFirst();
    expect(action!.kind).toBe('comment');
    expect(action!.status).toBe(STATUS.pending); // waits for approval — nothing auto-published
    expect(JSON.parse(action!.payloadJson)).toEqual({ postUrl: post.postUrl, text: 'Congrats on this!' });
  });

  it('reaction=both drafts a comment AND a reshare', async () => {
    const w = await createWatch(orgId, agentId, { profileUrl: BOSS, reaction: 'both' });
    await prisma.linkedInWatch.update({ where: { id: w.id }, data: { lastPostId: 'OLD' } });
    const out = await monitorTickOnce(stubDeps({ postId: 'NEW', postUrl: 'https://www.linkedin.com/feed/update/NEW/', text: 'x' }));
    expect(out.created).toHaveLength(2);
    const kinds = (await prisma.linkedInAction.findMany()).map((a) => a.kind).sort();
    expect(kinds).toEqual(['comment', 'reshare']);
  });

  it('an unchanged post drafts nothing', async () => {
    const w = await createWatch(orgId, agentId, { profileUrl: BOSS });
    await prisma.linkedInWatch.update({ where: { id: w.id }, data: { lastPostId: 'urn:li:activity:SAME' } });
    const out = await monitorTickOnce(stubDeps({ postId: 'urn:li:activity:SAME', postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:SAME/', text: 'same' }));
    expect(out).toMatchObject({ ran: true, newPost: false });
    expect(await prisma.linkedInAction.count()).toBe(0);
  });

  it('a SessionError flips the stored session and does not draft', async () => {
    await saveSession(orgId, agentId, `li_at=${LI_AT}`);
    const w = await createWatch(orgId, agentId, { profileUrl: BOSS });
    await prisma.linkedInWatch.update({ where: { id: w.id }, data: { lastPostId: 'OLD' } });
    const failing: MonitorDeps = {
      reader: { async fetchLatestPost() { throw new SessionError('needs_relink', 'cookie dead'); } },
      draft: async () => ({ comment: 'x', reshareCaption: 'y' }),
    };
    const out = await monitorTickOnce(failing);
    expect(out).toMatchObject({ ran: true });
    expect(out.created).toBeUndefined();
    expect(await getSessionStatus(orgId, agentId)).toBe('needs_relink');
    expect(await prisma.linkedInAction.count()).toBe(0);
  });
});

describe('LinkedIn watch API (LKD-2)', () => {
  let orgId: string; let ownerToken: string; let agentId: string;
  beforeEach(async () => {
    orgId = (await createOrg()).id;
    ownerToken = (await createUser(orgId, 'owner')).token;
    agentId = (await createAgent(orgId)).id;
  });

  it('owner adds, lists, updates and deletes a watch', async () => {
    const add = await request(app).post(`/api/linkedin/${agentId}/watches`).set(auth(ownerToken)).send({ profileUrl: BOSS, label: 'Boss', reaction: 'both' });
    expect(add.status).toBe(200);
    const id = add.body.watch.id;

    const list = await request(app).get(`/api/linkedin/${agentId}/watches`).set(auth(ownerToken));
    expect(list.body.watches).toHaveLength(1);

    const patch = await request(app).patch(`/api/linkedin/${agentId}/watches/${id}`).set(auth(ownerToken)).send({ active: false });
    expect(patch.body.watch.active).toBe(false);

    const del = await request(app).delete(`/api/linkedin/${agentId}/watches/${id}`).set(auth(ownerToken));
    expect(del.status).toBe(200);
    const list2 = await request(app).get(`/api/linkedin/${agentId}/watches`).set(auth(ownerToken));
    expect(list2.body.watches).toHaveLength(0);
  });

  it("cannot add a watch to another org's agent (tenancy → 404)", async () => {
    const otherToken = (await createUser((await createOrg()).id, 'owner')).token;
    const r = await request(app).post(`/api/linkedin/${agentId}/watches`).set(auth(otherToken)).send({ profileUrl: BOSS });
    expect(r.status).toBe(404);
  });
});
