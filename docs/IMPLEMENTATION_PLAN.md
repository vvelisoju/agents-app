# Implementation plan

Aligned to the core requirement: **end-to-end functionality first**, subscription later.

## Phases

| Phase | Focus | Includes | Excludes |
|---|---|---|---|
| **1 — End-to-end MVP** | The full working loop | Signup/login; add WhatsApp agent via **QR** (many per user); **train** (instructions, restrictions, facts, links, FAQs) + view + edit anytime; reply engine (approve or auto); conversations view | Billing, other channels |
| 2 — Billing + polish | Monetize + harden | **Razorpay** subscription + plan limits; usage metering; analytics; vector RAG for large links | — |
| 3 — Multi-channel | Breadth | Adapter registry; Instagram / Gmail / Telegram; optional official WhatsApp **Cloud API** | — |
| 4 — Scale | Growth | Session sharding across workers; team seats; mobile store releases; outbound (metered) | — |

## Phase 1 critical path (build order)

1. **Repo + skeleton.** Monorepo (see below). Postgres + Redis. Email/password auth (JWT).
2. **Data model + agents CRUD.** All tables in [DATA_MODEL.md](DATA_MODEL.md).
3. **WhatsApp session worker.** `whatsapp-web.js` with **RemoteAuth** (session in DB/S3); QR + status
   events; start/stop/reconnect. Generalizes the current prototype's `agents/whatsapp-reply/index.js`.
4. **QR onboarding UI.** Add-agent flow → WebSocket QR → scan → **Connected**. Support many agents.
5. **Training module.** Profile + sources CRUD; the Training screen; the Test Console ([TRAINING.md](TRAINING.md)).
6. **Reply engine.** Inbound → queue → load training → Claude (Haiku) → auto-send or draft; log
   messages + usage. Reuses the prototype's brain and persona/link logic.
7. **Conversations view.** Chats, messages, pending drafts (approve / skip / edit).
8. **Subscription stub.** Free plan auto-created on signup; feature flags ready for Razorpay.

## API surface (Phase 1)

- **Auth:** `POST /auth/signup/start` + `/auth/signup/verify` (phone OTP), `POST /auth/login`, `POST /auth/forgot` + `/auth/reset`, `GET /me`
- **Agents:** `GET/POST /agents`, `GET/PATCH/DELETE /agents/:id`, `POST /agents/:id/connect`
  (start session + QR), `POST /agents/:id/disconnect`
- **Realtime:** `WS /agents/:id/events` — `qr`, `status`, `message`
- **Training:** see [TRAINING.md](TRAINING.md)
- **Conversations:** `GET /agents/:id/conversations`, `GET /conversations/:id/messages`,
  `POST /messages/:id/approve`, `POST /messages/:id/skip`

## End-to-end acceptance criteria — the definition of "works without issues"

With billing stubbed, a brand-new user can:

1. Sign up and log in → account + free subscription created.
2. Add a WhatsApp agent, see a QR, scan it → agent shows **Connected**.
3. Add a **second** WhatsApp agent with a different number → both stay connected independently.
4. Train agent 1 (instructions + restrictions + 2 facts + 1 link + 1 FAQ), see them listed, and run
   the **Test Console** to get a sensible draft.
5. Message the agent's number from another phone → it replies using the training (auto-send on) or
   shows a draft to approve (auto-send off).
6. Edit a training instruction → the **next** reply reflects it, with no restart.
7. Restart the worker → sessions **reconnect from stored auth** without re-scanning.
8. One org's data is invisible to another org (tenant isolation).

## Risk review — will it hold together end-to-end?

| Risk / issue | Why it matters | How the design handles it |
|---|---|---|
| Many `whatsapp-web.js` sessions are heavy | Each is a headless browser | Dedicated worker; RemoteAuth persistence; per-box ceiling (~25–50); horizontal sharding; Cloud API later |
| Sessions lost on restart/deploy | Users would re-scan | RemoteAuth in DB/S3; worker restores on boot (criterion 7) |
| QR must reach the user's screen | Generated server-side | WebSocket push of `qr`+`status`; re-scan path on auth loss |
| Training must apply instantly | Owners expect edits to just work | Engine reads training per message + cache invalidation on save (criterion 6) |
| A link is private or fails to fetch | Broken knowledge | Pipeline marks `failed` + retry; failures never block replies; status shown |
| Wrong/irrelevant AI replies | Trust | Per-agent approve-before-send; `NEEDS_HUMAN` escalation; Test Console before go-live |
| WhatsApp ban risk (unofficial) | Account safety | Reply-only (never bulk-blast); sane volumes; Cloud API migration behind the same adapter |
| Tenant data leakage | Security | `org_id` + row-level security; encrypted session credentials (criterion 8) |
| Concurrent messages overlap | Lost/duplicate replies | Redis queue serializes per conversation; idempotent send |

**Conclusion.** The loop closes end-to-end with these mitigations. The one deliberate trade-off is
QR / `whatsapp-web.js` for Phase 1 (chosen for the requested scan-to-login UX). Its scaling limit is
known and **isolated behind the channel adapter**, so moving heavy use to the official Cloud API later
does not touch the app, the training, or the engine.

## Target repo structure

```
/app       React + Vite + Capacitor (web + iOS + Android)
/api       Node + TypeScript — REST + WebSocket
/worker    WhatsApp session worker (whatsapp-web.js + RemoteAuth)
/engine    Reply engine (Claude + training)   [may start inside /api]
/shared    Shared types + the Claude "brain" helper (from this prototype)
/docs      This spec
/agents    The current single-tenant prototype (kept as reference)
```
