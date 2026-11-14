// SCN-15 — locked decision #2: agent outbound is whatsapp-web (QR) ONLY. The Meta Cloud API
// (whatsappCloud.ts) stays a PLATFORM-level OTP sender and must never be wired into any agent
// reply or outbound-drip send path. This static guard greps the source tree so a future import
// from an engine/channel/outbound module fails CI.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('BROADCAST / Cloud-API exclusion (SCN-15)', () => {
  const files = walk(SRC);

  it('whatsappCloud is imported only by the OTP module', () => {
    const importers = files.filter((f) => {
      if (f.endsWith(join('lib', 'whatsappCloud.ts'))) return false; // the module itself
      return /from ['"].*whatsappCloud['"]/.test(readFileSync(f, 'utf8'));
    });
    const rel = importers.map((f) => f.replace(SRC, '').replace(/\\/g, '/'));
    expect(rel).toEqual(['/lib/otp.ts']);
  });

  it('no engine / channel / outbound module references the Cloud API', () => {
    const forbidden = files.filter((f) => {
      const rel = f.replace(SRC, '').replace(/\\/g, '/');
      const inSendPath = rel.startsWith('/engine/') || rel.startsWith('/channels/') || rel.includes('/outbound') || rel.includes('/workflow/handlers/');
      return inSendPath && /whatsappCloud/.test(readFileSync(f, 'utf8'));
    });
    expect(forbidden).toEqual([]);
  });

  it('the Cloud-API module exposes only OTP primitives (no broadcast/campaign send)', () => {
    const src = readFileSync(join(SRC, 'lib', 'whatsappCloud.ts'), 'utf8');
    expect(/broadcast|campaign|bulk/i.test(src)).toBe(false);
  });
});
