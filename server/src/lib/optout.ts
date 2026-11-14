// SCN-10 — STOP/unsubscribe opt-out. Conservative matcher (only short, essentially-just-the-word
// messages trigger it, so a normal sentence that merely contains "stop" is never suppressed),
// plus the suppression store the drip checks before every send.
import prisma from './prisma';

// Whole-message stop phrases (normalized). English + common Hindi/Hinglish/Telugu.
const STOP_PHRASES = new Set([
  'stop', 'stop all', 'stopall', 'unsubscribe', 'unsub', 'optout', 'opt out', 'opt-out',
  'cancel', 'remove me', 'remove', 'quit', 'end', 'no more',
  'band karo', 'band kar do', 'bandh karo', 'band kardo', 'mat bhejo', 'mujhe mat bhejo',
  'message mat bhejo', 'roko', 'ruk jao', 'band', // Hindi/Hinglish
  'आपु', 'ఆపు', 'ఆపండి', 'వద్దు', // Telugu: stop / don't
  'रोको', 'बंद करो', 'मुझे मत भेजो', 'बंद', // Hindi (Devanagari)
]);

function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .trim()
    .replace(/[.!,;:'"()\[\]]/g, '')
    .replace(/\s+/g, ' ');
}

/** True when the inbound message is an opt-out request (short + essentially just the keyword). */
export function isOptOutMessage(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  if (STOP_PHRASES.has(n)) return true;
  // Also accept a leading stop/unsubscribe on a short message ("stop please", "unsubscribe me").
  if (n.length <= 24 && /^(stop|unsubscribe|unsub|optout|opt out)\b/.test(n)) return true;
  return false;
}

export async function suppressContact(orgId: string, agentId: string, phone: string): Promise<void> {
  await prisma.outboundOptOut
    .upsert({
      where: { agentId_phone: { agentId, phone } },
      update: {},
      create: { orgId, agentId, phone },
    })
    .catch(() => {});
}

export async function isSuppressed(agentId: string, phone: string): Promise<boolean> {
  const row = await prisma.outboundOptOut.findUnique({ where: { agentId_phone: { agentId, phone } } });
  return !!row;
}

// The one-line confirmation sent back when someone opts out. Kept short and neutral.
export const OPT_OUT_CONFIRMATION = "You've been unsubscribed and won't receive further messages. Reply anytime if you need help.";
