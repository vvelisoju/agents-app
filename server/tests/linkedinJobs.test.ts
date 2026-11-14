// LKD-3 (Wave 3) — LinkedIn job searches (read-only): service, worker tick (mock searcher), API.
// Offline: the browser searcher is stubbed; no Chrome.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import prisma from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { createOrg, createUser, createAgent } from './helpers/factories';
import { createJobSearch, listJobSearches, jobTickOnce, JOB_STATUS } from '../src/modules/linkedin/jobService';
import { SessionError, type JobResult, type LinkedInJobSearcher } from '../src/lib/linkedin/driver';
import { getSessionStatus, saveSession } from '../src/lib/linkedin/session';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });
const LI_AT = 'AQEDAReallyLongLookingSessionCookieValue1234567890';

const JOBS: JobResult[] = [
  { title: 'Senior Node Engineer', company: 'Acme', location: 'Remote', url: 'https://www.linkedin.com/jobs/view/1' },
  { title: 'Backend Lead', company: 'Globex', location: 'Hyderabad', url: 'https://www.linkedin.com/jobs/view/2' },
];
const okSearcher: LinkedInJobSearcher = { async searchJobs() { return JOBS; } };

beforeEach(async () => {
  await prisma.linkedInJobSearch.deleteMany({});
  await prisma.connectedAccount.deleteMany({});
  process.env.LINKEDIN_ENABLED = '1';
});
afterEach(() => { delete process.env.LINKEDIN_ENABLED; });

describe('LinkedIn job-search service (LKD-3)', () => {
  let orgId: string; let agentId: string;
  beforeEach(async () => { orgId = (await createOrg()).id; agentId = (await createAgent(orgId)).id; });

  it('creates a pending search', async () => {
    const s = await createJobSearch(orgId, agentId, { query: 'node engineer', location: 'Remote' });
    expect(s.status).toBe(JOB_STATUS.pending);
    expect(s.query).toBe('node engineer');
    expect(await listJobSearches(orgId, agentId)).toHaveLength(1);
  });

  it('requires a query', async () => {
    await expect(createJobSearch(orgId, agentId, { query: '  ' })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects another org's agent", async () => {
    const other = (await createOrg()).id;
    await expect(createJobSearch(other, agentId, { query: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('LinkedIn job-search worker tick (LKD-3)', () => {
  let orgId: string; let agentId: string;
  beforeEach(async () => { orgId = (await createOrg()).id; agentId = (await createAgent(orgId)).id; });

  it('is a no-op when disabled', async () => {
    delete process.env.LINKEDIN_ENABLED;
    await createJobSearch(orgId, agentId, { query: 'x' });
    expect(await jobTickOnce(okSearcher)).toEqual({ ran: false, reason: 'disabled' });
  });

  it('idle when nothing pending', async () => {
    expect((await jobTickOnce(okSearcher)).reason).toBe('idle');
  });

  it('runs a pending search and stores the digest', async () => {
    const s = await createJobSearch(orgId, agentId, { query: 'node' });
    const out = await jobTickOnce(okSearcher);
    expect(out).toMatchObject({ ran: true, ok: true, searchId: s.id, count: 2 });
    const row = await prisma.linkedInJobSearch.findUnique({ where: { id: s.id } });
    expect(row!.status).toBe(JOB_STATUS.done);
    expect(JSON.parse(row!.resultJson!).jobs).toHaveLength(2);
    expect(row!.executedAt).toBeTruthy();
  });

  it('does not re-run a completed search (idle on second tick)', async () => {
    await createJobSearch(orgId, agentId, { query: 'node' });
    await jobTickOnce(okSearcher);
    expect((await jobTickOnce(okSearcher)).reason).toBe('idle');
  });

  it('records failed + flips the session on a SessionError', async () => {
    await saveSession(orgId, agentId, `li_at=${LI_AT}`);
    const failing: LinkedInJobSearcher = { async searchJobs() { throw new SessionError('needs_relink', 'cookie dead'); } };
    const s = await createJobSearch(orgId, agentId, { query: 'node' });
    const out = await jobTickOnce(failing);
    expect(out).toMatchObject({ ran: true, ok: false });
    const row = await prisma.linkedInJobSearch.findUnique({ where: { id: s.id } });
    expect(row!.status).toBe(JOB_STATUS.failed);
    expect(await getSessionStatus(orgId, agentId)).toBe('needs_relink');
  });
});

describe('LinkedIn job-search API (LKD-3)', () => {
  let orgId: string; let ownerToken: string; let agentId: string;
  beforeEach(async () => {
    orgId = (await createOrg()).id;
    ownerToken = (await createUser(orgId, 'owner')).token;
    agentId = (await createAgent(orgId)).id;
  });

  it('create → list → get flow, and the worker fills the digest', async () => {
    const create = await request(app).post(`/api/linkedin/${agentId}/jobs`).set(auth(ownerToken)).send({ query: 'node engineer', location: 'Remote' });
    expect(create.status).toBe(200);
    expect(create.body.search.status).toBe(JOB_STATUS.pending);
    const id = create.body.search.id;

    await jobTickOnce(okSearcher); // worker runs it

    const get = await request(app).get(`/api/linkedin/${agentId}/jobs/${id}`).set(auth(ownerToken));
    expect(get.body.search.status).toBe(JOB_STATUS.done);
    expect(get.body.search.result.jobs).toHaveLength(2);
  });

  it('cross-org get is 404', async () => {
    const s = await createJobSearch(orgId, agentId, { query: 'x' });
    const otherToken = (await createUser((await createOrg()).id, 'owner')).token;
    const r = await request(app).get(`/api/linkedin/${agentId}/jobs/${s.id}`).set(auth(otherToken));
    expect(r.status).toBe(404);
  });
});
