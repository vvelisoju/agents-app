# Trackly → Agent Outbound Integration Plan (QR drip)

> **Scope lock — BROADCAST / official Cloud API is OUT.** Per the locked architecture decision
> (**ADR-3**, owner call 2026-11-14 — see [architecture/decision-log.md](architecture/decision-log.md)),
> **`whatsapp-web.js` (QR) is the only agent transport**, and the official WhatsApp Cloud API /
> [BROADCAST_INTEGRATION_PLAN.md](BROADCAST_INTEGRATION_PLAN.md) path is **dropped**. The only agent
> outbound is the **QR-connected WhatsApp drip** (built + gated by `OUTBOUND_ENABLED`; see
> [architecture/EXECUTION_LOG.md](architecture/EXECUTION_LOG.md) → Phase 5 "Outbound QR drip"). In the
> shipped system recipients come from the **owner's own list**; **Trackly is an optional recipient
> source** reached through the reusable connector contract (SCN-08, not yet built). This document plans
> that optional source — it does not reintroduce a broadcast/Cloud-API channel.

**Status:** Plan only (no code changes).
**Scope:** Pull leads + promo content (image + text) from **Trackly**, send them through this
app's **QR-connected WhatsApp number** (`whatsapp-web.js`) as a **throttled daily drip**
(~100/day over ~3,000 leads), and write delivery status back to Trackly — via a **standard,
reusable connector contract** that any source app can implement.

> Relationship to [BROADCAST_INTEGRATION_PLAN.md](BROADCAST_INTEGRATION_PLAN.md): that plan is the
> compliance-first (official Cloud API, consent-gated) product vision. **This plan is the
> owner-accepted-risk "approach B" variant** — free QR channel, cold Places leads, risk mitigated
> only by low volume + intervals + opt-out. See §1.

---

## 1. Risk acknowledgement (in writing, as agreed)

This uses the **unofficial** `whatsapp-web.js` session to send **business-initiated** promos to
**cold, non-opted-in** Google Places leads. This is the top cause of WhatsApp number bans. Low daily
volume + randomized intervals + opt-out **reduce** the probability; they do **not** make it compliant
or safe. The connected number can still be **permanently banned**. Decision: proceed with a drip on an
**accepted-risk basis**, ideally on a **secondary number** (not the primary business line). Mitigations
are built into the design (§5), not bolted on.

---

## 2. Roles — who owns what

| | Trackly (source app) | This app (sender/agent) |
|---|---|---|
| Owns | Leads table, promo templates (image+text), campaign definition, final status view | The WhatsApp number/session, sending, throttle, ledger, opt-out, AI replies |
| Exposes | A small REST API (read recipients + promo, write status) + an **account API token** | A **connector** that calls Trackly's API on a schedule |
| Stores of the other | Nothing of ours | Trackly base URL + token (encrypted) + a local send ledger |

**Principle:** Trackly stays the **system of record** for *who* and *what*. This app is the
**sender/worker** that pulls work and reports results. We do **not** copy Trackly's leads DB; we hold
only a transient per-send ledger (for dedupe, cap counting, and restart-safety).

**Direction:** **Pull** (this app polls Trackly on a schedule). Chosen because Trackly is yours, the
drip runs for weeks, and you want status to live in Trackly. (A **push** variant — Trackly calls our
`/api/v1/campaigns` once and we drip — is the right shape for *third-party* apps; see
[BROADCAST_INTEGRATION_PLAN.md §5](BROADCAST_INTEGRATION_PLAN.md). Both can coexist behind the same
contract.)

---

## 3. The standard connector contract (reusable for any app)

Trackly (and any future source app) implements these four things. This app codes against the
**contract**, not against Trackly specifically — so a second app = a new Connection row + the same
field mapping, no new code.

### 3.1 Auth — account access token
- Trackly issues a **scoped token per account** (recommended: **OAuth2 client-credentials**
  `client_id`/`client_secret` → short-lived bearer; acceptable v1: a **signed Personal Access Token**).
- Scope: read that account's campaigns/recipients/promos + write their status. Nothing cross-account.
- This app sends `Authorization: Bearer <token>` on every call; token stored **encrypted** at rest.
- Trackly settings screen: **Generate / Revoke token**, show once, show last-used.

### 3.2 Endpoints (Trackly side)

| Method | Endpoint (example) | Returns / does |
|---|---|---|
| `GET` | `/api/v1/promo-campaigns/:id` | `{ id, name, text, mediaUrl?, mediaType?, variables:[...] }` — the promo content |
| `GET` | `/api/v1/promo-campaigns/:id/recipients?status=pending&limit=100&cursor=` | `{ items:[{ recipientId, phone, name, vars{}, consent? }], nextCursor }` — paginated |
| `POST` | `/api/v1/promo-campaigns/:id/recipients/status` | **batch** status write: `{ updates:[{ recipientId, status, providerMessageRef?, error?, at }] }` |
| `POST` | `/api/v1/promo-campaigns/:id/recipients/:rid/claim` *(optional)* | marks `pending → queued` so a second run can't grab it (lease) |

Notes:
- **Pagination** via opaque `cursor` (standard; avoids offset drift as statuses change).
- **Batch status** write (not one call per message) keeps it efficient at volume.
- `mediaUrl` must be fetchable by this app (signed/public URL, short TTL is fine).

### 3.3 Status lifecycle (the flag Trackly stores per recipient)

```
pending → queued → sent → delivered → read
   │         │        └→ failed
   │         └→ skipped_invalid   (number not on WhatsApp)
   └→ opted_out                   (replied STOP / on suppression list)
```
Trackly recipient row gains: `promo_status`, `sent_at`, `provider_message_ref`,
`error_reason`, `attempt_count`, `last_attempt_at`, `opted_out` (bool). This lets Trackly show a live
campaign progress bar and guarantees no re-send.

---

## 4. This app — new pieces (all additive)

### 4.1 Data model (new Prisma models — do not touch existing ones)
```prisma
model OutboundConnection {         // one per linked source app + agent
  id          String  @id @default(uuid())
  orgId       String
  agentId     String                // which WhatsApp agent/number sends
  provider    String  @default("trackly")
  baseUrl     String
  tokenEnc    String                // encrypted bearer / client-credentials
  dailyCap    Int     @default(100)
  windowStart Int     @default(10)  // hour, agent timezone
  windowEnd   Int     @default(18)
  minGapSec   Int     @default(180)
  maxGapSec   Int     @default(420)
  warmupJson  String?               // optional ramp: day1=20, day2=40...
  active      Boolean @default(false)
  createdAt   DateTime @default(now())
}

model OutboundSendLog {             // local ledger: dedupe + cap + restart safety
  id            String  @id @default(uuid())
  connectionId  String
  campaignRef   String                // Trackly campaign id
  recipientRef  String                // Trackly recipient id
  phone         String
  status        String  @default("queued") // queued|sent|delivered|read|failed|skipped_invalid|opted_out
  providerMsgId String?               // whatsapp-web.js message id (for ack mapping)
  error         String?
  sentAt        DateTime?
  createdAt     DateTime @default(now())
  @@unique([connectionId, campaignRef, recipientRef])   // idempotency key → never double-send
  @@index([connectionId, status])
}

model OutboundOptOut {              // STOP / suppression, per agent
  id        String  @id @default(uuid())
  agentId   String
  phone     String
  source    String                  // 'stop_keyword' | 'manual' | 'trackly'
  createdAt DateTime @default(now())
  @@unique([agentId, phone])
}
```

### 4.2 New WhatsApp adapter capability — `sendMedia` (additive)
Add to [channels/whatsapp.ts](../server/src/channels/whatsapp.ts) **alongside** `sendText` (existing
`send`/`sendText`/`processInbound` untouched):
```ts
export async function sendMedia(agentId, to, mediaUrl, caption) {
  const c = clients.get(agentId); if (!c) throw new Error('agent session not connected');
  const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
  return c.sendMessage(to, media, { caption });   // returns msg with id for ack tracking
}
export async function isOnWhatsApp(agentId, phoneDigits) {
  const c = clients.get(agentId); return c ? !!(await c.getNumberId(phoneDigits)) : false;
}
```
Also subscribe to `client.on('message_ack', ...)` to map ack level → `delivered`/`read` and update the
ledger + report to Trackly. (ACK 2 = delivered, 3 = read.)

### 4.3 The drip scheduler (the "100/day + intervals" engine)
A new module `server/src/outbound/scheduler.ts`, started from [index.ts](../server/src/index.ts) only
when the feature flag is on:
- A **timer** (node-cron every ~1 min, or a BullMQ repeatable job if/when Redis lands per
  [ARCHITECTURE.md](ARCHITECTURE.md)) that, for each `active` connection:
  1. **Guard:** inside `[windowStart, windowEnd)` in the agent's timezone? Agent `status==connected`? Not paused?
  2. **Cap check:** `sentToday(connection) < effectiveCap` (warmup ramp or `dailyCap`). Counter derived from `OutboundSendLog.sentAt` since local midnight — survives restarts.
  3. **Gap check:** has `random(minGap,maxGap)` elapsed since the last send? If not, skip this tick.
  4. **Pull one** (or a small buffered batch) from Trackly `recipients?status=pending`; dedupe against the ledger + opt-out list.
  5. **Validate** the number (`isOnWhatsApp`) → if not, mark `skipped_invalid`, report, continue.
  6. **Send** `sendMedia(agent, phone, mediaUrl, renderedCaption)`; write ledger `sent` + `providerMsgId`; **report `sent` to Trackly**.
  7. `message_ack` later flips ledger + Trackly to `delivered`/`read`.
- **Spread, not burst:** 100 sends across an 8-hour window ≈ one every ~5 min with jitter — looks like a human, not a blast.
- **Pause/resume/stop** per connection; **warmup** ramp (e.g. 20 → 40 → 70 → 100 over the first days).
- **Failure handling:** transient send error → retry with backoff up to N, then `failed` + report.

### 4.4 Opt-out loop (reuses the existing engine)
Inbound replies already hit `processInbound` ([engine.ts](../server/src/engine/engine.ts)). Add a
**pre-check**: if the inbound text matches STOP/UNSUBSCRIBE/"band karo" etc. → upsert `OutboundOptOut`,
report `opted_out` to Trackly, send a one-line confirmation, and **do not** AI-reply. Everything else
flows to the AI agent as today — so a promo reply becomes a real conversation your agent handles.

---

## 5. Daily-drip mechanism summary (your Q: "how send 100/day, what mechanism")

| Concern | Mechanism |
|---|---|
| Cap at 100/day | `dailyCap` + `sentToday()` counter from the ledger (reset at local midnight) |
| Spread over the day | Send window (`windowStart`–`windowEnd`) + randomized `minGap`–`maxGap` between sends |
| Survive restarts | `OutboundSendLog` is the source of truth for counts + what's already sent |
| Never double-send | `@@unique(connection, campaign, recipient)` idempotency key |
| Respect WhatsApp health | Warmup ramp, number validation, invalid skip, opt-out suppression |
| Report progress | Per-send status write-back to Trackly (+ ack-based delivered/read) |
| Resume where it left off | Next tick simply pulls the next `pending` from Trackly |

For 3,000 leads at 100/day ⇒ ~30 days. Start the warmup lower (20–40/day) for the first week.

---

## 6. End-to-end flow

```
          ┌──────────── This app (scheduler tick, every ~1 min) ─────────────┐
Trackly   │ in window? under cap? gap elapsed?                               │
  │  GET recipients?status=pending&limit=1   ◀───────────────────────────────┤
  │  GET promo-campaigns/:id (text+image)    ◀───────────────────────────────┤
  │                                           validate number → sendMedia ──► WhatsApp ──► lead
  │  POST recipients/status {sent, msgId}    ◀───────────────────────────────┤
  └──────────────────────────────────────────────────────────────────────────┘
          message_ack (delivered/read) ─► POST recipients/status {delivered|read}
          lead replies ─► processInbound ─► STOP? opt-out+report : AI agent answers
```

---

## 7. No-regression guarantees

- **Additive only.** New models, new `outbound/` module, new `sendMedia`/`isOnWhatsApp`, new scheduler.
  Existing `send`/`sendText`/`processInbound`/routes/boot are not modified (only *extended* with the
  STOP pre-check, guarded so default behaviour is identical).
- **Feature-flagged off by default** (`OUTBOUND_ENABLED` + per-connection `active=false`). With the flag
  off, the app behaves exactly as today.
- **Shared session safety.** Campaign sends and inbound replies use the **same** `whatsapp-web.js`
  client. At ~1 send / 5 min the drip never starves replies; add a tiny per-client **send mutex** so we
  never invoke `sendMessage` concurrently. Replies stay event-driven and effectively take priority.
- **Session restore unchanged** — the scheduler only acts on agents already `connected`
  ([index.ts](../server/src/index.ts) restore path is untouched).
- **Tests:** existing suite must stay green; add unit tests for cap/window/gap/idempotency/opt-out and a
  mock-Trackly integration test. No change to existing test expectations.

---

## 8. Build phases

| Phase | Deliverable | Acceptance |
|---|---|---|
| **0 — Trackly contract** | Token issuance + read (recipients, promo) + batch status endpoints on Trackly | Postman can pull a page of recipients + a promo, and write a status, with a scoped token |
| **1 — Send primitive** | `sendMedia` + `isOnWhatsApp` + `message_ack` mapping in this app | One image+caption sends to one number; delivered/read captured |
| **2 — Connection + ledger** | `OutboundConnection`/`OutboundSendLog`/`OutboundOptOut` + encrypted token store + connect UI | A connection links an agent to a Trackly campaign; token validates |
| **3 — Drip scheduler** | Cap + window + jitter + warmup + pull/validate/send/report loop (flagged) | 100/day spread across the window; counts survive a restart; no double-send |
| **4 — Opt-out + status sync** | STOP pre-check + suppression + full status write-back incl. delivered/read | STOP suppresses + reports `opted_out`; Trackly shows live progress |
| **5 — Controls + safety** | Pause/resume/stop, per-day/number caps, dashboard, audit log | Owner can halt instantly; dashboard matches Trackly |

Phase 0 is Trackly-side and can proceed in parallel. Phases 1–3 are the core of this app.

---

## 9. Open decisions for the owner

1. **Auth style:** OAuth2 client-credentials (more standard, token rotation) **or** a signed PAT
   (simpler v1)? — recommend PAT for v1, migrate to client-credentials later.
2. **Claim/lease step** (Trackly marks `pending→queued` on pull) or **ledger-only** idempotency?
   — recommend ledger-only for a single sender; add claim if you ever run >1 sender.
3. **Which number sends** — the primary business line or a **dedicated secondary number**?
   — strongly recommend a secondary number given the accepted ban risk.
4. **Promo variables** — does Trackly personalise per lead (name/offer), and are those the `vars`
   we render into the caption? Confirm the variable list.
5. **Media hosting** — can Trackly give a fetchable `mediaUrl` (public/signed), or must we accept the
   image bytes inline in the recipient payload?
6. **One campaign at a time per number**, or multiple concurrent (shared daily cap)? — recommend one
   at a time per number to keep volume predictable.
