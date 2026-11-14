// FND-15 — SSRF guard. Owner-supplied URLs (train-from-link today; web.fetch_page,
// document ingestion and scheduled monitors later) are fetched server-side. Without
// this, an owner could point them at internal services or the cloud metadata endpoint
// (169.254.169.254). This module resolves the target and refuses private/loopback/
// link-local/metadata addresses — and re-checks every hop of a redirect chain.
import dns from 'node:dns/promises';
import net from 'node:net';

export function ssrfError(msg: string): Error & { friendly?: boolean } {
  const e = new Error(msg) as Error & { friendly?: boolean };
  e.friendly = true;
  return e;
}

const BLOCKED_MSG =
  "That link points to a private or internal address, so we can't read it. Use a public link like your website.";

const BLOCKED_HOSTS = new Set(['localhost', 'ip6-localhost', 'metadata.google.internal']);

/** True if an IP literal is in a loopback / private / link-local / CGNAT / metadata range. */
export function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^::ffff:/i, ''); // unwrap IPv4-mapped IPv6
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(v)) {
    const low = v.toLowerCase();
    if (low === '::1' || low === '::') return true; // loopback / unspecified
    if (low.startsWith('fe80')) return true; // link-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique-local
    return false;
  }
  return true; // not a parseable IP → refuse
}

/** Validate a single URL: http(s) only, no blocked host, and no address that resolves private. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw ssrfError('That does not look like a valid link.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw ssrfError('Only http and https links are supported.');
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    throw ssrfError(BLOCKED_MSG);
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw ssrfError(BLOCKED_MSG);
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw ssrfError("We couldn't reach that link. Check the address is correct and the page is public.");
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw ssrfError(BLOCKED_MSG);
  }
  return u;
}

/**
 * Fetch that validates the target and every redirect hop against the SSRF guard.
 * Uses manual redirect handling so a public URL cannot bounce to an internal one.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  maxRedirects = 4,
): Promise<Response> {
  let current = (await assertPublicUrl(raw)).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return res;
    current = (await assertPublicUrl(new URL(loc, current).toString())).toString();
  }
  throw ssrfError('That link redirected too many times.');
}
