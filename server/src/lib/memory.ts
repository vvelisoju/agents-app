// MK-9 — per-contact memory. The model signals a durable fact to remember by emitting a
// [[REMEMBER:key=value]] token in its reply (parsed + stripped exactly like [[ALERT]], so it
// never reaches the customer). recallMemory() returns a contact's stored facts to inject into the
// next prompt. Everything is gated by MEMORY_ENABLED at the call sites (engine), so when the
// feature is off nothing here runs and replies are unchanged.
import prisma from './prisma';

const REMEMBER_RE = /\[\[REMEMBER:\s*([^=\]]+?)\s*=\s*([^\]]*?)\s*\]\]/gi;
const MAX_FACTS_PER_CONTACT = 20;
const DEFAULT_TTL_DAYS = Number(process.env.MEMORY_TTL_DAYS) || 180;

export interface ParsedMemory { key: string; value: string }

/** Pull [[REMEMBER:k=v]] tokens out of a reply, returning the facts and the cleaned text. */
export function extractMemory(text: string): { memories: ParsedMemory[]; clean: string } {
  const memories: ParsedMemory[] = [];
  const clean = (text || '').replace(REMEMBER_RE, (_m, k: string, v: string) => {
    const key = k.trim().slice(0, 60);
    const value = v.trim().slice(0, 400);
    if (key && value) memories.push({ key, value });
    return '';
  }).replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { memories, clean };
}

export async function rememberFacts(orgId: string, agentId: string, contactNumber: string, memories: ParsedMemory[]): Promise<void> {
  const expiresAt = DEFAULT_TTL_DAYS > 0 ? new Date(Date.now() + DEFAULT_TTL_DAYS * 86_400_000) : null;
  for (const m of memories) {
    await prisma.contactMemory.upsert({
      where: { agentId_contactNumber_key: { agentId, contactNumber, key: m.key } },
      update: { value: m.value, expiresAt },
      create: { orgId, agentId, contactNumber, key: m.key, value: m.value, expiresAt },
    }).catch(() => { /* memory writes are best-effort — never break a reply */ });
  }
}

/** A contact's non-expired memory, newest first, capped. */
export async function recallMemory(agentId: string, contactNumber: string): Promise<ParsedMemory[]> {
  const now = new Date();
  const rows = await prisma.contactMemory.findMany({
    where: { agentId, contactNumber, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { updatedAt: 'desc' },
    take: MAX_FACTS_PER_CONTACT,
  });
  return rows.map((r) => ({ key: r.key, value: r.value }));
}

export interface StoredMemory { id: string; key: string; value: string; updatedAt: Date; expiresAt: Date | null }

/** MK-13 — a contact's stored memory for the owner UI (includes ids + timestamps so the owner can
 *  see and correct what the agent remembers). Non-expired, newest first. */
export async function listContactMemory(agentId: string, contactNumber: string): Promise<StoredMemory[]> {
  const now = new Date();
  const rows = await prisma.contactMemory.findMany({
    where: { agentId, contactNumber, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { updatedAt: 'desc' },
    take: MAX_FACTS_PER_CONTACT,
  });
  return rows.map((r) => ({ id: r.id, key: r.key, value: r.value, updatedAt: r.updatedAt, expiresAt: r.expiresAt }));
}

/** MK-13 — forget one stored memory (owner correction). Scoped to the agent; returns whether a
 *  row was removed. */
export async function forgetMemory(agentId: string, memoryId: string): Promise<boolean> {
  const r = await prisma.contactMemory.deleteMany({ where: { id: memoryId, agentId } });
  return r.count > 0;
}

/** Render recalled memory as a compact prompt block (empty string when there is none). */
export function memoryBlock(memories: ParsedMemory[]): string {
  if (!memories.length) return '';
  const lines = memories.map((m) => `- ${m.key}: ${m.value}`).join('\n');
  return `What you already know about this customer (from past chats):\n${lines}`;
}

// The instruction that turns the feature on for the model. Without it the model never emits
// [[REMEMBER:…]], so recall stays empty — this is what makes MEMORY_ENABLED actually do something.
export const MEMORY_INSTRUCTION =
  'If you learn a durable fact about this customer — their name, what they want, a preference, ' +
  'a decision they made — record it with [[REMEMBER:key=value]] in your reply (e.g. [[REMEMBER:name=Priya]]). ' +
  'It is saved privately, recalled in future chats, and removed before the customer sees it. ' +
  'Only remember stable facts, not small talk.';
