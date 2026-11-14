// SCN-25 / TOOL-11 — calendar.book: approve-before-book (nothing booked until approved), the
// approval executor confirms it, the double-book guard rejects overlaps, and the slot is
// idempotent. Importing tools/builtin wires the approval runner + registers calendar.book.
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/tools/builtin'; // self-register tools + the approval runner
import prisma from '../src/lib/prisma';
import { calendarBook } from '../src/tools/builtin/calendar';
import { executeTool } from '../src/tools/execute';
import { decideApproval } from '../src/policy/approvals';
import { createOrg, createAgent } from './helpers/factories';

const ctxFor = (agent: any, orgId: string) => ({ agent, orgId, executionId: 'e-' + Math.random().toString(36).slice(2) });
const slot = (h: number) => ({ startAt: `2026-12-01T${String(h).padStart(2, '0')}:00:00.000Z`, endAt: `2026-12-01T${String(h + 1).padStart(2, '0')}:00:00.000Z` });

beforeEach(async () => {
  await prisma.booking.deleteMany();
  await prisma.approval.deleteMany();
});

describe('calendar.book (SCN-25)', () => {
  it('requires approval — nothing is booked on the first call', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const r = await executeTool(calendarBook, { contactNumber: '9000000001', ...slot(10) }, ctxFor(agent, org.id));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('pending_approval');
    expect(await prisma.booking.count({ where: { agentId: agent.id } })).toBe(0);
  });

  it('confirms the booking when the owner approves', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const gated = await executeTool(calendarBook, { contactNumber: '9000000001', ...slot(10) }, ctxFor(agent, org.id));
    const res = await decideApproval(org.id, gated.approvalId!, 'approved', 'owner-user');
    expect(res.ok).toBe(true);
    const bookings = await prisma.booking.findMany({ where: { agentId: agent.id } });
    expect(bookings).toHaveLength(1);
    expect(bookings[0].status).toBe('confirmed');
  });

  it('rejects a double-book (overlapping confirmed slot)', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    // First booking confirmed directly (preApproved).
    await executeTool(calendarBook, { contactNumber: '9000000001', ...slot(10) }, ctxFor(agent, org.id), { preApproved: true });
    // Overlapping slot for a different contact → guard throws → error contract.
    const r = await executeTool(calendarBook, { contactNumber: '9000000002', startAt: '2026-12-01T10:30:00.000Z', endAt: '2026-12-01T11:30:00.000Z' }, ctxFor(agent, org.id), { preApproved: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('overlap');
    expect(await prisma.booking.count({ where: { agentId: agent.id } })).toBe(1);
  });

  it('is idempotent for the same (agent, contact, slot)', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const a = await executeTool(calendarBook, { contactNumber: '9000000001', ...slot(14) }, ctxFor(agent, org.id), { preApproved: true });
    const b = await executeTool(calendarBook, { contactNumber: '9000000001', ...slot(14) }, ctxFor(agent, org.id), { preApproved: true });
    expect(a.ok && b.ok).toBe(true);
    expect((a.output as any).bookingId).toBe((b.output as any).bookingId);
    expect(await prisma.booking.count({ where: { agentId: agent.id } })).toBe(1);
  });

  it('a rejected approval never books', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const gated = await executeTool(calendarBook, { contactNumber: '9000000001', ...slot(16) }, ctxFor(agent, org.id));
    await decideApproval(org.id, gated.approvalId!, 'rejected', 'owner-user');
    expect(await prisma.booking.count({ where: { agentId: agent.id } })).toBe(0);
  });
});
