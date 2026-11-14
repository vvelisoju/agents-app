// TOOL-11 / SCN-21/22 — calendar.book. sideEffect='external' so it routes through
// approve-before-book: the agentic loop only ever creates an Approval; the booking is written
// when the owner approves (approvalRunner → preApproved execute). The double-book guard rejects
// an overlapping confirmed slot for the same agent, and externalRef gives idempotency so the
// same slot can't be booked twice. v1 backing is the internal Booking table (no external OAuth).
import { z } from 'zod';
import { createHash } from 'node:crypto';
import prisma from '../../lib/prisma';
import { registerTool } from '../registry';
import type { Tool } from '../types';

function slotKey(agentId: string, contact: string, startAt: string): string {
  return createHash('sha256').update(`${agentId}:${contact}:${startAt}`).digest('hex').slice(0, 24);
}

export const calendarBook: Tool = {
  name: 'calendar.book',
  description: 'Book an appointment slot for a customer (date/time in ISO-8601). Needs owner approval before it is confirmed.',
  inputSchema: z.object({
    contactNumber: z.string().min(3),
    contactName: z.string().optional(),
    startAt: z.string(), // ISO-8601
    endAt: z.string(),
    note: z.string().optional(),
  }),
  outputSchema: z.object({ bookingId: z.string(), startAt: z.string(), status: z.string() }),
  sideEffect: 'external',
  approvalAction: 'booking',
  idempotent: true,
  async execute(input, ctx) {
    const start = new Date(input.startAt);
    const end = new Date(input.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new Error('invalid start/end time');
    }
    const agentId = ctx.agent.id;
    const externalRef = slotKey(agentId, input.contactNumber, start.toISOString());

    // Idempotency: the same (agent, contact, slot) returns the existing booking.
    const existing = await prisma.booking.findUnique({ where: { externalRef } });
    if (existing) return { bookingId: existing.id, startAt: existing.startAt.toISOString(), status: existing.status };

    // Double-book guard (SCN-22): reject an overlapping confirmed slot for this agent.
    const overlap = await prisma.booking.findFirst({
      where: { agentId, status: 'confirmed', startAt: { lt: end }, endAt: { gt: start } },
    });
    if (overlap) throw new Error('that time overlaps an existing booking');

    const booking = await prisma.booking.create({
      data: {
        orgId: ctx.orgId, agentId, conversationId: ctx.conversationId ?? null,
        contactNumber: input.contactNumber, contactName: input.contactName ?? null,
        startAt: start, endAt: end, status: 'confirmed', note: input.note ?? null, externalRef,
      },
    });
    return { bookingId: booking.id, startAt: booking.startAt.toISOString(), status: booking.status };
  },
};

registerTool(calendarBook);
