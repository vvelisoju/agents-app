# Current-State Architecture Assessment

> **Status:** Review draft · **Date:** 2026-11-14 · **Scope:** the whole repository as it exists today.
> **Method:** read-only inspection of every subsystem (6 parallel subsystem readers + a completeness
> critic + first-hand reads of the core runtime). Every claim below is anchored to a real file/line.
> This document describes **what is**, not what should be — the gap analysis, target architecture and
> roadmap live in the sibling docs. **No code was changed to produce this.**

---

## 0. TL;DR

This repository is a **well-built, single-purpose WhatsApp (and Telegram/website) auto-reply SaaS**
for tier-2 Indian SMBs. Its strongest asset for a future agentic platform is a genuinely
**channel-agnostic reply engine behind a self-registering channel-adapter registry**. Its core loop is
**one LLM completion per inbound message** — there is **no planner, tool-calling loop, workflow engine,
job queue, vector/RAG, multi-agent coordination, MCP, A2A, policy engine or observability stack** in the
code today. The product works end-to-end; the "agentic platform" layer described in the master prompt is
almost entirely greenfield, to be **layered on top of** the existing seams rather than replacing them.

A second theme runs through the repo: **three generations of the same product coexist** (`agents/`
prototype → `platform/` skeleton → `server/`+`client/` live SaaS) and have **already drifted**, and the
**docs describe several capabilities (Postgres RLS, pgvector/RAG, RemoteAuth, a separate worker + Redis
queue) that the code does not implement**. Resolving that drift is a precondition for building cleanly.

---

## 1. Existing project architecture summary

### 1.1 The three layers (this is the first thing to understand)

The repo stacks three generations of the same product. Only the third is the live product.

| Layer | Path | What it is | Status | Key entry |
|---|---|---|---|---|
| **Prototype** | [`agents/`](../../agents/) | Original single-tenant **CLI** WhatsApp bot; one hardcoded *Secure Studio Warangal* persona; terminal approve/edit/skip | **Legacy / reference** (still runnable via root `npm run whatsapp`) | [agents/whatsapp-reply/index.js](../../agents/whatsapp-reply/index.js) |
| **Skeleton** | [`platform/`](../../platform/) | Intermediate **single-file** multi-tenant TS server; email+scrypt auth; hand-rolled `better-sqlite3`; own WS hub/engine/brain/learn | **Legacy / "working reference"** (per [DEV.md](../../docs/DEV.md); recently run — has a live `data.sqlite` + `.wwebjs_auth`) | [platform/src/index.ts](../../platform/src/index.ts) |
| **Live SaaS** | [`server/`](../../server/) + [`client/`](../../client/) | Express + Prisma API + React/Vite client; channel-adapter registry; phone+OTP auth; 3 channels; leads/billing/analytics | **ACTIVE — this is the product** | [server/src/index.ts](../../server/src/index.ts) |

> The same core (`askClaude`, `worthReplying`/`ACKS`, `composeSystemPrompt`/`applyLinks`, the learn
> pipeline, the whatsapp-web.js session manager) is **copy-pasted across all three layers and has already
> diverged** — e.g. `askClaude` defaults to `claude-opus-5-5` in [shared/claude.js](../../shared/claude.js)
> but `claude-haiku-5-5` in [server/src/lib/brain.ts](../../server/src/lib/brain.ts); auth is email+scrypt
> in `platform/` vs phone+OTP+bcrypt in `server/`. **There is no shared package** consumed by both.

### 1.2 The live system (server/ + client/)

```
┌──────────────────────────────┐        ┌───────────────────────────────────────────────┐
│  client/ (React + Vite SPA)  │  REST  │  server/ (single Node process, tsx src/index) │
│  wouter · react-query · PWA  │ ─────► │  Express app  ──►  REST /api/* + /ws (WebSocket)│
│  Vercel                      │  /ws   │                                                │
│  bearer token in localStorage│ ◄────► │  ┌─ reply engine (processInbound) ──────────┐ │
└──────────────────────────────┘        │  │  load training → ONE Claude Haiku call →  │ │
                                         │  │  auto-send or draft                       │ │
                                         │  └───────────────────────────────────────────┘ │
                                         │  ┌─ channel-adapter registry ────────────────┐ │
                                         │  │  whatsapp-web.js (1 Chromium/agent, in-proc)│ │
                                         │  │  telegram (long-poll) · website (widget poll)│ │
                                         │  └───────────────────────────────────────────┘ │
                                         │  Prisma ──► SQLite (dev) / Postgres (prod)     │
                                         │  Railway · 1 container · numReplicas=1         │
                                         └───────────────────────────────────────────────┘
```

Key architectural facts (all verified in code):

- **One Node process does everything.** [server/src/index.ts](../../server/src/index.ts) builds the Express
  app, wraps it in one HTTP server, attaches the WebSocket hub, **and runs the WhatsApp session worker
  in-process** (`wa.restoreSessions(...)` at boot). The separate `/worker` + Redis queue in
  [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) / [docs/IMPLEMENTATION_PLAN.md](../../docs/IMPLEMENTATION_PLAN.md)
  is **not built**.
- **The reply loop is a single LLM turn.** [engine.ts `processInbound`](../../server/src/engine/engine.ts)
  loads the agent's current training, composes **one** system prompt, makes **exactly one**
  `askClaude` call ([brain.ts](../../server/src/lib/brain.ts)), then either auto-sends via the channel
  adapter or stores a draft. No loop, no tools, no retrieval.
- **Inbound processing is synchronous and inline** inside each channel's receive callback
  ([whatsapp.ts message handler](../../server/src/channels/whatsapp.ts), telegram long-poll,
  [public widget POST](../../server/src/modules/public/router.ts)). A slow Claude call blocks the
  callback; a crash loses in-flight messages. **There is no queue.**

---

## 2. Current technology stack

### Backend ([server/](../../server/))
| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node 20, **TypeScript run directly via `tsx`** | No build step; `tsx src/index.ts` |
| HTTP | **Express** | `helmet`, `cors`, `express-rate-limit`, `express.json({limit:'1mb'})` ([app.ts](../../server/src/app.ts)) |
| ORM / DB | **Prisma 5.22** · **SQLite (dev) / Postgres (prod)** | Provider `sed`-swapped at image build ([server/Dockerfile]); **`prisma db push` on every boot — no migrations** |
| Realtime | **`ws`** WebSocket at `/ws` | In-memory per-agent fan-out; **no per-socket auth** ([realtime.ts](../../server/src/lib/realtime.ts)) |
| LLM | **`@anthropic-ai/sdk`**, Claude **Haiku** | Hardcoded provider; `model:'claude-haiku-5-5'`, `effort:'low'`, `max_tokens:1024` ([brain.ts](../../server/src/lib/brain.ts)) |
| WhatsApp | **`whatsapp-web.js`** (unofficial) + puppeteer/system Chromium | One `Client` per agent in an in-process `Map`; `LocalAuth` to `WWEBJS_DATA_PATH` |
| WhatsApp (official) | **Meta Graph Cloud API** | Wired **only** for OTP ([whatsappCloud.ts](../../server/src/lib/whatsappCloud.ts) ← [otp.ts](../../server/src/lib/otp.ts)) |
| Auth | `bcryptjs` + **opaque random bearer token** on `User.token` | **Not JWT, not sessions**; phone-OTP signup/reset ([auth.ts](../../server/src/middleware/auth.ts)) |
| Validation | **`zod`** (partial) | On ~half the routes; others use inline `typeof` checks |
| Billing | **Razorpay** (raw REST, HMAC verify) | Real checkout/verify; **webhook defined but unwired** |
| Tests | **Vitest + supertest** (~40 cases) | Helpers + REST surface; **`askClaude` is never mocked → the AI reply path is untested** |
| Deploy | **Railway** (1 Docker container, `numReplicas:1`, `/api/health`) | `docker-compose.yml` also present (declares a Redis the code never uses) |

> **Dependency pinning risk:** most server deps are `"latest"` (`@anthropic-ai/sdk`, `express`, `ws`,
> `zod`, `helmet`, `bcryptjs`, `whatsapp-web.js`) — builds are non-deterministic; only `@prisma/client`,
> `prisma`, `vitest`, `supertest` are pinned.

### Frontend ([client/](../../client/))
React 18 · Vite 5 · TypeScript · **wouter** (routing) · **@tanstack/react-query** (data) · Tailwind ·
lucide-react · **vite-plugin-pwa** (Capacitor-ready). Bearer token in `localStorage` (`sa_token`),
401 → global `auth:logout` event ([api.ts](../../client/src/lib/api.ts)). WebSocket hook invalidates
react-query caches on `status`/`message`/`alert` ([ws.ts](../../client/src/lib/ws.ts)). Deployed to
**Vercel** with SPA rewrite.

---

## 3. Existing features and reusable components

### 3.1 What the live product does today (implemented & working)
- **Signup/login/reset by phone + WhatsApp OTP** (6-digit, bcrypt-hashed, 10-min TTL, 5 attempts,
  3/hr/phone) — [auth router](../../server/src/modules/auth/router.ts), [otp.ts](../../server/src/lib/otp.ts).
- **Agent CRUD + many agents per org**, `maxAgents` plan gate (the only enforced plan limit)
  — [agents router](../../server/src/modules/agents/router.ts).
- **WhatsApp QR onboarding** with live status (`pending_qr → connecting → connected → disconnected`),
  pushed to the browser over WebSocket; sessions restored on boot — [whatsapp.ts](../../server/src/channels/whatsapp.ts).
- **Uniform training** — instructions, restrictions, facts, FAQs, shareable links, tone, language, plus
  **"train from a link"** (fetch → regex-extract → one Claude pass → confirmable draft) and **7 vertical
  persona templates** — [training.ts](../../server/src/lib/training.ts), [learn.ts](../../server/src/lib/learn.ts), [templates.ts](../../server/src/lib/templates.ts).
- **Reply engine** with auto-send **or** approve-before-send drafts; **business-hours away message**
  (once per away period); **`NEEDS_HUMAN` escalation**; **owner urgent-lead alerts** via a model-emitted
  `[[ALERT]]` control token (deduped, 6-h cooldown); **exact-URL link substitution** (`{{LINK:Name}}`).
- **Conversations / lead inbox** — list, messages, takeover/mute, approve/skip/reply drafts, lead
  status/notes, CSV export — [leads router](../../server/src/modules/leads/router.ts), [ChatsPanel].
- **Team seats** (owner/member), **analytics** (counts, replies today, leads by status), **Razorpay
  subscription** checkout/verify.
- **Website chat widget** — an embeddable [server/public/widget.js] that **polls** every 4 s for replies
  (hence the `website` adapter's `send()` is a deliberate no-op) — [website.ts](../../server/src/channels/website.ts).
- **Agent-first "invisible UI"** client: guided zero-training setup, per-agent console with Train/Test/
  Chats tabs — [AgentDetail.tsx](../../client/src/pages/AgentDetail.tsx), [SetupGuide].

### 3.2 The reusable assets for an agentic platform (keep these)
| Asset | File | Why it matters |
|---|---|---|
| **Channel-adapter registry + normalized `InboundMessage`** | [channels/types.ts](../../server/src/channels/types.ts), [registry.ts](../../server/src/channels/registry.ts) | A genuinely channel-agnostic seam — a new channel is one `register()` call; the single most valuable generalization point |
| **Single LLM chokepoint** | [brain.ts](../../server/src/lib/brain.ts) | One place to evolve into a provider-abstracted client (tools, streaming, token accounting) without touching callers |
| **Pure prompt functions** | [training.ts](../../server/src/lib/training.ts) | `composeSystemPrompt`/`extractAlert`/`applyLinks` are side-effect-free and testable — the base for a richer context assembler |
| **`[[ALERT]]` control-token idiom** | [training.ts](../../server/src/lib/training.ts), [engine.ts](../../server/src/engine/engine.ts) | A pragmatic out-of-band model-signal pattern that generalizes to structured directives |
| **Web-ingestion utility** | [learn.ts](../../server/src/lib/learn.ts) | `fetchHtml`/`extractReadable` (timeouts, entity decoding, friendly errors) — the base an eventual RAG pipeline sits on |
| **Official Cloud API sender** | [whatsappCloud.ts](../../server/src/lib/whatsappCloud.ts) | Already the compliant transport; today wired only to OTP — a ready seam for compliant outbound |
| **Multi-tenant Prisma spine** | [schema.prisma](../../server/prisma/schema.prisma) | Org-as-tenant-root + cascade deletes; clean to extend |
| **`validate()` / `asyncHandler` / `requireAgent` middleware, OTP, phone, Razorpay helpers** | [middleware/](../../server/src/middleware/), [lib/](../../server/src/lib/) | Well-factored, unit-tested, carry forward verbatim |
| **The docs themselves** | [docs/AGENTS.md](../../docs/AGENTS.md), [BACKLOG.md](../../docs/BACKLOG.md), the two integration plans | An internally-consistent roadmap the owner already wrote — build on it, don't re-derive |

---

## 4. Data model (as actually implemented)

11 Prisma models in [schema.prisma](../../server/prisma/schema.prisma): `Org`, `User`,
`PhoneVerification`, `Subscription`, `Agent`, `ChannelSession`, `TrainingProfile`, `TrainingSource`,
`Conversation`, `Message`, `UsageEvent`.

- **Tenant root** = `Org`; cascade deletes down to `Message`. The `agentId_contactNumber` unique key on
  `Conversation` is the per-contact upsert spine.
- **Tenant isolation is 100% application-level** — `orgId` WHERE-filters + the `requireAgent` middleware
  check (`agent.orgId === user.orgId`). **No Postgres row-level security exists** (despite
  [DATA_MODEL.md](../../docs/DATA_MODEL.md) claiming it).
- **`orgId` is denormalized** onto `Conversation` and `UsageEvent` for fast aggregation, **but
  `ChannelSession`/`TrainingProfile`/`TrainingSource`/`Message` carry no `orgId`** — their isolation is
  only transitive via `agentId`, so any direct `findUnique({where:{id}})` that skips `requireAgent` can
  leak cross-tenant.
- **Polymorphic data as JSON-in-String**: `Agent.channelConfig` (e.g. Telegram `botToken` — **plaintext**)
  and `TrainingSource.dataJson`. Some reads lack `try/catch` ([engine.ts](../../server/src/engine/engine.ts),
  agents router) — one malformed row can throw.
- **Indexing**: the only explicit index is `PhoneVerification(phone,purpose)`. `Message` (highest-growth
  table) has **no index and no `orgId`**.
- **No migrations** — schema is applied with **`prisma db push --accept-data-loss` on every container
  boot**; per workspace memory `DATABASE_URL` points at the **live Railway Postgres**, so a bad schema
  edit can silently drop prod columns with no history or rollback.

**Absent tables** (confirmed): vector/embeddings (`training_chunks`), agent-version/spec, workflow/run/
execution state, events/triggers, tool/integration registry, audit log, secrets/credentials store,
general agent-memory. [DATA_MODEL.md](../../docs/DATA_MODEL.md) and [TRAINING.md](../../docs/TRAINING.md)
describe pgvector/RAG + encrypted `auth_blob` + token metering that **do not exist in the schema**.

---

## 5. API surface, auth & security posture

- **~30 REST routes** under `/api` ([routes.ts](../../server/src/routes.ts)) across modules: `auth`,
  `agents` (CRUD + connect/disconnect + training + test console + conversations + approve/skip/reply),
  `leads`, `team`, `billing`, `analytics`, `public` (widget) — plus a WebSocket hub at `/ws`.
- **Auth** = `bcrypt(10)` + a random 24-byte hex **bearer token stored plaintext in `User.token`**,
  looked up on every request. **Not JWT, not sessions.** Tokens never expire and aren't rotated on login
  (only on reset).
- **RBAC** = a flat `owner`/`member` flag enforced at **only 5 sites** (team ×2, billing ×3). Every other
  authenticated route (delete agent, edit training, export all org leads, `PATCH /api/org`) is open to
  **any** org member.
- **Validation**: `zod` on auth + `createAgent` + a few others; several mutating routes
  (`PUT /training/profile`, `POST /billing/verify`, `PATCH /api/org`, …) use loose inline checks or none.
- **Rate limiting**: global IP 600/min + auth 20/min, **in-memory per-process** (won't hold across
  restarts/replicas). **No per-tenant or per-agent rate/cost limit.**

### Security findings (ranked)
| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **High** | **Unauthenticated WebSocket**: any client can `{subscribe:<any agentId>}` and receive that agent's **QR code** (→ WhatsApp account/session takeover) and **all inbound/outbound messages** (cross-tenant leak) | [realtime.ts](../../server/src/lib/realtime.ts) (self-flagged "B4.3") |
| 2 | **High** | **Unauthenticated public widget** keyed only by `agentId` (no secret, no per-agent rate cap): anyone with a widget UUID can drive unbounded Claude spend + owner-alert spam | [public router](../../server/src/modules/public/router.ts) |
| 3 | **High** | **SSRF**: `POST /agents/:id/training/learn` server-fetches an arbitrary user URL with `redirect:follow` and **no host/private-IP/metadata allowlist** | [learn.ts](../../server/src/lib/learn.ts) |
| 4 | **Med** | **Billing not server-authoritative**: `verifyWebhookSignature` is written but **never wired** — a paid checkout whose browser never calls `/verify` leaves the org un-upgraded; and `/subscribe` free-upgrades any plan when `NODE_ENV!=='production'` **or** Razorpay is unconfigured | [razorpay.ts](../../server/src/lib/razorpay.ts), [billing router](../../server/src/modules/billing/router.ts) |
| 5 | **Med** | **Plaintext secrets in DB**: Telegram `botToken` in `channelConfig`; bearer tokens in `User.token`. No secrets manager, no encryption-at-rest | [schema.prisma](../../server/prisma/schema.prisma) |
| 6 | **Med** | **Coarse RBAC + no per-tenant quotas**; **CORS reflects any origin** when `CORS_ORIGIN` unset | [app.ts](../../server/src/app.ts) |

---

## 6. Realtime, deployment & operations

- **Realtime** = in-memory `Map<agentId, Set<WebSocket>>` fan-out of `qr`/`status`/`message`/`alert`
  to subscribed browsers. It is a **UI fan-out, not a durable domain event bus**; no per-socket auth.
- **Process model** = **single process, single replica** (`numReplicas:1`). The in-memory `clients` and
  `subs` maps mean **horizontal scaling is impossible without change** — events on one instance never
  reach sockets on another.
- **WhatsApp session persistence** = `LocalAuth` on a **filesystem volume** (`WWEBJS_DATA_PATH`). The
  docs' **RemoteAuth (DB/S3) is not implemented**; on an ephemeral host without a mounted volume, every
  deploy wipes sessions and forces a QR re-scan.
- **Resource ceiling**: one headless Chromium per connected agent (~200–400 MB each) in the API process
  → a documented ~25–50 agents/box ceiling, and a puppeteer OOM/crash takes down the API too.
- **Observability** = `console.*` only. **No OpenTelemetry, no metrics, no structured logging**; the sole
  health route is a static `/api/health → {ok:true}` with no DB/session readiness check.
- **Schema sync** = `prisma db push --accept-data-loss` on every boot (destructive against prod).

---

## 7. What is NOT in the codebase (confirmed absent, repo-wide)

These are the building blocks the master prompt's "agentic platform" needs. **None exist today** — each
verified by reading + grep across `server/`, `platform/`, `client/`:

| Capability | State | Note |
|---|---|---|
| Planner / multi-step reasoning / agent loop | **Absent** | Exactly one `askClaude` per reply; no loop |
| Tool registry / function-calling / dynamic tools | **Absent** | No `tools:` array sent to the model; "links"/"alerts" are faked via text tokens the engine post-processes |
| Workflow / durable execution / job queue / run-state | **Absent** | No BullMQ/Redis/Temporal; inbound is synchronous in-process; `docker-compose` declares a Redis no code uses |
| MCP (Model Context Protocol) | **Absent** | No `@modelcontextprotocol/sdk` anywhere (the `mcp__*` tools in *this* session are the harness's, not the repo's) |
| Agent-to-agent (A2A) | **Absent** | `processInbound` acts on one `agentId`; the only cross-party effect is a plain WhatsApp text to the owner |
| Event bus / message broker | **Absent** | Only the in-memory UI WebSocket hub |
| Vector / embeddings / RAG / chunking | **Absent** | Full training set is stuffed into the prompt every call |
| Policy / authorization engine | **Absent** | Inline per-route `orgId` + `role` checks only |
| Observability (OTel / metrics / tracing / structured logs) | **Absent** | `console.*` only |
| Agent spec + versioning; schema migrations | **Absent** | `Agent` has no version field; no `prisma/migrations/`; no draft/published history |
| CI; JWT/OAuth2/OIDC; secrets manager; idempotency keys; per-tenant rate/cost limits; streaming | **Absent** | — |

---

## 8. Documentation state (and drift)

A large, coherent `docs/` set already encodes the owner's generalization intent — **the architecture
work should build on it, not re-derive it**:

- [AGENTS.md](../../docs/AGENTS.md) — the channel-adapter doctrine, the 11-channel tier-2 catalog, agent
  *roles*, uniform training. **The server partially implements this already.**
- [IMPLEMENTATION_PLAN.md](../../docs/IMPLEMENTATION_PLAN.md) — 4 phases + 8 end-to-end acceptance
  criteria + a risk review. [BACKLOG.md](../../docs/BACKLOG.md) — B0–B22 bundles + a dated build log.
- [BROADCAST_INTEGRATION_PLAN.md](../../docs/BROADCAST_INTEGRATION_PLAN.md) (compliant Cloud-API outbound)
  and [TRACKLY_INTEGRATION_PLAN.md](../../docs/TRACKLY_INTEGRATION_PLAN.md) (accepted-risk QR drip) — both
  additive, both routing replies back through `processInbound`.
- [UX_PRINCIPLES.md](../../docs/UX_PRINCIPLES.md) — the "invisible UI" acceptance bar.

**Drift to fix** (docs promise what code lacks): [DATA_MODEL.md](../../docs/DATA_MODEL.md) (Postgres RLS,
pgvector `training_chunks`, encrypted `auth_blob`, token metering), [TRAINING.md](../../docs/TRAINING.md)
(RAG/link-status pipeline), [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) (separate worker + Redis queue +
RemoteAuth), and [BACKLOG.md](../../docs/BACKLOG.md) `✅` markers that point at `platform/` for work now
living in `server/`. The root [README.md](../../README.md) still documents **only** the `agents/` CLI
prototype.

---

## 9. Test coverage

~40 Vitest cases ([unit.test.ts](../../server/tests/unit.test.ts), [api.test.ts](../../server/tests/api.test.ts)):
pure helpers (prompt composition, `extractAlert`, phone, Razorpay HMAC, `normalizeUpdate`, learn helpers)
and the REST surface (OTP signup, agent CRUD, **tenant-isolation 404**, **plan-limit 402**, leads, team
roles, business-hours away/ignored). **Gap:** `askClaude` is never mocked, so the **money/safety path —
auto-send, `NEEDS_HUMAN`, the `[[ALERT]]` owner ping, link substitution before send — has no unit test**.
No channel-adapter/session tests, no WebSocket tests, no CI (`.github/` absent), no end-to-end acceptance
suite.

---

## 10. Implemented / Partial / Absent — one-glance index

**Implemented & working:** phone-OTP auth · multi-tenant org/agent CRUD · WhatsApp QR onboarding + status ·
uniform training + train-from-link + templates · single-turn reply engine (auto/draft) · business hours ·
escalation · owner `[[ALERT]]` alerts · exact-link substitution · lead inbox + CSV · team seats · analytics ·
Razorpay checkout/verify · website widget (polling) · Telegram (long-poll) · agent-first PWA client.

**Partial:** channel-adapter interface is thinner than [AGENTS.md](../../docs/AGENTS.md) (no `capabilities[]`,
`onboard()`, `onInbound(cb)`) · `buildPrompt` still hardcodes "WhatsApp" for all channels · train-from-link
is one-shot (no background fetch job / link status / RAG) · Razorpay has no webhook/reconciliation · plan
limits enforce only `maxAgents` · owner alerts are WhatsApp-session-dependent (don't generalize to
website/telegram-only agents) · Postgres path exists only as a build-time `sed`.

**Absent:** everything in §7 (planner, tools, workflow/queue, MCP, A2A, event bus, RAG, policy engine,
observability, agent spec/versioning, migrations, OAuth2/OIDC, secrets manager, idempotency, per-tenant
quotas), plus RLS, RemoteAuth, a separate worker, horizontal scaling, and AI-path tests.

---

## 11. Items that need owner clarification

1. **Three-layer consolidation** — can `agents/` and `platform/` be archived (e.g. moved to a `legacy/`
   folder or a tag) so there is one source of truth? The duplication is the top maintenance risk.
2. **WhatsApp transport intent** — is unofficial `whatsapp-web.js` the long-term reply transport, or the
   bridge to the official Cloud API? This decides how much to invest in session-sharding vs. webhooks.
3. **Target scale** — expected orgs / agents / messages-per-day in 6–12 months? This decides whether a
   durable queue/worker and horizontal scaling are near-term or later.
4. **Agentic breadth** — which master-prompt scenarios are real near-term goals (WhatsApp business agent,
   lead outreach) vs. aspirational (flight monitoring, multi-agent delegation, LinkedIn)? This sets how
   much of the platform to build now vs. defer.

---

*Companion documents:* [`gap-analysis.md`](gap-analysis.md) · [`target-architecture.md`](target-architecture.md) · [`implementation-roadmap.md`](implementation-roadmap.md).
