// SCN-31 — scheduled website monitor: diff summary, Watch CRUD + SSRF validation + Trigger
// wiring, and the handler's change/no-change/baseline/fetch-fail behavior. Offline: snapshot()
// is mocked and SSRF is exercised with literal IPs (no DNS).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/lib/monitor', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, snapshot: vi.fn() };
});

import prisma from '../src/lib/prisma';
import { snapshot, diffSummary } from '../src/lib/monitor';
import { runOnce } from '../src/jobs/runner';
import { enqueueJob } from '../src/jobs/enqueue';
import { createWatch, deleteWatch, setWatchActive, listWatches } from '../src/modules/monitors/service';
import { MONITOR_HANDLER } from '../src/workflow/handlers/scheduledMonitor';
import { createOrg, createAgent } from './helpers/factories';
import { sends, resetSends } from './helpers/mockChannel';

const snap = vi.mocked(snapshot);
const PUBLIC_URL = 'http://93.184.216.34/deals'; // literal public IP → no DNS, offline

beforeEach(async () => {
  await prisma.job.deleteMany();
  await prisma.watch.deleteMany();
  await prisma.trigger.deleteMany();
  snap.mockReset();
  resetSends();
});

describe('monitor — diff summary (SCN-29)', () => {
  it('flags a price change with the old and new values', () => {
    const s = diffSummary('Hot desk ₹3,999 per month', 'Hot desk ₹4,999 per month');
    expect(s.toLowerCase()).toContain('price');
    expect(s).toContain('4,999');
  });
  it('summarizes newly added content', () => {
    const s = diffSummary('Open Mon-Sat', 'Open Mon-Sat. New weekend batch starting soon');
    expect(s.toLowerCase()).toContain('new');
  });
});

describe('monitor — Watch CRUD + SSRF (SCN-42)', () => {
  it('creates a watch and a paired cron trigger', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const w = await createWatch({ orgId: org.id, agentId: agent.id, url: PUBLIC_URL, cadence: 'daily', label: 'Deals' });
    expect(w.triggerId).toBeTruthy();
    expect(w.cronExpr).toBe('0 9 * * *');
    const t = await prisma.trigger.findUnique({ where: { id: w.triggerId! } });
    expect(t?.handlerName).toBe(MONITOR_HANDLER);
    expect(t?.kind).toBe('cron');
    expect(JSON.parse(t!.filterJson).watchId).toBe(w.id);
    expect(await listWatches(org.id, agent.id)).toHaveLength(1);
  });

  it('refuses a private/loopback URL on create (SSRF)', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    await expect(createWatch({ orgId: org.id, agentId: agent.id, url: 'http://127.0.0.1/admin' })).rejects.toThrow();
    await expect(createWatch({ orgId: org.id, agentId: agent.id, url: 'http://169.254.169.254/latest/meta-data' })).rejects.toThrow();
    expect(await listWatches(org.id, agent.id)).toHaveLength(0);
  });

  it('pause disables the trigger; delete removes the watch and its trigger', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const w = await createWatch({ orgId: org.id, agentId: agent.id, url: PUBLIC_URL });
    await setWatchActive(org.id, w.id, false);
    expect((await prisma.trigger.findUnique({ where: { id: w.triggerId! } }))?.enabled).toBe(false);
    expect(await deleteWatch(org.id, w.id)).toBe(true);
    expect(await prisma.watch.count({ where: { id: w.id } })).toBe(0);
    expect(await prisma.trigger.count({ where: { id: w.triggerId! } })).toBe(0);
  });

  it('is org-scoped — another org cannot delete the watch', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const w = await createWatch({ orgId: org.id, agentId: agent.id, url: PUBLIC_URL });
    const other = await createOrg();
    expect(await deleteWatch(other.id, w.id)).toBe(false);
  });
});

describe('monitor — handler (SCN-28)', () => {
  const prev = process.env.MONITOR_ENABLED;
  beforeEach(() => { process.env.MONITOR_ENABLED = '1'; });
  afterEach(() => { if (prev === undefined) delete process.env.MONITOR_ENABLED; else process.env.MONITOR_ENABLED = prev; });

  async function makeWatch() {
    const org = await createOrg();
    const agent = await createAgent(org.id, { channelType: 'test', alertNumber: '9000000000' });
    const w = await createWatch({ orgId: org.id, agentId: agent.id, url: PUBLIC_URL, label: 'Deals' });
    return { org, agent, w };
  }
  const tick = (orgId: string, triggerId: string) => enqueueJob({ orgId, handlerName: MONITOR_HANDLER, state: { triggerId } }).then(() => runOnce());

  it('captures a baseline on the first run and does NOT notify', async () => {
    const { org, w } = await makeWatch();
    snap.mockResolvedValueOnce({ title: 't', text: 'Price ₹3,999', hash: 'A' });
    await tick(org.id, w.triggerId!);
    expect(sends).toHaveLength(0);
    expect((await prisma.watch.findUnique({ where: { id: w.id } }))?.lastHash).toBe('A');
  });

  it('notifies exactly once on a real change, then stays quiet when unchanged', async () => {
    const { org, w } = await makeWatch();
    snap.mockResolvedValueOnce({ title: 't', text: 'Price ₹3,999', hash: 'A' });
    await tick(org.id, w.triggerId!); // baseline

    snap.mockResolvedValueOnce({ title: 't', text: 'Price ₹4,999', hash: 'B' });
    await tick(org.id, w.triggerId!); // change
    expect(sends).toHaveLength(1);
    expect(sends[0].to).toBe('9000000000');
    expect(sends[0].text).toContain('Deals');
    const changed = await prisma.watch.findUnique({ where: { id: w.id } });
    expect(changed?.lastHash).toBe('B');
    expect(changed?.lastChangedAt).toBeTruthy();

    resetSends();
    snap.mockResolvedValueOnce({ title: 't', text: 'Price ₹4,999', hash: 'B' });
    await tick(org.id, w.triggerId!); // no change
    expect(sends).toHaveLength(0);
  });

  it('retries (no notify) when the fetch fails', async () => {
    const { org, w } = await makeWatch();
    snap.mockRejectedValueOnce(new Error('network blocked'));
    await tick(org.id, w.triggerId!);
    expect(sends).toHaveLength(0);
    const job = await prisma.job.findFirst({ where: { orgId: org.id, handlerName: MONITOR_HANDLER } });
    expect(job?.status).toBe('pending');
    expect(job?.attempts).toBe(1);
  });

  it('is a no-op when MONITOR_ENABLED is off', async () => {
    delete process.env.MONITOR_ENABLED;
    const { org, w } = await makeWatch();
    await tick(org.id, w.triggerId!);
    expect(snap).not.toHaveBeenCalled();
    expect(sends).toHaveLength(0);
  });
});
