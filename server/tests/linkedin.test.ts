// LKD-1 (Wave 0) — LinkedIn session store + catalog adapter.
// Offline + deterministic: uses the isolated SQLite test DB from tests/setup.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '../src/lib/prisma';
import {
  parseCookieInput,
  saveSession,
  getSession,
  getSessionStatus,
  setSessionStatus,
  clearSession,
  LINKEDIN_PROVIDER,
} from '../src/lib/linkedin/session';
import '../src/channels/linkedin'; // register the adapter
import { getAdapter } from '../src/channels/registry';

const ORG = 'org_test_li';
const AGENT = 'agent_li_1';
const LI_AT = 'AQEDAReallyLongLookingSessionCookieValue1234567890';

describe('LinkedIn cookie parsing (LKD-1)', () => {
  it('accepts a bare li_at value', () => {
    const r = parseCookieInput(LI_AT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bundle.li_at).toBe(LI_AT);
  });

  it('parses a Cookie-header string and captures JSESSIONID (quotes stripped)', () => {
    const r = parseCookieInput(`li_at=${LI_AT}; JSESSIONID="ajax:1122334455"`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bundle.li_at).toBe(LI_AT);
      expect(r.bundle.jsessionid).toBe('ajax:1122334455');
    }
  });

  it('parses a JSON cookie export array', () => {
    const json = JSON.stringify([
      { name: 'bcookie', value: 'irrelevant' },
      { name: 'li_at', value: LI_AT },
      { name: 'JSESSIONID', value: 'ajax:999' },
    ]);
    const r = parseCookieInput(json);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bundle.li_at).toBe(LI_AT);
      expect(r.bundle.jsessionid).toBe('ajax:999');
    }
  });

  it('parses a JSON object form', () => {
    const r = parseCookieInput(JSON.stringify({ li_at: LI_AT }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bundle.li_at).toBe(LI_AT);
  });

  it('rejects empty input', () => {
    const r = parseCookieInput('   ');
    expect(r.ok).toBe(false);
  });

  it('rejects input with no li_at', () => {
    const r = parseCookieInput('JSESSIONID="ajax:1"; bcookie=foo');
    expect(r.ok).toBe(false);
  });

  it('rejects an implausibly short li_at', () => {
    const r = parseCookieInput('li_at=short');
    expect(r.ok).toBe(false);
  });
});

describe('LinkedIn session store (LKD-1)', () => {
  beforeEach(async () => {
    await prisma.connectedAccount.deleteMany({ where: { orgId: ORG } });
  });

  it('persists ciphertext (never the raw cookie) and round-trips via getSession', async () => {
    const saved = await saveSession(ORG, AGENT, `li_at=${LI_AT}; JSESSIONID="ajax:1"`);
    expect(saved.ok).toBe(true);

    const row = await prisma.connectedAccount.findFirst({
      where: { orgId: ORG, provider: LINKEDIN_PROVIDER, agentId: AGENT },
    });
    expect(row).not.toBeNull();
    expect(row!.encBlob).not.toContain(LI_AT); // stored encrypted, not plaintext
    expect(row!.encBlob.startsWith('k1:')).toBe(true);

    const session = await getSession(ORG, AGENT);
    expect(session?.li_at).toBe(LI_AT);
    expect(session?.jsessionid).toBe('ajax:1');
  });

  it('does not save, and reports the error, when the cookie is invalid', async () => {
    const r = await saveSession(ORG, AGENT, 'not-a-cookie');
    expect(r.ok).toBe(false);
    const count = await prisma.connectedAccount.count({ where: { orgId: ORG, provider: LINKEDIN_PROVIDER } });
    expect(count).toBe(0);
  });

  it('re-linking replaces the session (exactly one row, no stale duplicate)', async () => {
    await saveSession(ORG, AGENT, `li_at=${LI_AT}`);
    await setSessionStatus(ORG, AGENT, 'needs_relink');
    await saveSession(ORG, AGENT, `li_at=${LI_AT}NEWER-value-after-relink`);

    const rows = await prisma.connectedAccount.findMany({ where: { orgId: ORG, provider: LINKEDIN_PROVIDER, agentId: AGENT } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('active');
    const session = await getSession(ORG, AGENT);
    expect(session?.li_at).toBe(`${LI_AT}NEWER-value-after-relink`);
  });

  it('tracks status and stops serving the cookie once marked needs_relink', async () => {
    expect(await getSessionStatus(ORG, AGENT)).toBe('none');
    await saveSession(ORG, AGENT, `li_at=${LI_AT}`);
    expect(await getSessionStatus(ORG, AGENT)).toBe('active');

    await setSessionStatus(ORG, AGENT, 'needs_relink');
    expect(await getSessionStatus(ORG, AGENT)).toBe('needs_relink');
    // getSecret only returns the ACTIVE credential, so a stale session is no longer usable.
    expect(await getSession(ORG, AGENT)).toBeNull();
  });

  it('clearSession removes the stored session', async () => {
    await saveSession(ORG, AGENT, `li_at=${LI_AT}`);
    await clearSession(ORG, AGENT);
    expect(await getSession(ORG, AGENT)).toBeNull();
    expect(await getSessionStatus(ORG, AGENT)).toBe('none');
  });
});

describe('LinkedIn catalog adapter (LKD-1)', () => {
  it('is registered as a coming-soon token-onboarding tile', () => {
    const a = getAdapter('linkedin-browser');
    expect(a).toBeTruthy();
    expect(a!.onboarding).toBe('token');
    expect(a!.ready).toBe(false);
    expect(a!.label).toBe('LinkedIn');
  });

  it('has no inbound reply path — send() throws', async () => {
    const a = getAdapter('linkedin-browser');
    await expect(a!.send('agent', 'to', 'hi')).rejects.toThrow();
  });
});
