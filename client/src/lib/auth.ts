// Mobile-number auth. India uses mobile numbers, not email. The (frozen)
// backend is email+password, so we map a mobile number to a stable internal
// identifier — the user only ever sees/enters their mobile number.
const DOMAIN = '@phone.secureagents';

export const normalizeMobile = (m: string) => (m || '').replace(/\D/g, '').replace(/^0+/, '');

export const emailFromMobile = (m: string) => normalizeMobile(m) + DOMAIN;

export const mobileFromEmail = (e: string | null | undefined) =>
  e && e.endsWith(DOMAIN) ? e.slice(0, -DOMAIN.length) : (e || '');

export function formatMobile(value: string): string {
  const d = normalizeMobile(value);
  const local = d.length === 12 && d.startsWith('91') ? d.slice(2) : d;
  if (local.length === 10) return '+91 ' + local.slice(0, 5) + ' ' + local.slice(5);
  return d ? '+' + d : '';
}

// A valid Indian mobile: 10 digits (optionally with 91 country code).
export const isValidMobile = (m: string) => {
  const d = normalizeMobile(m);
  return d.length === 10 || (d.length === 12 && d.startsWith('91'));
};
