# Ban-risk & ToS guardrail matrix (SCN-39)

How each standard scenario sends, the WhatsApp-ban / ToS risk it carries, and the mitigations
baked into the platform. This is the single reference for "is this safe, and why".

## Scope decisions (locked)

- **Agent transport is whatsapp-web (QR) ONLY.** The Meta **Cloud API / BROADCAST** path for agents
  is **OUT** (locked decision #2). The Cloud API (`lib/whatsappCloud.ts`) remains a **platform-level
  OTP sender** for signup/reset only, never an agent channel. Enforced by a static guard test
  (`tests/broadcastExclusion.test.ts`, SCN-15).
- **Flight monitoring** and **LinkedIn DM automation** are **OUT** of scope.

## The matrix

| Scenario | Transport | Direction | Ban / ToS risk | Mitigations |
|---|---|---|---|---|
| **1. Reply agent** (WhatsApp) | whatsapp-web (QR) | Inbound → reply within the conversation | **Low** — replying to someone who messaged you first, inside the 24h window, is normal use | Per-conversation lock (no double-reply); business-hours away-once; approve-before-send default; owner alert on hot leads; NEEDS_HUMAN escalation |
| **1b. Reply agent** (Website / Telegram) | Website widget / Telegram Bot API | Inbound → reply | **None** (WhatsApp ToS doesn't apply) | Same reply engine; channel-aware prompt (SCN-01); widget signed key + rate cap |
| **2. Outbound drip** | whatsapp-web (QR) | **Proactive outbound** to a recipient list | **Accepted-risk** — unsolicited outbound on whatsapp-web can get a number banned | Low-volume default (50/day) + **warmup ramp**; **send window**; **randomized jitter** between sends; **STOP opt-out** (suppressed forever) with a **mandatory opt-out footer** on every message; **per-agent send mutex** (never collides with live replies); **approval-gated start** (nothing sends until the owner approves); per-tenant **budget cap**; **ledger idempotency** (never double-send); **secondary-number** recommendation + **persisted written risk acknowledgement** required to activate |
| **3. Appointment booking** | (internal Booking table) | Tool action on the reply/agentic path | **None** (no WhatsApp send risk) | Approve-before-book; transactional double-book guard; audit trail |
| **4. Website monitor** | Outbound HTTP fetch of a public page | Scheduled fetch → notify the owner | **None** (no WhatsApp send risk) | SSRF allowlist on every fetch + redirect hop; polite cadence (min hourly); notify only on a real change |
| **5. Multi-agent (shared record)** | n/a (internal data) | Cross-agent read/write within one org | **None** | Strict org isolation |

## Why the outbound drip is "accepted-risk", not "safe"

whatsapp-web drives a personal WhatsApp session. Sending unsolicited messages at volume is against
WhatsApp's terms and **can get the number banned** regardless of our mitigations. The platform makes it
**as safe as the channel allows** (low volume, jitter, window, warmup, opt-out, approval) and makes the
risk **explicit and owner-acknowledged** — but it does not make it risk-free. The product guidance is to
use a **dedicated secondary number**, never the main business line.

## Feature flags (default OFF → byte-for-byte today)

`WORKFLOW_ENABLED` (spine), `MONITOR_ENABLED` (website monitor), `OUTBOUND_ENABLED` (drip + STOP
opt-out). With all unset, the app behaves exactly as the single-turn reply bot and no proactive send
can occur. Per-connection `active=false` and per-watch `active` add a second gate.
