// AUD-1 — audit writer tests. Deterministic + offline: uses the isolated SQLite
// test DB wired up in tests/setup.ts and the shared prisma client.
import { describe, it, expect } from 'vitest';
import prisma from '../src/lib/prisma';
import { audit } from '../src/lib/audit';

// audit() is fire-and-forget (returns void), so the row is written on a detached
// promise. Rather than guess a fixed delay (cold-start DB latency varies), poll
// for the expected row until it lands or we hit a generous ceiling.
async function waitForRow(orgId: string, action: string) {
  for (let i = 0; i < 100; i++) {
    const row = await prisma.auditLog.findFirst({ where: { orgId, action } });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

describe('audit() append-only writer (AUD-1)', () => {
  it('writes an AuditLog row with the given action + orgId', async () => {
    const orgId = `org_${Math.random().toString(36).slice(2)}`;
    audit({ orgId, actorUserId: 'u1', action: 'approval.approve', targetType: 'Approval', targetId: 'a1' });
    const row = await waitForRow(orgId, 'approval.approve');
    expect(row).not.toBeNull();
    expect(row!.orgId).toBe(orgId);
    expect(row!.actorUserId).toBe('u1');
    expect(row!.actorType).toBe('user'); // schema default when omitted
    expect(row!.targetType).toBe('Approval');
    expect(row!.targetId).toBe('a1');
  });

  it('redacts sensitive metadata fields before they reach the trail', async () => {
    const orgId = `org_${Math.random().toString(36).slice(2)}`;
    audit({
      orgId,
      action: 'credential.create',
      metadata: { provider: 'telegram', token: 'super-secret-bot-token', note: 'ok' },
    });
    const row = await waitForRow(orgId, 'credential.create');
    expect(row).not.toBeNull();
    expect(row!.metadataJson).toBeTruthy();
    // The raw secret must never appear; the field is masked, other fields kept.
    expect(row!.metadataJson).not.toContain('super-secret-bot-token');
    const meta = JSON.parse(row!.metadataJson!);
    expect(meta.token).toBe('[redacted]');
    expect(meta.provider).toBe('telegram');
    expect(meta.note).toBe('ok');
  });

  it('never throws into the caller (fire-and-forget)', () => {
    // Missing orgId would fail the DB insert, but audit() must still return void
    // synchronously without throwing; the rejection is swallowed to log.error.
    expect(() => audit({ orgId: '', action: 'noop' })).not.toThrow();
  });
});
