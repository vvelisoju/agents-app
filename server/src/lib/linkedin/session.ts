// LKD-1 (Wave 0) — LinkedIn session store.
//
// Login method (owner decision, 2026-11-14): the owner logs into LinkedIn in their NORMAL
// browser and pastes their session cookie; we normalise + validate it and persist it ENCRYPTED
// via the ConnectedAccount store (provider 'linkedin'). No password is ever stored, and 2FA is
// already satisfied because the cookie was minted from the owner's real, logged-in session.
//
// The browser worker (Wave 1, runs on the owner's own machine) injects this cookie into Puppeteer
// to act as the owner. When the cookie expires or LinkedIn invalidates it, status flips to
// 'needs_relink' and the owner is asked to re-paste. See docs/LINKEDIN_AGENT_PLAN.md §4.
import prisma from '../prisma';
import { saveSecret, getSecret } from '../connectedAccount';

export const LINKEDIN_PROVIDER = 'linkedin';

export interface LinkedInSession {
  li_at: string;        // the session auth cookie — all that's strictly required to act
  jsessionid?: string;  // needed for some write endpoints (CSRF); kept when provided
}

export type ParseResult = { ok: true; bundle: LinkedInSession } | { ok: false; error: string };

function stripQuotes(v: string): string {
  return v.trim().replace(/^"(.*)"$/, '$1');
}

/**
 * Accept the three things owners actually paste, and normalise to a canonical bundle:
 *   1) the bare `li_at` value,
 *   2) a Cookie-header string: `li_at=AQ...; JSESSIONID="ajax:123"`,
 *   3) a JSON cookie export: `[{name,value},…]` (EditThisCookie-style) or `{li_at,jsessionid}`.
 * Only `li_at` is required; `JSESSIONID` is captured when present.
 */
export function parseCookieInput(raw: string): ParseResult {
  const text = (raw || '').trim();
  if (!text) return { ok: false, error: 'paste your LinkedIn session cookie' };

  let li = '';
  let js = '';

  if (text.startsWith('[') || text.startsWith('{')) {
    let json: unknown;
    try { json = JSON.parse(text); } catch { return { ok: false, error: 'that looks like JSON but could not be parsed' }; }
    const entries: Array<{ name?: string; value?: unknown }> = Array.isArray(json)
      ? (json as Array<{ name?: string; value?: unknown }>)
      : Object.entries(json as Record<string, unknown>).map(([name, value]) => ({ name, value }));
    for (const e of entries) {
      const n = String(e?.name || '').toLowerCase();
      if (n === 'li_at') li = stripQuotes(String(e?.value ?? ''));
      else if (n === 'jsessionid') js = stripQuotes(String(e?.value ?? ''));
    }
  } else if (text.includes('=')) {
    // Cookie-header form: split on ';' into k=v pairs.
    for (const part of text.split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      const k = part.slice(0, i).trim().toLowerCase();
      const v = stripQuotes(part.slice(i + 1));
      if (k === 'li_at') li = v;
      else if (k === 'jsessionid') js = v;
    }
  } else {
    // A bare token with no '=' → assume it is the li_at value itself.
    li = stripQuotes(text);
  }

  if (!li) return { ok: false, error: 'could not find an li_at value in what you pasted' };
  if (li.length < 20) return { ok: false, error: 'the li_at value looks too short to be a valid session cookie' };

  const bundle: LinkedInSession = { li_at: li };
  if (js) bundle.jsessionid = js;
  return { ok: true, bundle };
}

/**
 * Validate + persist a pasted cookie as the single active LinkedIn session for (orgId, agentId).
 * Any prior LinkedIn rows for the tuple are cleared first so exactly one row exists (a re-link
 * after 'needs_relink' never leaves a stale duplicate).
 */
export async function saveSession(
  orgId: string,
  agentId: string,
  rawCookie: string,
  expiresAt?: Date,
): Promise<ParseResult> {
  const parsed = parseCookieInput(rawCookie);
  if (!parsed.ok) return parsed;
  await prisma.connectedAccount.deleteMany({ where: { orgId, provider: LINKEDIN_PROVIDER, agentId } });
  await saveSecret(orgId, LINKEDIN_PROVIDER, JSON.stringify(parsed.bundle), { agentId, expiresAt });
  return parsed;
}

/** The decrypted, parsed session for an agent, or null if none is active. */
export async function getSession(orgId: string, agentId: string): Promise<LinkedInSession | null> {
  const raw = await getSecret(orgId, LINKEDIN_PROVIDER, agentId);
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as LinkedInSession;
    return b && b.li_at ? b : null;
  } catch {
    return null;
  }
}

export type SessionStatus = 'active' | 'needs_relink' | 'checkpoint' | 'none';

/** Current link status for the agent's LinkedIn session ('none' = never connected). */
export async function getSessionStatus(orgId: string, agentId: string): Promise<SessionStatus> {
  const row = await prisma.connectedAccount.findFirst({
    where: { orgId, provider: LINKEDIN_PROVIDER, agentId },
    select: { status: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return 'none';
  return (row.status as SessionStatus) || 'active';
}

/**
 * Flag the session for re-link or a security checkpoint. Note: getSecret only returns the
 * *active* credential, so a non-active status also makes getSession() return null — the worker
 * stops using a cookie the moment it is marked stale.
 */
export async function setSessionStatus(
  orgId: string,
  agentId: string,
  status: Exclude<SessionStatus, 'none'>,
): Promise<void> {
  await prisma.connectedAccount.updateMany({
    where: { orgId, provider: LINKEDIN_PROVIDER, agentId },
    data: { status },
  });
}

/** Remove the stored session entirely (disconnect). */
export async function clearSession(orgId: string, agentId: string): Promise<void> {
  await prisma.connectedAccount.deleteMany({ where: { orgId, provider: LINKEDIN_PROVIDER, agentId } });
}
