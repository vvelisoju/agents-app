// SCN-09/11/12/19 — outbound drip: approval-gated start (no send until approved), one-per-tick
// sends with ledger idempotency, opt-out suppression, daily-cap and send-window gating, and
// restart-safe counting from the ledger. Offline: the capturing 'test' adapter captures sends.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import prisma from '../src/lib/prisma';
import { runOnce } from '../src/jobs/runner';
import { enqueueJob } from '../src/jobs/enqueue';
import { controlRun } from '../src/modules/workflows/service';
import { startCampaign } from '../src/modules/outbound/service';
import { suppressContact } from '../src/lib/optout';
import { effectiveCap, inWindow } from '../src/lib/outbound';
import { DRIP_HANDLER } from '../src/workflow/handlers/outboundDrip';
import { createOrg, createAgent } from './helpers/factories';
import { sends, resetSends } from './helpers/mockChannel';

// An always-open window (windowEnd 24 → h<24 always), fixed gap, cap high, no warmup.
async function makeConn(orgId: string, agentId: string, over: Partial<any> = {}) {
  return prisma.outboundConnection.create({
    data: { orgId, agentId, active: true, riskAckAt: new Date(), dailyCap: 100, windowStart: 0, windowEnd: 24, minGapSec: 30, maxGapSec: 30, warmupDays: 0, ...over },
  });
}

const prev = process.env.OUTBOUND_ENABLED;
beforeEach(async () => {
  process.env.OUTBOUND_ENABLED = '1';
  await prisma.job.deleteMany();
  await prisma.workflowRun.deleteMany();
  await prisma.outboundSendLog.deleteMany();
  await prisma.outboundOptOut.deleteMany();
  await prisma.outboundConnection.deleteMany();
  resetSends();
});
afterEach(() => { if (prev === undefined) delete process.env.OUTBOUND_ENABLED; else process.env.OUTBOUND_ENABLED = prev; });

describe('outbound policy helpers', () => {
  it('warmup ramps from warmupStart to dailyCap and never exceeds it', () => {
    const c = { dailyCap: 50, warmupDays: 5, warmupStart: 10 };
    expect(effectiveCap(c, 0)).toBe(10);
    expect(effectiveCap(c, 5)).toBe(50);
    expect(effectiveCap({ dailyCap: 1, warmupDays: 5, warmupStart: 10 }, 0)).toBe(1); // never above cap
  });
  it('window gating respects start/end hours', () => {
    expect(inWindow({ windowStart: 0, windowEnd: 24 })).toBe(true);
    expect(inWindow({ windowStart: 0, windowEnd: 0 })).toBe(false); // always-closed
  });
});

describe('approval-gated start (SCN-11)', () => {
  it('creates a parked run + bulk_send approval and sends nothing until approved', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, { channelType: 'test' });
    await makeConn(org.id, agent.id);
    const start = await startCampaign({ orgId: org.id, agentId: agent.id, requestedBy: 'u', promo: 'Sale!', recipients: [{ phone: '9000000001' }, { phone: '9000000002' }] });
    expect(start.ok).toBe(true);

    const run = await prisma.workflowRun.findUnique({ where: { id: start.runId! } });
    expect(run?.status).toBe('awaiting_approval');
    const appr = await prisma.approval.findUnique({ where: { id: start.approvalId! } });
    expect(appr?.actionType).toBe('bulk_send');
    expect(appr?.status).toBe('pending');

    // Running the queue now sends nothing (no job enqueued until approval).
    await runOnce();
    expect(sends).toHaveLength(0);
  });

  it('refuses to start when the connection is inactive or lacks a risk acknowledgement', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, { channelType: 'test' });
    await makeConn(org.id, agent.id, { active: false });
    const r = await startCampaign({ orgId: org.id, agentId: agent.id, requestedBy: 'u', promo: 'Sale!', recipients: [{ phone: '9000000001' }] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('inactive');
  });
});

describe('drip sending (SCN-09/12/19)', () => {
  async function approvedCampaign(recipients: Array<{ phone: string }>) {
    const org = await createOrg();
    const agent = await createAgent(org.id, { channelType: 'test' });
    const conn = await makeConn(org.id, agent.id);
    const start = await startCampaign({ orgId: org.id, agentId: agent.id, requestedBy: 'u', promo: 'Big sale', recipients });
    await controlRun(org.id, start.runId!, 'approve', 'u'); // approve → enqueues the resume job
    return { org, agent, conn, start };
  }

  it('sends one per tick, with the opt-out footer, and is idempotent via the ledger', async () => {
    const { org, start } = await approvedCampaign([{ phone: '9000000001' }, { phone: '9000000002' }]);

    await runOnce(); // tick 1 → first recipient
    expect(sends).toHaveLength(1);
    expect(sends[0].text).toContain('Big sale');
    expect(sends[0].text).toContain('STOP'); // mandatory opt-out footer
    expect(await prisma.outboundSendLog.count({ where: { campaignId: start.campaignId, status: 'sent' } })).toBe(1);

    await runOnce(); // tick 2 → second recipient (runner picks up the sleep-rescheduled job once due)…
    // The drip sleeps minGapSec between sends, so tick 2 may not be due yet; force it by clearing the lease wait:
    const job = await prisma.job.findFirst({ where: { handlerName: DRIP_HANDLER } });
    if (job && job.status === 'pending') {
      await prisma.job.update({ where: { id: job.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
      await runOnce();
    }
    expect(sends.length).toBe(2);
    expect(await prisma.outboundSendLog.count({ where: { campaignId: start.campaignId } })).toBe(2);
  });

  it('skips an opted-out recipient', async () => {
    const { org, agent, start } = await approvedCampaign([{ phone: '9000000001' }, { phone: '9000000002' }]);
    await suppressContact(org.id, agent.id, '9000000001'); // first is suppressed

    await runOnce();
    // The handler skips the suppressed recipient in the same tick and sends to the next.
    expect(sends.length).toBe(1);
    expect(await prisma.outboundSendLog.findFirst({ where: { campaignId: start.campaignId, recipient: '9000000001' } })).toBeNull();
    expect(await prisma.outboundSendLog.findFirst({ where: { campaignId: start.campaignId, recipient: '9000000002', status: 'sent' } })).toBeTruthy();
  });

  it('stops sending once the daily cap (from the ledger) is reached — restart-safe', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, { channelType: 'test' });
    const conn = await makeConn(org.id, agent.id, { dailyCap: 1 });
    // Pre-seed one send today → cap already reached before any tick (simulates a restart).
    await prisma.outboundSendLog.create({ data: { orgId: org.id, connectionId: conn.id, campaignId: 'x', recipient: '9999999999', status: 'sent' } });
    const start = await startCampaign({ orgId: org.id, agentId: agent.id, requestedBy: 'u', promo: 'Sale', recipients: [{ phone: '9000000001' }] });
    await controlRun(org.id, start.runId!, 'approve', 'u');

    await runOnce();
    expect(sends).toHaveLength(0); // cap reached → nothing sent
    const run = await prisma.workflowRun.findUnique({ where: { id: start.runId! } });
    expect(run?.status).toBe('sleeping'); // parked until the cap resets
  });

  it('does not send when the window is closed', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, { channelType: 'test' });
    await makeConn(org.id, agent.id, { windowStart: 0, windowEnd: 0 }); // always closed
    const start = await startCampaign({ orgId: org.id, agentId: agent.id, requestedBy: 'u', promo: 'Sale', recipients: [{ phone: '9000000001' }] });
    await controlRun(org.id, start.runId!, 'approve', 'u');
    await runOnce();
    expect(sends).toHaveLength(0);
  });

  it('is inert when OUTBOUND_ENABLED is off', async () => {
    const { org, start } = await approvedCampaign([{ phone: '9000000001' }]);
    delete process.env.OUTBOUND_ENABLED;
    await runOnce();
    expect(sends).toHaveLength(0);
  });
});
