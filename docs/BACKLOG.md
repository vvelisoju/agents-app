# Backlog — task bundles & tasks

Complete, end-to-end task list. Organized as **bundles (epics) → tasks**, each with an acceptance
criterion (AC). Execute bundle by bundle, task by task.

**Legend:** ✅ done (in `platform/` skeleton) · 🔨 partial · ⬜ to do.
**Definition of done (every task):** meets its AC · within the UX_PRINCIPLES click budget · has a test
where testable · **no regression** (the root prototype and the current app still work).
**Standards:** backend + UI/UX follow [ClassPe patterns](AGENTS.md) and [UX_PRINCIPLES.md](UX_PRINCIPLES.md).
**Phase map:** B0–B8 = Phase 1 (MVP) · B9–B11, B14, B18–B19, B22 = Phase 2 · rest = Phase 3–4.

---

## Gap review — round 2 (2026-11-13)

Reviewed the first backlog for a *complete* SaaS. Gaps found and now closed:

| Gap (was missing/weak) | Now covered by |
|---|---|
| "Train from a link" as a first-class, no-typing setup (now built in the skeleton) | T5.2, T5.9 |
| Upload a PDF/catalogue/price list as training | T5.10 |
| **1-tap setup by business type** (vertical templates) — the biggest "easy" lever | **B22** |
| **Leads capture + light CRM + export** (the whole point is leads) | **B18** |
| **Human takeover** of a live chat, business hours, away messages, agent pause | **B19** |
| **Payment links in chat** (Razorpay collect — tier-2 sales) | **B20** |
| **Broadcast/outbound** with compliance (deferred but planned) | **B21** |
| Team invites, roles, multi-business **workspace switcher** | T2.5, T2.6 |
| **First-run activation** funnel (the critical first 5 minutes) | T1.7 |
| Accessibility, feature flags | T1.8, T1.9 |
| Transactional **OTP-SMS + email** delivery (OTP, alerts, receipts) | T12.6 |
| Inbound **spam/abuse** throttle, per-tenant **spend caps**, **legal/consent** | T13.7, T13.8, T13.9 |
| Activation-funnel analytics, **audit log** | T14.5, T14.6 |
| Canned/quick replies | T7.6 |
| Training **history/undo** | T5.11 |

No further gaps found for an MVP→SaaS path. The cross-cutting checklist at the end is the final guard.

---

## Build progress log

**2026-11-13 — B0 foundation + client foundation built & verified.** The production app now lives in
`server/` (Express + Prisma, ClassPe-aligned) and `client/` (React + Vite, invisible-UI). Verified:
- `server/`: typecheck clean · Prisma 5.22 + SQLite (`dev.db`) · full REST API · smoke test passed end
  to end (signup → agent → train → **real Claude draft with link substitution** → connect reaches QR),
  including **cross-tenant isolation** (another org blocked, 404).
- `client/`: `npm run build` clean (1658 modules, 75 KB gz) · dev server serves the SPA and proxies
  `/api` to the server · screens: Login, Agents gallery, Agent detail with Connect/QR, **train-from-link**,
  Test console, Chats (approve/skip). Design system: Tailwind HSL tokens + lean shadcn-style kit, React
  Query (queries retry / mutations never), wouter, realtime WS hook, auth context.
- Runs on ports **4001** (server) / **5173** (client); the prototype (`platform/`, port 4000) and the
  root prototype are untouched — **no regression**.

Delivered toward: B0 (all), B1.1/1.2/1.4/1.5/1.6, B2.4 (plan-limit 402), B3.2–3.5, B4.1/4.5, B5.1–5.7,
B6.1/6.5, B7.1/7.2.

**2026-11-13 (2) — channel adapter framework + 2nd channel (B3.1, B9.1) built & verified.** Introduced a
`ChannelAdapter` interface + registry + a normalised `InboundMessage`; refactored the engine to be fully
channel-agnostic (`processInbound`), and made connect/disconnect/approve adapter-driven. Added the
**Website chat widget** channel (fully ours, no external accounts): a public `/api/public/widget/:id`
inbound+poll API, an embeddable `public/widget.js`, the gallery tile, and the embed-snippet UI.
Verified end to end: a website agent auto-replies to a visitor's message from its training, the visitor
polls and receives it, it appears in the owner inbox — **and WhatsApp still reaches QR (no regression)**.
This proves "support many different agent types". Delivered toward: B3.1, B3.5, B9.1.

**2026-11-13 (3) — conversation control + leads + tests (B19, B18, B15.1) built & verified.** Backend:
agent **pause**, per-conversation **human takeover** + **mute** + owner **manual reply**; **leads/CRM**
(org-wide list, status + notes, CSV export). Added **10 unit tests** (training compose, link
substitution, templates, learn helpers) — all green. Smoke-verified: paused/taken-over agents stop
auto-replying, manual reply reaches the visitor, lead status updates + CSV exports. Delivered toward:
B18.1/18.2/18.5, B19.1/19.3/19.4, B15.1.

**Coordination:** a second session owns the whole **client UI** (visual identity, shell, Inbox/Settings/
Leads screens). This session owns **all of `server/` + the API + channel adapters + data**. The API
surface is documented and stable; the client is built against it. The adaptive bottom-nav/sidebar,
first-run activation, and all screens are the client session's domain.

**2026-11-13 (4) — business hours, team, billing, analytics, +2 tests.** Added agent **business hours**
(away message once, tz-aware, B19.2 — B19 now complete); **team members** + **workspace** get/rename
(B2.5/2.6 backend); **billing plans + dev subscribe** (B10 — raises the agent limit; Razorpay webhook is
the documented production swap); **analytics** endpoint (B14.2/14.3 data: agents, conversations, replies
today/total, leads by status). Test suite now **21 green** (unit + integration incl. business-hours,
billing, team). Client teammate shipped the Inbox with takeover/mute/reply, PWA, and visual identity
against this API. Server typecheck clean; no regression.

Pending (backend): Instagram/Gmail/Telegram adapter scaffolds (flagged for OAuth keys/bot token),
Razorpay webhook + signature verify (needs keys), RAG for large link knowledge (B6.3, needs Postgres),
Redis queue (B6.2, needs Redis). The core product backend (2 channels, training, control, leads,
billing-dev, analytics, auth, team) is complete and tested.

---

## B0 — Foundation & repo structure
- ⬜ **T0.1** Repo layout `client/` + `server/` + `worker/` + `apps/` + `docs/`, thin root `concurrently` orchestrator (ClassPe pattern). *AC: `npm run dev` starts all; each deploys independently.*
- ⬜ **T0.2** Server scaffold: Express + TS (tsx dev, esbuild build), `/api/*`, `asyncHandler`, helmet/cors/rate-limit, env config, health route. *AC: typecheck + health pass.*
- ⬜ **T0.3** Client scaffold: Vite + React 18 + TS strict (ESM, `moduleResolution:"bundler"`), Tailwind + shadcn/ui + `theme.json`, wouter, React Query, react-hook-form + Zod, i18next (en/hi/te), Capacitor 8. *AC: web build + PWA + native projects init.*
- ⬜ **T0.4** Shared contract: Zod schemas/types duplicated client+server (Message, Agent, Training). *AC: client self-contained.*
- ⬜ **T0.5** DB: Postgres + Prisma; schema from [DATA_MODEL.md](DATA_MODEL.md) (+ pgvector); migrations + seed. *AC: migrate + seed run.*
- ⬜ **T0.6** Port the `platform/` skeleton logic (brain, learn, training, engine, whatsapp) into `server/`. *AC: skeleton smoke test passes in `server/`; no behaviour lost.*
- ⬜ **T0.7** `CLAUDE.md` with the invisible-UI standing constraints for this app.

## B1 — Design system & invisible-UI shell
- ⬜ **T1.1** Design tokens: CSS HSL color vars + spacing/size tokens (safe-area, `tap=44px`, appbar/tabbar/gutter), rem type scale, `theme.json`, dark mode. *AC: tokens drive Tailwind.*
- ⬜ **T1.2** shadcn/ui primitive set (button, card, dialog/sheet, input, form, select, toast, switch, tabs, badge) via `cva()` + `cn()`. *AC: accessible, themed.*
- ⬜ **T1.3** Adaptive chrome (`chrome.ts` + `navigation.ts`): bottom tab bar on native, sidebar+header on desktop, data-driven, role/feature-gated. *AC: responsive; `isNative()` gate.*
- ⬜ **T1.4** App shell: AppGate, providers (Auth, QueryClient persisted to IndexedDB, i18n), ScreenTransition, offline **outbox**. *AC: cold-launch to last data; offline writes replay.*
- ⬜ **T1.5** API client layer: `ApiError{status,url,code}`, `apiRequest`, QueryClient `onError` routing (401 auth, 402 billing, 403/423 security, 409 conflict); **queries retry, mutations never**. *AC: codes route correctly.*
- ⬜ **T1.6** Invisible-UI pattern components: `PrimaryAction` (outcome-named), `Disclosure` (states default), `ResultSheet` (show-what-changed), `ZeroState` (first-action). *AC: enforce ≤3 controls before primary.*
- ⬜ **T1.7** **First-run activation**: after signup, land directly in "Add your first agent" → connect → train-from-link → live, as one guided path. *AC: new user reaches a live agent in the fewest steps; funnel instrumented.*
- ⬜ **T1.8** Accessibility pass (WCAG AA via Radix): focus order, contrast, labels, screen-reader. *AC: a11y lint + manual check.*
- ⬜ **T1.9** Feature flags (per-tenant/plan gating of agents + features). *AC: flags gate UI + API.*

## B2 — Auth & multi-tenant accounts
- ⬜ **T2.1** Signup/login: phone **OTP** + email/password, session + passport, bcrypt, secure cookie. *AC: CORS credentials; session store in DB.*
- ⬜ **T2.2** Org/tenant model, memberships, roles (owner/member), scoping (`utils/scope.ts`) + RLS. *AC: cross-tenant access blocked (test).*
- ⬜ **T2.3** Business profile (name, vertical, language) used as agent defaults. *AC: prefills training.*
- ⬜ **T2.4** Plan limits (max agents/channels/messages) enforced. *AC: over-limit → upgrade CTA (402).*
- 🔨 **T2.5** Team members: owner adds/removes members (role-gated), member scoped to the org — backend done + tested. Email-delivery invites pending (needs B12.6). *AC (scoping) met.*
- 🔨 **T2.6** Workspace (org) get + rename done + tested. Multi-business switcher (one user → several orgs, needs a membership join) still pending.

## B3 — Agent framework & catalog
- ✅ **T3.1** `ChannelAdapter` interface + registry (+ onboarding kind). *AC: registry drives channels; 2 live (WhatsApp, Website).*
- ✅ **T3.2** Agent domain (CRUD, status, settings, auto_send) — skeleton; port to server module. *AC: many agents, same or different type.*
- ⬜ **T3.3** Agent gallery (visual picker) generated from the registry. *AC: ≤3 taps to connect.*
- ⬜ **T3.4** Agent cards + live status ("Replying · 4 chats today"). *AC: AI-agentic home.*
- ✅ **T3.5** Common Message/Reply pipeline — skeleton. *AC: engine channel-agnostic.*

## B4 — Agent lifecycle & onboarding
- 🔨 **T4.1** WhatsApp QR onboarding UX: pick → name prefilled → Connect → QR → connected. *AC: ≤3 taps; show-what-changed.*
- ⬜ **T4.2** Session manager hardening: separate worker, **RemoteAuth** in DB/S3, reconnect/backoff, restore on boot. *AC: restart reconnects without re-scan.*
- ⬜ **T4.3** Per-socket realtime auth; subscribe only to own agents. *AC: can't subscribe to others' agents.*
- ⬜ **T4.4** "Add another of the same type" fast path. *AC: ≤2 taps.*
- 🔨 **T4.5** Disconnect / delete agent with effect-stating confirm. *AC: show-what-changed.*
- ⬜ **T4.6** Generic onboarding framework (OAuth / API key / embed) for future adapters. *AC: pluggable per adapter.*

## B5 — Easy training system
- ✅ **T5.1** Training model (profile + sources) — skeleton; port to Prisma.
- 🔨 **T5.2** **Train from a link** (no-typing default): fetch → extract → Claude condenses → confirmable draft → one-click keep. Built in the skeleton (`learn.ts`, `POST /training/learn`); productionize + polish. *AC: paste a website/Google/IG/FB link → agent trained in ≤2 taps.*
- 🔨 **T5.3** Conversational training UI (facts, restrictions, FAQs, links, tone/language) for optional enrichment. *AC: within effort budget.*
- 🔨 **T5.4** "What your agent knows" plain-language summary. *AC: no raw dump.*
- ✅ **T5.5** Test Console ("Ask your agent anything"). *AC: 1-tap; nothing sent.*
- ✅ **T5.6** Instant effect (read per message + cache invalidation). *AC: edit reflects next message (test).*
- ✅ **T5.7** Shareable links `{{LINK:Name}}` → exact URL. *AC: URL always exact.*
- ⬜ **T5.8** Reusable training across a business's agents + per-agent overrides. *AC: train once, reuse.*
- ⬜ **T5.9** Robust link ingestion: redirects, JS-rendered/social pages, failure messaging, multi-link accumulate. *AC: graceful on login-walled/JS pages.*
- ⬜ **T5.10** **Upload a file** (PDF/image/catalogue/price list) as a training source → extract + index. *AC: upload a menu PDF → agent answers from it.*
- ⬜ **T5.11** Training **history + undo** (every change versioned; restore). *AC: revert a bad edit.*

## B6 — Reply engine & knowledge (RAG)
- ✅ **T6.1** Engine: inbound → training → Claude (Haiku) → auto/draft → log + usage — skeleton.
- ⬜ **T6.2** Queue (Redis + BullMQ): per-conversation ordering, retries, **idempotent send**. *AC: no double-send under load.*
- ⬜ **T6.3** Link-knowledge **RAG**: chunk + embed (pgvector) + retrieve; failures non-blocking. *AC: large sites answerable.*
- ⬜ **T6.4** History/context window + prompt caching + cost controls. *AC: cache hits; Haiku default.*
- ✅ **T6.5** `NEEDS_HUMAN` escalation + per-agent approve-before-send — skeleton.
- ⬜ **T6.6** Model routing (Haiku default, escalate to Sonnet on hard). *AC: configurable per agent.*

## B7 — Conversations & inbox
- 🔨 **T7.1** Conversations list + messages view — skeleton; add realtime. *AC: live updates.*
- 🔨 **T7.2** Draft approve / skip / edit. *AC: 1-tap send.*
- ⬜ **T7.3** Unified multi-agent inbox (filter by agent/channel). *AC: one inbox, all agents.*
- ⬜ **T7.4** Contact view + notes (light CRM; deeper in B18). *AC: see history per contact.*
- ⬜ **T7.5** Search across conversations. *AC: find a chat.*
- ⬜ **T7.6** Canned / quick replies (owner presets inserted in one tap). *AC: reuse a saved reply.*

## B8 — WhatsApp channel (deepen)
- ✅ **T8.1** QR + session (skeleton); hardened in B4.
- ⬜ **T8.2** Media (images/docs), location, quick replies per capability flags. *AC: send a catalogue image.*
- ⬜ **T8.3** Official Cloud API adapter + Meta Embedded Signup (scale path). *AC: same engine behind the adapter.*
- ⬜ **T8.4** Multiple numbers per account proven stable. *AC: N sessions survive a soak test.*

## B9 — Additional channels (one bundle per adapter; priority in AGENTS.md §3)
- ✅ **T9.1** Website chat widget (embed + adapter + public API + inbox). *AC met: visitor chat → auto-reply from training, verified.*
- ⬜ **T9.2** Instagram DM (Meta OAuth). *AC: IG DM auto-reply.*
- ⬜ **T9.3** Missed-call → WhatsApp (telephony: Exotel/Knowlarity). *AC: a missed call triggers a WhatsApp reply.*
- ⬜ **T9.4** Google Business — reviews + profile Q&A. *AC: auto-answer a profile question.*
- ⬜ **T9.5** Facebook Messenger (Meta). *AC: Messenger reply.*
- ⬜ **T9.6** Telegram (bot token). *AC: bot reply.*
- ⬜ **T9.7** Gmail / Email (OAuth / IMAP-SMTP). *AC: email auto-reply.*
- ⬜ **T9.8** SMS (Twilio/Gupshup). *AC: SMS reply.*
- ⬜ **T9.9** Voice / IVR agent (later). *AC: answered-call demo in local language.*

## B10 — Billing & subscriptions (Razorpay)
- ⬜ **T10.1** Plans & pricing; per-plan limits (agents/channels/messages). *AC: limits enforced.*
- ⬜ **T10.2** Razorpay subscription checkout + webhooks; **money as integer paise**. *AC: subscribe/cancel works.*
- ⬜ **T10.3** Entitlement middleware (402 write-gate) + upgrade prompts. *AC: over-limit gated with CTA.*
- ⬜ **T10.4** Billing page, invoices, usage display. *AC: user sees plan + usage.*
- ⬜ **T10.5** Free trial / launch offer. *AC: trial → paid flow.*

## B11 — Notifications & realtime
- 🔨 **T11.1** WebSocket infra (qr/status/message/new-draft) — skeleton; harden.
- ⬜ **T11.2** Push notifications (Capacitor) for new messages/drafts. *AC: native push on new draft.*
- ⬜ **T11.3** Owner alerts (push/email/WhatsApp) for `NEEDS_HUMAN` + new lead. *AC: owner notified.*

## B12 — Infra, DevOps & deployment
- 🔨 **T12.1** `server/Dockerfile` (+ Chromium), root `docker-compose.yml` (Postgres, Redis), `.env.production.example` written — verify `docker compose up` on your infra.
- ⬜ **T12.2** Deploy: client → Vercel/Netlify (PWA); server+worker → Railway/Render/Fly; DB → Neon; Redis → Upstash. *AC: staging live.*
- ⬜ **T12.3** Mobile CI (Codemagic) for iOS/Android signed builds. *AC: build artifacts.*
- ⬜ **T12.4** Secret/config management per unit. *AC: no secrets in code.*
- ⬜ **T12.5** DB backups + restore. *AC: scheduled backup verified.*
- ⬜ **T12.6** Transactional messaging infra: OTP via SMS provider + transactional email (alerts, receipts). *AC: OTP + a receipt email deliver.*

## B13 — Security & compliance
- ⬜ **T13.1** Server-authoritative authZ on every route (codes, not prose). *AC: authZ audit passes.*
- ⬜ **T13.2** Encrypt channel credentials/sessions at rest. *AC: no plaintext tokens.*
- ⬜ **T13.3** Rate limiting + Zod validation + helmet + CORS. *AC: configured + tested.*
- ⬜ **T13.4** Channel ToS safety (WhatsApp reply-only + volume caps) + Meta/Google app-review compliance. *AC: documented + enforced.*
- ⬜ **T13.5** Data privacy: tenant isolation, data export + deletion. *AC: export/delete work.*
- ⬜ **T13.6** Security review (repo `/security-review`). *AC: no high-severity findings.*
- ⬜ **T13.7** Inbound abuse/spam protection: per-contact throttle, block list, loop detection. *AC: a flood is throttled.*
- ⬜ **T13.8** Per-tenant **spend caps** on AI + alerts. *AC: a runaway tenant is capped.*
- ⬜ **T13.9** Legal: Terms, Privacy, and WhatsApp **consent/opt-in records**. *AC: consent stored; pages live.*

## B14 — Observability & analytics
- ⬜ **T14.1** Structured logging + Sentry. *AC: errors captured with context.*
- ✅ **T14.2** Usage metrics — GET /api/analytics (agents, conversations, replies today/total, leads by status, per-agent breakdown). Tested.
- 🔨 **T14.3** Owner "what your agents did" data is served; the dashboard UI is the client session's build.
- ⬜ **T14.4** Platform-admin metrics (tenants, agents, volume). *AC: internal dashboard.*
- ⬜ **T14.5** Activation-funnel analytics (signup → first agent → first reply). *AC: funnel visible.*
- ⬜ **T14.6** Audit log of sensitive actions (connect, delete, billing, member changes). *AC: queryable log.*

## B15 — QA, testing & release
- ✅ **T15.1** Unit tests (training compose, applyLinks, trainingSummary, templates, learn helpers) — Vitest, 10 green.
- ✅ **T15.2** API integration tests (supertest): auth, agents/training CRUD, template apply, **tenant isolation**, **plan-limit 402**, leads — 6 green. (`buildApp()` factory extracted for testability.)
- ⬜ **T15.3** Automate the 8 end-to-end acceptance criteria ([IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)). *AC: green.*
- ⬜ **T15.4** **No-regression guard**: root prototype + current app verified each release. *AC: CI check blocks regressions.*
- ⬜ **T15.5** Click-budget review per flow (UX_PRINCIPLES §3). *AC: every core flow within budget.*

## B16 — Marketing & growth (tier-2)
- ⬜ **T16.1** Astro marketing site(s) (`apps/site-kit` pattern), funnel with `?agent=` param. *AC: landing live.*
- ⬜ **T16.2** Localized (Hindi/Telugu) landing + WhatsApp CTA. *AC: tier-2 friendly.*
- ⬜ **T16.3** Self-serve onboarding + referral. *AC: sign up from landing.*
- ⬜ **T16.4** App store listings (screenshots, ASO). *AC: published.*

## B17 — AI-agentic polish
- ⬜ **T17.1** Agent activity feed ("what the agent did"). *AC: visible intelligence.*
- ⬜ **T17.2** Typing/thinking indicators on drafts. *AC: feels live.*
- ⬜ **T17.3** The learning loop: "your agent couldn't answer 3 questions — add these facts?" *AC: owner improves agent in 1 tap.*
- ⬜ **T17.4** Health nudges (reconnect, thin training) — gentle, no tours. *AC: within doctrine.*

## B18 — Leads & light CRM (the sales/leads payoff)
- ⬜ **T18.1** Auto-capture a lead from a conversation (name, phone, intent, source agent). *AC: a new chat creates a lead.*
- ⬜ **T18.2** Lead fields + pipeline stages (new → qualified → won/lost); drag or one-tap move. *AC: move a lead through stages.*
- ⬜ **T18.3** Agent-assisted qualification (the agent fills intent/budget from the chat). *AC: lead pre-filled.*
- ⬜ **T18.4** Assign to a team member + notes + reminders. *AC: assignee notified.*
- ⬜ **T18.5** Export leads (CSV) + webhook to the owner's CRM. *AC: CSV + webhook fire.*
- ⬜ **T18.6** New-lead notifications (push/WhatsApp/email). *AC: owner alerted on a hot lead.*

## B19 — Conversation control & human handoff
- ⬜ **T19.1** **Live takeover**: pause the agent for one chat and reply manually; hand back. *AC: owner takes over, agent stays silent until released.*
- ⬜ **T19.2** Business hours + away/after-hours auto-message. *AC: after-hours replies differ.*
- ⬜ **T19.3** Per-agent pause/snooze (stop replying without disconnecting). *AC: toggle pauses replies.*
- ⬜ **T19.4** Per-contact mute / block. *AC: muted contact gets no auto-reply.*

## B20 — Payments & collections in chat
- ⬜ **T20.1** Send a **Razorpay payment link** inside a reply (amount + note). *AC: customer pays via the link.*
- ⬜ **T20.2** Track paid/unpaid + send a receipt. *AC: status updates on payment webhook.*
- ⬜ **T20.3** Agent can offer a payment link when the intent is "buy/book" (guarded, owner-enabled). *AC: opt-in per agent.*

## B21 — Broadcast & outbound (deferred; compliance-gated)
- ⬜ **T21.1** Opt-in audience lists + opt-out handling. *AC: opt-out honoured.*
- ⬜ **T21.2** WhatsApp **template** messages (approved) + send flow. *AC: a template sends to an opt-in list.*
- ⬜ **T21.3** Campaign metering + per-message billing + rate limits. *AC: metered + throttled.*
- ⬜ **T21.4** Compliance guardrails (no cold blasting; reply-first doctrine). *AC: enforced + documented.*

## B22 — Vertical agent templates & 1-tap setup (the "very easy" lever)
- ✅ **T22.1** Industry templates (coaching/tuition, salon/clinic, real estate, retail/D2C, gym, coworking, restaurant) — 7 live; one-tap apply pre-fills the persona. *AC met (verified).*
- 🔨 **T22.2** "Quick setup by business type" is in the training panel (one tap); a dedicated onboarding step is pending. *AC: new agent useful before typing.*
- ⬜ **T22.3** Template marketplace/registry (add templates without code). *AC: a new template is data, not a deploy.*

---

### Not missing — cross-cutting checklist (final guard)
Auth + OTP ✓ · team invites + workspace switch ✓ · multi-tenant isolation ✓ · **many agents, same or
different type** ✓ · agent extensibility/adapters ✓ · **train-from-link + file upload + vertical
templates** (very easy) ✓ · training instant-effect + history ✓ · RAG ✓ · reply engine + queue +
idempotency ✓ · inbox + canned replies ✓ · **leads/CRM + export** ✓ · **human handoff + hours + pause**
✓ · **payments in chat** ✓ · WhatsApp + 8 more channels ✓ · **broadcast (deferred)** ✓ · billing ✓ ·
realtime + push ✓ · infra/CI/mobile builds + transactional OTP/email ✓ · security + **spam + spend caps
+ legal/consent** ✓ · observability + **activation funnel + audit log** ✓ · tests + no-regression ✓ ·
marketing/growth ✓ · invisible-UI + AI-agentic polish ✓ · a11y + i18n (en/hi/te) + offline ✓.
