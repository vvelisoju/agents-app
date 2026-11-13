// Normalize an Indian mobile to a 10-digit local number (digits only).
// Returns null if it isn't a plausible Indian mobile.
export function normalizePhone(input: string): string | null {
  let p = String(input || '').replace(/\D/g, '');
  if (p.length === 12 && p.startsWith('91')) p = p.slice(2);
  if (p.length === 11 && p.startsWith('0')) p = p.slice(1);
  if (!/^[6-9]\d{9}$/.test(p)) return null; // Indian mobiles start 6–9, 10 digits
  return p;
}

// What the WhatsApp Cloud API wants in `to`: country code + number, digits only.
export const toWhatsappDigits = (phone10: string) => '91' + phone10;
