// Website chat widget channel. Fully ours — no external accounts. The widget
// (public/widget.js) POSTs inbound messages and polls for replies, so delivery
// is "the reply is in the DB"; send() is a no-op. The public router drives it.
import { register } from './registry';

export async function send(_agentId: string, _to: string, _text: string) {
  // No-op: the embedded widget polls GET /api/public/widget/:id/messages for
  // outbound 'sent' messages (auto-send replies and approved drafts alike).
}

register({ type: 'website', onboarding: 'embed', label: 'Website', blurb: 'A chat widget on your site', ready: true, capabilities: ['text'], send });
