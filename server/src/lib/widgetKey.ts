// FND-12 — signed website-widget key. The public widget endpoints were keyed only by
// the agent's UUID (guessable/visible), so anyone could drive unbounded Claude spend.
// The key is a stateless HMAC of the agentId under a server secret: no table needed,
// and rotating WIDGET_SIGNING_SECRET invalidates every previously-issued snippet.
import crypto from 'node:crypto';

function secret(): string {
  const s = process.env.WIDGET_SIGNING_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    // SEC-17 also fails fast at boot; this guards the per-request path.
    throw new Error('WIDGET_SIGNING_SECRET is not set — required to sign website widget keys in production.');
  }
  return 'dev-widget-signing-secret'; // dev/test only
}

export function widgetKey(agentId: string): string {
  return crypto.createHmac('sha256', secret()).update('widget:' + agentId).digest('hex').slice(0, 32);
}

export function verifyWidgetKey(agentId: string, key: string): boolean {
  if (!key) return false;
  const expected = Buffer.from(widgetKey(agentId));
  const given = Buffer.from(String(key));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
