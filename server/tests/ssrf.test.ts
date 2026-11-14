// FND-15 / QA-09 — SSRF guard. Offline: exercises the private-range detection and
// URL rejection via IP literals + hostname rules (no DNS/network needed).
import { describe, it, expect } from 'vitest';
import { isPrivateIp, assertPublicUrl } from '../src/lib/ssrfGuard';

describe('ssrfGuard.isPrivateIp', () => {
  it('flags loopback / private / link-local / metadata / CGNAT ranges', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.9.9', '172.31.255.1', '192.168.1.1',
      '169.254.169.254', '169.254.0.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', 'fd12::1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.9', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe('ssrfGuard.assertPublicUrl', () => {
  const blocked = [
    'http://127.0.0.1/',
    'http://localhost:8080/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://10.0.0.5/internal',
    'http://192.168.1.1/',
    'http://db.internal/',
    'http://printer.local/',
    'ftp://example.com/file',
    'file:///etc/passwd',
  ];
  for (const url of blocked) {
    it(`rejects ${url}`, async () => {
      await expect(assertPublicUrl(url)).rejects.toThrow();
    });
  }

  it('accepts a public IP literal without a DNS lookup', async () => {
    const u = await assertPublicUrl('http://8.8.8.8/path');
    expect(u.hostname).toBe('8.8.8.8');
  });
});
