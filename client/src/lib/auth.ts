// Phone-number auth (India). Accounts are keyed by a 10-digit mobile number;
// the server normalizes +91/91/0 prefixes, so the client sends the local 10 digits.

export function normalizeMobile(m: string): string {
  let d = (m || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

export function formatMobile(value: string): string {
  const d = normalizeMobile(value);
  if (d.length === 10) return '+91 ' + d.slice(0, 5) + ' ' + d.slice(5);
  return d ? '+91 ' + d : '';
}

export const isValidMobile = (m: string) => normalizeMobile(m).length === 10;
