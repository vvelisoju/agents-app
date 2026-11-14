// MK-1/2/3 — conversation rolling summary. Gated by SUMMARY_ENABLED (default off → the engine
// never calls into here). For long conversations we keep a compact running summary of turns older
// than the recent window, so the agent retains context beyond the last few messages without
// stuffing the whole history into every prompt (bounded tokens, bounded cost).
import prisma from './prisma';
import { askClaude } from './brain';

// Must match the engine's recent-history window (`take: 8`). Turns newer than this are shown
// verbatim; older ones are folded into the summary.
export const RECENT_WINDOW = 8;
// Only (re)summarize once at least this many messages accrued beyond what the summary covers —
// avoids a model call on every turn.
export const SUMMARIZE_EVERY = 10;
// Keep the stored summary compact.
const MAX_SUMMARY_CHARS = 1200;

export interface ConvSummaryFields {
  summary: string | null;
  summaryThrough: number;
}

/** The prompt block for a conversation's stored summary, or '' when there is none. */
export function summaryBlock(conv: ConvSummaryFields | null | undefined): string {
  const s = conv?.summary?.trim();
  if (!s) return '';
  return `Conversation so far (summary of earlier messages):\n${s}`;
}

/**
 * Refresh the rolling summary if enough new messages have accrued. Fire-and-forget: the caller
 * does not await it and it never throws into the reply path. A no-op unless the conversation has
 * more than RECENT_WINDOW messages and at least SUMMARIZE_EVERY new ones since the last summary.
 */
export async function maybeSummarize(conv: { id: string; summary: string | null; summaryThrough: number }): Promise<void> {
  try {
    const total = await prisma.message.count({ where: { conversationId: conv.id } });
    // Messages older than the recent window are the ones to summarize.
    const olderCount = total - RECENT_WINDOW;
    if (olderCount <= 0) return;
    if (olderCount - (conv.summaryThrough || 0) < SUMMARIZE_EVERY) return;

    // Oldest → newest, excluding the recent window the engine already shows verbatim.
    const older = await prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
      take: olderCount,
    });
    if (!older.length) return;
    const transcript = older
      .map((m) => `${m.direction === 'outbound' ? 'Business' : 'Customer'}: ${m.body}`)
      .join('\n')
      .slice(0, 12000);

    const prior = conv.summary?.trim();
    const system =
      'You maintain a running summary of a customer conversation for a small business. ' +
      'Produce a concise factual summary (<= 120 words) capturing what the customer wants, key ' +
      'details they gave (name, needs, dates, budget, decisions), and anything promised. Plain ' +
      'text, no preamble, no bullet markup.';
    const prompt = prior
      ? `Current summary:\n${prior}\n\nNewer earlier messages to fold in:\n${transcript}\n\nUpdated summary:`
      : `Earlier messages:\n${transcript}\n\nSummary:`;

    const text = (await askClaude({ system, prompt, maxTokens: 300 })).trim();
    if (!text) return;

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { summary: text.slice(0, MAX_SUMMARY_CHARS), summaryUpdatedAt: new Date(), summaryThrough: olderCount },
    });
  } catch {
    /* summary refresh is best-effort — it must never affect the reply */
  }
}
