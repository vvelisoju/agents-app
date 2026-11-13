// WhatsApp Cloud API (Meta Graph) — cloned from ClassPe's meta-client.ts shape.
// Sends the OTP AUTHENTICATION template (body param = code + url button = code;
// Meta 400s without that button). Reads WHATSAPP_* env; add the keys to enable
// real sends (without them, dev falls back to devOtp — see lib/otp.ts).
import { toWhatsappDigits } from './phone';

const HOST = 'https://graph.facebook.com';
const apiVersion = () => process.env.WHATSAPP_API_VERSION || 'v24.0';
const phoneNumberId = () => process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const apiToken = () => process.env.WHATSAPP_API_TOKEN || '';
const otpTemplate = () => process.env.WHATSAPP_OTP_TEMPLATE || 'classpe_otp_v1';
const otpLang = () => process.env.WHATSAPP_OTP_LANG || 'en_US';

export const isSendConfigured = () =>
  !!(phoneNumberId() && apiToken()) && process.env.WHATSAPP_SEND_ENABLED !== 'false';

export async function sendOtp(phone10: string, code: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSendConfigured()) return { ok: false, error: 'not_configured' };
  const body = {
    messaging_product: 'whatsapp',
    to: toWhatsappDigits(phone10),
    type: 'template',
    template: {
      name: otpTemplate(),
      language: { code: otpLang() },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${HOST}/${apiVersion()}/${phoneNumberId()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.messages?.[0]?.id) return { ok: true };
    return { ok: false, error: j?.error?.error_user_msg || j?.error?.message || `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'send failed') };
  } finally {
    clearTimeout(timer);
  }
}
