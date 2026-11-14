# Broadcast & Outbound Messaging API — Integration Plan

> ⛔ **OUT OF SCOPE (owner decision 2026-11-14).** The official WhatsApp **Cloud API /
> BROADCAST** path is dropped: `whatsapp-web.js` (QR) is the only agent transport, and
> outbound is the **Trackly-style QR drip** only (see [architecture/decision-log.md](architecture/decision-log.md)
> ADR-3 and the SCN module in [architecture/backlog.md](architecture/backlog.md)). This
> document is retained for reference; **do not implement the Cloud-API surface here**
> (a CI guard, QA-58, forbids it). The compliant-outbound design ideas may inform a
> future reversal if the owner adopts the Cloud API.

**Status:** Plan only (no code changes). Activates [BACKLOG.md B21](BACKLOG.md#L292).
**Goal:** Let external apps (starting with **Trackly**) send promotional WhatsApp messages
*through* this platform via a standard, reusable API — without importing their leads — and
have replies flow into the existing AI reply engine.

---

## 1. What we're building (one sentence)

Turn this reply-only WhatsApp agent into a **messaging-API provider**: a consent-aware,
template-based outbound (broadcast) service that any application can call — modelled on how
Twilio / Gupshup / WATI / Interakt expose theirs — while **inbound replies continue to be
handled by the trained AI agent**.

Trackly remains the system of record for its 3–4,000 leads and the promo content. It **calls
our API**; we do **not** ingest its leads database.

---

## 2. Two non-negotiable realities (read before anything else)

### 2.1 Promotional bulk ⇒ official Cloud API + approved templates only
- The QR transport (`whatsapp-web.js`, [channels/whatsapp.ts](../server/src/channels/whatsapp.ts))
  **must never be used for promotions.** Bulk/cold sends over an unofficial automated WhatsApp Web
  session are the single biggest ban trigger. This is already the stated doctrine
  ([README.md](../README.md#L83), [BACKLOG.md:296](BACKLOG.md#L296)).
- Promotions go through the **WhatsApp Business Cloud API** (Meta Graph), which we already use for
  OTP ([lib/whatsappCloud.ts](../server/src/lib/whatsappCloud.ts)). Business-initiated marketing
  requires a **pre-approved Marketing-category template**.

### 2.2 Google Places leads are not opted-in — fix consent, not just code
WhatsApp's Business Messaging Policy requires **opt-in before marketing**. Scraped Places leads are
cold. Blasting them marketing templates will:
- spike **blocks + "report business"**,
- crash the WABA **quality rating** (High → Medium → Low),
- drop the **messaging tier** (new numbers start at ~250 business-initiated conversations/24h),
- and end in **WABA restriction/ban** — regardless of code quality.

**Compliant ways to reach cold Places leads (pick per segment):**

| Path | How consent is captured | Notes |
|---|---|---|
| **Click-to-WhatsApp (CTWA) / QR / link** | Lead messages *us* first | Opens the 24-hour service window — reply freely, no template needed. Best for cold Places leads. |
| **First-touch on a cheaper channel** (SMS / email / IVR / call) with a clear WhatsApp opt-in ask | Lead replies YES / taps a link | Then WhatsApp marketing is allowed. |
| **Recorded explicit opt-in** at any prior touchpoint | Trackly stores consent + timestamp + source | Only send marketing to these. |

**Recommendation:** treat the WhatsApp *marketing broadcast* as the **second step**, reserved for
leads with recorded consent. Use utility/service templates or CTWA for everyone else. Trackly should
pass a **consent flag + source + timestamp** on every recipient; we suppress anyone without it.

> Cost note: marketing templates are billed **per message** (Meta India marketing rate card — verify
> current rate). At 3–4k recipients this is a real spend line; meter and cap it (see §6).

---

## 3. Current-state assessment

| Area | Today | Gap for broadcast |
|---|---|---|
| Reply engine | Channel-agnostic, inbound-driven ([engine.ts](../server/src/engine/engine.ts)) | Reusable as-is for promo replies ✅ |
| WhatsApp transport | QR (prod replies) + Cloud API (OTP only) | Extend Cloud API to send **any** approved template + receive Meta inbound webhook |
| Auth | Per-user bearer token ([middleware/auth.ts](../server/src/middleware/auth.ts)) | No **API-key** scheme for external apps — must add |
| Public surface | Widget endpoints only ([modules/public/router.ts](../server/src/modules/public/router.ts)) | No versioned partner API (`/api/v1`) |
| Queue | In-process, per-message | Need a **throttled** sender (rate/tier aware) — Redis/BullMQ per [ARCHITECTURE.md](ARCHITECTURE.md) |
| Consent / opt-out | None | Need suppression list + STOP handling |
| Delivery status | None | Need Meta status webhook + outbound callbacks to caller |
| Data model | Conversation/Message/Agent ([schema.prisma](../server/prisma/schema.prisma)) | Add ApiKey, Campaign, Recipient, OptOut, DeliveryEvent, WebhookEndpoint |

---

## 4. Standard integration architecture

```
Trackly (owns leads + "WhatsApp promotions" config)
   │
   │ 1. POST /api/v1/campaigns   Header: X-API-Key: sk_live_...
   │    body: { templateName, language, recipients:[{phone, vars, consent}], callbackUrl, idempotencyKey }
   ▼
┌───────────────────────── This platform ─────────────────────────┐
│ API-key middleware → validate → suppress (opt-out + no-consent)  │
│   → enqueue recipients → throttled sender (respects WABA tier)   │
│   → WhatsApp Cloud API (marketing template) → store msg id       │
│                                                                  │
│ Meta status webhook (sent/delivered/read/failed)  ──────────────┐│
│ Meta inbound webhook (a reply)  → existing reply engine → AI     ││
└──────────────────────────────────────────────────────────────┬──┘│
   │ 2. Signed webhook callbacks to Trackly                     │   │
   ▼  (message.sent / delivered / read / failed / replied / opted_out)
Trackly updates each lead's status
```

**Principle:** Trackly is the source of truth for *who* and *what*; we are the source of truth for
*delivery, consent enforcement, and the conversation that follows*.

### 4.1 Why this is "useful for others"
Every integration point is generic and documented, so **any** app integrates identically:
API key + versioned REST + approved templates + idempotency + signed delivery webhooks + opt-out.
That is the industry-standard CPaaS contract — not a Trackly-specific hack.

---

## 5. Public API surface (`/api/v1`, OpenAPI-documented)

All endpoints authenticate with an **org-scoped API key** (`X-API-Key` or `Authorization: Bearer`),
separate from the user bearer token. Keys are hashed at rest, prefixed (`sk_live_` / `sk_test_`),
scoped (`messages:send`, `templates:read`), and revocable.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/templates` | List approved WhatsApp templates (synced from Meta) + their variables |
| `POST` | `/api/v1/messages` | Send **one** template message (transactional) — `{to, templateName, language, vars, idempotencyKey}` |
| `POST` | `/api/v1/campaigns` | Create a **bulk** broadcast — `{templateName, language, recipients[], callbackUrl, scheduleAt?, idempotencyKey}` |
| `GET` | `/api/v1/campaigns/:id` | Campaign status + per-recipient breakdown (queued/sent/delivered/read/failed/suppressed) |
| `GET` | `/api/v1/messages/:id` | Single message status |
| `POST` | `/api/v1/opt-outs` | Caller can push known opt-outs; `GET` to reconcile |
| `POST` | `/api/v1/webhooks` | Register/rotate the caller's callback URL + signing secret |

**Contract rules (the "standard" checklist):**
- **Idempotency key** per request → safe retries, no double-sends.
- **Async by default:** `POST /campaigns` returns `202 Accepted` + `campaignId`; work happens in the
  throttled worker. Status via polling **or** webhook.
- **Signed webhooks out:** HMAC-SHA256 over the body with the per-endpoint secret; retries with
  exponential backoff; events `message.sent|delivered|read|failed|replied|opted_out`.
- **Consent enforced server-side:** recipients without `consent=true` (or on the suppression list)
  are **suppressed**, counted, and reported back — never silently dropped.
- **Rate limits per key** + **spend cap per org** (hard stop) + **WABA tier throttle**.
- **Versioned + OpenAPI spec** published so partners self-serve.

---

## 6. Data model additions (Prisma sketch — not final)

```prisma
model ApiKey {
  id        String   @id @default(uuid())
  orgId     String
  name      String
  hash      String   // store only the hash; show the secret once
  prefix    String   // e.g. sk_live_abcd (for display)
  scopes    String   // csv/json
  lastUsedAt DateTime?
  revokedAt DateTime?
  createdAt DateTime @default(now())
}

model Campaign {
  id           String   @id @default(uuid())
  orgId        String
  agentId      String                  // which WABA/number sends
  templateName String
  language     String
  status       String   @default("queued") // queued|sending|completed|failed|canceled
  callbackUrl  String?
  scheduleAt   DateTime?
  counts       String                  // json: {total,sent,delivered,read,failed,suppressed}
  createdAt    DateTime @default(now())
  recipients   CampaignRecipient[]
}

model CampaignRecipient {
  id           String   @id @default(uuid())
  campaignId   String
  phone        String
  varsJson     String                  // template variable values
  status       String   @default("queued") // queued|suppressed|sent|delivered|read|failed
  waMessageId  String?
  error        String?
  updatedAt    DateTime @updatedAt
  @@index([campaignId, status])
}

model OptOut {
  id        String   @id @default(uuid())
  orgId     String
  phone     String
  source    String                      // 'stop_keyword' | 'api' | 'manual'
  createdAt DateTime @default(now())
  @@unique([orgId, phone])
}

model DeliveryEvent {              // audit trail from Meta status webhooks
  id          String   @id @default(uuid())
  waMessageId String
  type        String                    // sent|delivered|read|failed
  payloadJson String
  createdAt   DateTime @default(now())
}

model WebhookEndpoint {
  id        String   @id @default(uuid())
  orgId     String
  url       String
  secret    String                      // HMAC signing secret
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
}
```
Promo replies reuse the existing `Conversation` / `Message` tables, so a campaign reply lands in the
same inbox and the trained agent answers it — no parallel system.

---

## 7. Where it plugs into existing code

1. **New `whatsapp-cloud` channel adapter** (`server/src/channels/whatsappCloud.ts` as a full
   `ChannelAdapter`, not just the OTP helper). Implements `send()` for templates and **receives Meta's
   inbound webhook**, normalising replies to `InboundMessage` → `engine.processInbound()`. This slots
   straight into the existing registry ([channels/registry.ts](../server/src/channels/registry.ts)) —
   exactly the migration path [ARCHITECTURE.md](ARCHITECTURE.md#L110) already describes.
2. **New `/api/v1` module** (`server/src/modules/v1/`) with an **API-key middleware** mirroring
   [middleware/auth.ts](../server/src/middleware/auth.ts) but keyed on `ApiKey.hash`.
3. **Throttled sender/worker** — the real Redis/BullMQ queue from
   [ARCHITECTURE.md](ARCHITECTURE.md#L11), sized to the WABA tier (start conservative, ramp with
   quality rating).
4. **Meta webhook endpoint** (`/api/webhooks/whatsapp`) for inbound + status, verified by Meta's
   `hub.verify_token` + payload signature.
5. **Reply engine untouched** — promo replies flow through `processInbound()` as-is.

---

## 8. Phased rollout

| Phase | Deliverable | Acceptance |
|---|---|---|
| **A — Official transport** | `whatsapp-cloud` adapter sends an approved template; Meta inbound/status webhook wired | A template sends to one consented number; a reply reaches the AI agent; status recorded |
| **B — Partner API + single send** | `ApiKey` model + `/api/v1/templates` + `/api/v1/messages` + OpenAPI | Trackly sends one promo via API key with an idempotency key |
| **C — Campaigns + consent** | `/api/v1/campaigns`, suppression (opt-out + no-consent), throttled worker, spend cap, STOP handling | A consented list sends throttled; opted-out suppressed + reported; cap halts overspend |
| **D — Delivery callbacks + analytics** | Signed outbound webhooks to Trackly; campaign dashboard (sent/delivered/read/failed/replied) | Trackly receives per-recipient status; dashboard matches |
| **E — Cold-lead on-ramp** | CTWA/QR opt-in capture + utility-template first-touch option | A cold Places lead opts in, then receives marketing compliantly |

Phases A–B are the minimum for a legitimate first promo; C adds the bulk + compliance spine; D makes
it a product others adopt; E solves the actual Places-leads problem.

---

## 9. The Trackly flow, concretely

1. Trackly admin configures the promo (template + variables) in Trackly's "WhatsApp promotions".
   → This must map to a **Meta-approved template** on our side (Trackly stores the `templateName`).
2. Trackly selects a segment and calls `POST /api/v1/campaigns` with each recipient's `phone`, `vars`,
   and **`consent`** (+ source/timestamp) and a `callbackUrl` + `idempotencyKey`.
3. We suppress opted-out/non-consented, enqueue the rest, throttle to tier, and send marketing
   templates via the Cloud API.
4. Meta status webhooks update each recipient; we fire **signed callbacks** to Trackly.
5. A reply enters `processInbound()` → the trained AI agent engages → optional `message.replied`
   callback so Trackly can flip the lead to "engaged."

---

## 10. Open decisions for the owner

1. **Consent status of the Places leads** — do any have recorded opt-in, or are they all cold? This
   decides whether Phase E (on-ramp) comes *before* any marketing send.
2. **One shared WABA vs. per-tenant** — does each customer bring their own WhatsApp number/WABA, or do
   we send on a shared number? (Affects quality-rating isolation and Meta onboarding — Embedded Signup.)
3. **Who owns template approval** — platform-managed template library, or self-serve per org?
4. **Billing model** — pass-through Meta per-message cost + margin, or bundled into plan tiers?
5. **Scope of v1** — Trackly-only first, or publish the OpenAPI spec for general partners from day one?

---

## 11. Standards compliance checklist (definition of "done the standard way")

- [ ] Official WhatsApp Cloud API for all business-initiated sends
- [ ] Only Meta-approved Marketing templates; no free-text cold sends
- [ ] Opt-in recorded (source + timestamp) before any marketing message
- [ ] Global opt-out / STOP honoured on every send; suppression reported back
- [ ] Org-scoped API keys (hashed, prefixed, scoped, revocable)
- [ ] Versioned REST (`/api/v1`) + published OpenAPI spec
- [ ] Idempotency keys on every mutating request
- [ ] Async send + throttle to WABA messaging tier + per-org spend cap
- [ ] HMAC-signed outbound webhooks with retry/backoff
- [ ] Full audit trail (campaign, per-recipient status, delivery events)
- [ ] Replies routed to the existing AI reply engine
