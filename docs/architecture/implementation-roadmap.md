# Implementation Roadmap — dependency-ordered, additive, reversible

> **Status:** Review draft (not finalized) · **Date:** 2026-11-14 · **Reads with:**
> [current-state.md](current-state.md), [gap-analysis.md](gap-analysis.md),
> [target-architecture.md](target-architecture.md). **This is a plan. No code has been changed.**
>
> **Decisions locked (2026-11-14), which override any option below:** **`whatsapp-web.js` (QR) is the only
> agent transport** — the Cloud API / BROADCAST path is **dropped**, so in **Phase 5** the `whatsapp-cloud`
> adapter, the Meta inbound webhook (`POST /api/webhooks/whatsapp`) and the `/api/v1` partner API are **out of
> scope**; outbound = the **Trackly-style QR drip** only, and the Phase 5 webhook router is **Razorpay-only**.
> **Flight monitoring and LinkedIn DM are dropped** (not in scope anywhere). `agents/` + `platform/` are
> consolidated into `legacy/` in Phase 0. The decision-aligned, task-level execution plan is
> **[backlog.md](backlog.md)** (479 tasks); it supersedes this document wherever they differ.

This answers master-prompt deliverable **#19**. The order is driven by **one unlock and one imperative**:

- **Unlock — migration safety.** The live prod schema is applied with `prisma db push --accept-data-loss`
  on every boot, so **no new table/column is safe until real migrations exist** → foundational Phase 1,
  which gates Phases 2–6.
- **Imperative — live holes.** Several holes are exploitable on the deployed instance *now*, so **Phase 0**
  fixes them (plus the double-reply bug, build pinning, and the three-layer/doc drift), deliberately scoped
  to **zero schema changes** so it ships *in parallel* with the migration work.

Each phase lists **Objective · Reuse · New · DB · APIs · Tests · Risks · Acceptance**. Everything is
additive around the working reply loop, the channel-adapter seam, the training model, and the
alert/escalation/approval features. `WORKFLOW_ENABLED` / `executionMode='reply'` defaults keep behavior
**byte-for-byte today's** until a feature is explicitly turned on.

Phase effort labels are **relative T-shirt sizes**, not calendar commitments.

---

## Phase 0 — Live-hole patch, correctness quick wins & drift cleanup · **P0 · depends on: nothing · ships immediately**

**Objective.** Close exploitable holes, stop the double-reply regression, make builds deterministic, and
collapse the three-layer/doc drift — with **zero new tables**, so it does not wait on migrations.

- **Reuse:** [realtime.ts](../../server/src/lib/realtime.ts), [public router](../../server/src/modules/public/router.ts),
  [learn.ts](../../server/src/lib/learn.ts), [razorpay.ts](../../server/src/lib/razorpay.ts) (`verifyWebhookSignature`,
  already written), [engine.ts](../../server/src/engine/engine.ts), the prototype's lock pattern in
  [agents/whatsapp-reply/index.js](../../agents/whatsapp-reply/index.js).
- **New:** per-socket WS auth (token on connect + verify org owns the subscribed `agentId`); widget per-agent
  signed key + per-agent rate cap; `lib/ssrfGuard.ts` (reject loopback/private/link-local/`169.254` incl. on
  redirects); AES-256-GCM encrypt Telegram `botToken` in place + store bearer token as a hash; non-reflecting
  CORS in prod; wire the Razorpay webhook + block `/subscribe` free-upgrade in prod; **per-conversation async
  lock** (`Map<convKey,Promise>` chain) wrapping `processInbound`; capture `res.usage` token counts at
  `brain.ts` (currently discarded); pin every server dep + commit a lockfile; delete the unused
  `docker-compose` Redis; **archive `agents/` + `platform/` to `legacy/`**; reconcile the drifted docs
  ([DATA_MODEL.md](../../docs/DATA_MODEL.md), [TRAINING.md](../../docs/TRAINING.md),
  [ARCHITECTURE.md](../../docs/ARCHITECTURE.md), [README.md](../../README.md)) to describe what **exists**.
- **DB:** none (encryption/hash are in-place value changes).
- **APIs:** `/ws` now requires a token; widget gains a key; `POST /api/webhooks/razorpay`.
- **Tests:** **mock-`askClaude` regression tests for the money/safety path** (auto-send, `NEEDS_HUMAN`,
  `[[ALERT]]`, `{{LINK}}` substitution) — the currently-untested path, landed **before** any runtime refactor;
  a concurrent-message test proving one reply; a `/ws` cross-tenant rejection test.
- **Risks:** WS-auth + token-hash are **client-breaking** → ship the matching client change in the same
  release with a grace window.
- **Acceptance:** anonymous `/ws` cannot subscribe to another org's agent (no QR/message leak); the widget is
  key-gated + rate-capped; `learn.ts` refuses private/metadata IPs; no plaintext secret at rest; two messages
  from one contact within <1 s produce exactly one reply across WhatsApp **and** Telegram; two clean installs
  are byte-identical; one source of truth remains; the money/safety path has tests.

---

## Phase 1 — Migration discipline & tenant-data hardening · **P0 · depends on: nothing (parallel with Phase 0)**

**Objective.** Replace destructive boot-time schema sync with a baselined migration history, then backfill
`orgId` + indexes so every later table is safe and tenant isolation is direct, not transitive via `agentId`.

- **Reuse:** [schema.prisma](../../server/prisma/schema.prisma), `server/docker-entrypoint.sh`, `server/package.json`.
- **New:** `server/prisma/migrations/` with a **one-time baseline diffed against a shadow of the live prod
  DB**; switch the entrypoint to `prisma migrate deploy`; a CI guard forbidding `--accept-data-loss` on the
  prod path.
- **DB:** backfill `orgId` (+ index) onto `ChannelSession`, `TrainingProfile`, `TrainingSource`, `Message`
  (batch the `Message` backfill — highest-growth); add `Message(conversationId, createdAt)` and
  `UsageEvent(orgId, createdAt)` indexes.
- **APIs:** none.
- **Tests:** a direct `findUnique`-by-id on another org's `TrainingSource`/`Message` returns nothing; the
  baseline migration diffs cleanly against the shadow DB.
- **Risks:** the baseline touches **live prod** (schema was only ever `db`-pushed) — do it against a shadow
  and review the diff, or the first migration can drop columns; the `Message` backfill needs batching + an
  index to avoid a long lock.
- **Acceptance:** deploys apply schema via `prisma migrate deploy`; `db push --accept-data-loss` never runs
  against prod (verified by entrypoint + CI); every tenant table carries `orgId`.

---

## Phase 2 — Runtime gateway, observability & per-tenant cost control · **P0 · depends on: Phase 1**

**Objective.** Evolve `brain.ts` into a provider-abstracted **model gateway** (timeout, bounded retry,
token/cost accounting) kept as the single chokepoint; thread an `executionId` trace onto an extended
`UsageEvent`; add pino logs + a real readiness check; enforce a per-tenant budget.

- **Reuse:** [brain.ts](../../server/src/lib/brain.ts), [engine.ts](../../server/src/engine/engine.ts)
  (`ProcessResult.status` is already the `outcome` enum; `alertOwner`'s fire-and-forget try/catch is the
  model for the trace write), [analytics router](../../server/src/modules/analytics/router.ts),
  [plans.ts](../../server/src/lib/plans.ts).
- **New:** `lib/model-gateway.ts` (`callModel({provider,model,system,messages,maxTokens,effort,tools?})` →
  `{text, toolCalls?, usage, stopReason}`); `askClaude` becomes a thin wrapper (plus `askClaudeText()` for
  `learn.ts`/`draftFor`); `engine/loader.ts` (`loadAgentRuntime`); `engine/runtime.ts` facade (dispatch on
  `executionMode`, default `'reply'`); `lib/trace.ts` (pino + `startExecution`/`finishExecution`, redaction);
  `lib/pricing.ts` (per-model price map, indicative); `lib/budget.ts` (`canSpend(orgId)` pre-call gate).
- **DB:** extend `UsageEvent` additively (nullable): `executionId`, `agentVersion`, `model`, `provider`,
  `inputTokens`, `outputTokens`, `costMicros`, `latencyMs`, `outcome`, `trigger`, `conversationId`,
  `errorCode`, `approvalState`; add `Agent.executionMode @default("reply")`.
- **APIs:** `GET /api/analytics/executions`, `/executions/:id`, `/metrics` (owner-only); `GET /api/health/ready`.
- **Tests:** `reply` mode is byte-identical for the same input; one execution row per `processInbound` across
  **all** outcomes; budget gate blocks past a cap with a safe fallback; no secret/PII in logs or rows.
- **Risks:** the refactor touches the money path (Phase 0 tests are the guard); one extra DB write on the hot
  path (keep it fire-and-forget); price map drifts (store exact token counts, re-priceable).
- **Acceptance:** switching provider/model is a config change with zero caller edits; a reply traces
  end-to-end from its row; metrics (success rate, intervention rate, cost/exec, latency p50/p95) are SQL
  aggregations; the budget gate demonstrably bounds the widget-spend path.

---

## Phase 3 — Policy chokepoint, identity hardening & generalized approvals · **P0 · depends on: Phase 0, 1**

**Objective.** Add one default-deny `authorize()` chokepoint + central RBAC; harden tokens; add an
append-only `AuditLog`; move channel secrets into an encrypted `ConnectedAccount`; generalize
approve-before-send into an `Approval` queue.

- **Reuse:** [auth.ts](../../server/src/middleware/auth.ts) (`requireAgent`), the 5 inline role checks in
  [team](../../server/src/modules/team/router.ts) + [billing](../../server/src/modules/billing/router.ts)
  routers, `Message.status='draft'` + `/approve`/`/skip` ([agents router](../../server/src/modules/agents/router.ts)),
  `extractAlert`/`alertOwner`, [validate.ts](../../server/src/middleware/validate.ts).
- **New:** `middleware/authz.ts` (`requireRole`/`requirePermission` over a resource/action table, default-deny)
  covering the currently-ungated routes (delete agent, edit training, org rename, lead CSV export);
  `policy/engine.ts` (`authorize(ctx,action)`); `policy/approvals.ts`; `lib/audit.ts`; `lib/crypto.ts`
  (AES-256-GCM); `lib/secrets.ts`; token hash + `tokenExpiresAt` + rotate-on-login + `POST /auth/logout`.
- **DB:** `Approval`, `AuditLog` (append-only), `ConnectedAccount`/`Credential`; `User.token` → `tokenHash`
  + `tokenExpiresAt` (+ optional `Session`, `lastLoginAt`); migrate Telegram `botToken` out of `channelConfig`.
- **APIs:** `GET /api/approvals`, `POST /api/approvals/:id/approve|reject`, `GET /api/audit` (owner),
  `GET/DELETE /api/connected-accounts`, `POST /api/auth/logout`.
- **Tests:** a `member` gets 403 on delete-agent/edit-training/org-rename/lead-export; approve executes
  exactly once, reject never executes, expired never executes; every send/approval/training-edit/auth/billing
  event writes an `AuditLog` row; no plaintext credential anywhere.
- **Risks:** an un-gated route silently bypasses `authorize()` → a test asserts every mutating route is gated;
  app-level AES-GCM centralizes key risk → `keyId` for rotation; token-scheme change can mass-logout →
  grace window + client coordination.
- **Acceptance:** every mutating route + future tool call passes `authorize()` (default-deny, not the LLM);
  tokens are hashed + expiring + rotated; secrets encrypted at rest; the existing approve-before-send /
  `NEEDS_HUMAN` / takeover / `[[ALERT]]` behaviors are unchanged.

---

## Phase 4 — Agent Spec, versioning/lifecycle & NL builder · **P1 · depends on: Phase 1, 2**

**Objective.** Define one zod `AgentSpec` (serialization of existing rows), add an `AgentVersion` snapshot for
**rollback**, a 4-state lifecycle on a **new** column, and generalize `learn.ts` into an NL agent builder —
all additive, with live-edit staying the default.

- **Reuse:** [schemas.ts](../../server/src/lib/schemas.ts) (zod home), [training.ts](../../server/src/lib/training.ts)
  (`composeSystemPrompt` stays the compile target), [learn.ts](../../server/src/lib/learn.ts) (the
  one-call + defensive-parse + confirmable-draft pattern), [templates.ts](../../server/src/lib/templates.ts),
  [SetupGuide.tsx](../../client/src/components/agent/SetupGuide.tsx), `engine.draftFor` (the Test Console =
  "simulation").
- **New:** `lib/agentSpec.ts` (zod spec + `validateSpec` + `applySpec` + `specFromAgent`); `lib/agentBuilder.ts`
  (`generateSpecFromNL(description,{url?})` → validated spec, **never code**); publish/rollback/list-versions
  endpoints; `GET /api/channels` from `registry.listAdapters()` (kills the hardcoded client channel drift); a
  client "describe your agent" entry reusing SetupGuide's confirm UX.
- **DB:** `AgentVersion(agentId, version, specJson, status, note, createdAt; @@unique([agentId,version]))` +
  nullable `Agent.currentVersionId` + `Agent.lifecycleStatus`.
- **APIs:** `POST /api/agents/build`, `POST /api/agents/:id/apply-spec`, `GET /api/agents/:id/spec`,
  `POST /api/agents/:id/versions`, `POST /api/agents/:id/rollback`, `GET /api/channels`.
- **Tests:** `specFromAgent(applySpec(spec)) === spec` for every UI-settable field; the form path and the NL
  path produce the **same** rows; an existing agent (`currentVersionId=null`) replies exactly as today;
  hallucinated NL output is rejected/defaulted by zod (no fabricated prices survive).
- **Risks:** mandatory versioning would break the instant-edit promise → publish is explicit/optional, live
  mode default; NL build is paid LLM spend → gate behind the Phase 2 budget; build-from-URL inherits SSRF →
  the Phase 0 allowlist is a prerequisite.
- **Acceptance:** rollback restores a prior version atomically; an owner can describe an agent in one line,
  review a plain-English draft, and go live; the visual workflow builder is explicitly **deferred** (depends
  on Phase 5).

---

## Phase 5 — Event/trigger + workflow spine (Postgres-backed) · **P1 · depends on: Phase 1, 2, 3**

**Objective.** Add a Postgres-backed trigger/job state machine + a single in-process ticker (behind a flag),
wire Meta/Razorpay webhook ingestion, and satisfy the two written outbound plans + scheduled monitors — with
the hot reply loop left inline.

- **Reuse:** [channels/registry.ts](../../server/src/channels/registry.ts) (the registry idiom to mirror),
  `ALERT_COOLDOWN_MS` + `Conversation.alertedAt` (the persisted-timer pattern to generalize),
  [whatsappCloud.ts](../../server/src/lib/whatsappCloud.ts) (compliant transport), `learn.ts` fetch primitive,
  [realtime.ts](../../server/src/lib/realtime.ts) emit, [BROADCAST_INTEGRATION_PLAN.md](../../docs/BROADCAST_INTEGRATION_PLAN.md)
  + [TRACKLY_INTEGRATION_PLAN.md](../../docs/TRACKLY_INTEGRATION_PLAN.md) (already-designed first workflows).
- **New:** `events/envelope.ts` (CloudEvents field-shape only) + `makeEvent`/`emit`; `workflow/types.ts`
  (`WorkflowHandler`, `StepResult` = complete|retry|sleep|awaitApproval|fail); `workflow/registry.ts`;
  `jobs/runner.ts` (`SKIP LOCKED` lease-claim loop, backoff, DLQ); `triggers/registry.ts` + `scheduler.ts`
  (node-cron ~30–60 s) started once from `index.ts` behind `WORKFLOW_ENABLED` (default off); handlers:
  scheduled-monitor, outbound-drip (Trackly cap/window/jitter + send-ledger + opt-out), approval-gated-send;
  `webhooks` router (raw body, `hub.verify_token` + HMAC + dedupe); the `whatsapp-cloud` adapter.
- **DB:** `DomainEvent`/outbox, `Trigger`, `Job` (`status`, `nextRunAt`, `attempts`, `maxAttempts`,
  `stateJson`, `lease`, `leaseUntil`, `idempotencyKey @unique`), `WorkflowRun`, `WorkflowStepLog`,
  `Watch/Schedule`; outbound set (`Campaign`, `CampaignRecipient`, `OptOut`, `DeliveryEvent`, `WebhookEndpoint`,
  `ApiKey` / or `OutboundConnection`, `OutboundSendLog`, `OutboundOptOut`).
- **APIs:** `POST/GET /api/agents/:id/workflows`, `GET /api/workflows/:runId`,
  `POST /api/workflows/:runId/pause|resume|cancel|approve`, `POST/GET/DELETE /api/agents/:id/watches`,
  `POST /api/webhooks/whatsapp`, partner `/api/v1/*` (API-key), WS `'workflow'` event.
- **Tests:** with `WORKFLOW_ENABLED=off`, byte-for-byte today + existing tests green; a scheduled run survives
  a restart (resumes from `nextRunAt`, no duplicate action); an approval-gated run sends nothing until
  approved, then drips within cap/window/jitter; a failing step retries w/ backoff then dead-letters; an
  idempotency/lease key prevents double-send.
- **Risks:** a hand-rolled poller can drift → keep `StepResult` tiny, migrate to **pg-boss** (same Postgres,
  no Redis) on measured volume; the drip shares the whatsapp-web.js client with live replies → a per-agent
  send mutex (per Trackly §7); **whatsapp-web.js bulk/cold send risks permanent bans** → BROADCAST (Cloud API
  + templates + opt-in) is the default, TRACKLY is explicitly accepted-risk on a secondary number.
- **Acceptance:** billing is server-authoritative (webhook wired); the two outbound plans and a scheduled
  monitor run on the one spine; zero new infra (Postgres + node-cron) at one replica.

---

## Phase 6 — Tool registry, bounded tool loop & retrieval-on-trigger · **P2 · depends on: Phase 2, 3, 4**

**Objective.** Add an in-process typed Tool registry mirroring the channel registry, a bounded tool-use loop
as an opt-in `executionMode='agentic'` sibling path, first-party tools over existing tables, and pgvector
retrieval only when a tenant's KB outgrows the prompt — the common path stays one Haiku call.

- **Reuse:** `channels/registry.ts` (the pattern + `getAdapter().send` as the send-tool provider), the
  Phase 2 model gateway (add the `tools` param + bounded loop), `TrainingSource` (knowledge.search backing),
  `Conversation`/`leadStatus`/`leadNotes` (crm tools), the Phase 3 policy chokepoint + approve-before-send,
  the idempotency pattern from the outbound plans.
- **New:** `tools/types.ts`, `tools/registry.ts`, `tools/execute.ts` (timeout, one retry, side-effect gating
  through policy, one structured log line); `tools/builtin/channel-send.ts`, `crm.ts`, `knowledge.ts`
  (keyword/LIKE first, pgvector-ready), `web.ts` (wraps `learn.ts` after SSRF fix), `calendar.ts` (booking);
  the bounded `tool_use` loop in the gateway (hard step cap + timeout; tools omitted = byte-for-byte today);
  `ContactMemory` (per-contact facts + rolling summary + TTL) + a rolling conversation summary replacing raw
  `take:8`; an MCP **client-only** adapter behind the same registry (deferred/optional).
- **DB:** optional `KnowledgeChunk(agentId, orgId, sourceId, content, embedding vector)` + an embeddings
  provider + token-budget guard (added **only** when a KB exceeds the prompt budget); `ContactMemory`;
  optional `Integration` for OAuth tool credentials.
- **APIs:** optional `GET /api/agents/:id/tools`; `POST /api/integrations/:provider/connect` + OAuth callback
  (only when a third-party tool ships).
- **Tests:** `whatsapp.send_message` delegates to the adapter (reply/away/alert unchanged); tools omitted →
  `askClaude` byte-for-byte today; write/external tools route through approve-before-send; `browser.fetch_page`
  refuses private/metadata IPs; `{{LINK}}`/`[[ALERT]]` still work as deterministic post-processing.
- **Risks:** a tool loop adds latency/cost → opt-in per agent/role, common path stays single-turn; resist a
  DB-defined dynamic-tool system (code-first is safer at this scale); `browser.fetch_page` is the SSRF hole
  promoted to a tool — must ship with the allowlist + `external` gate.
- **Acceptance:** adding a new tool is one `builtin/` module (+ one `Integration` row if it needs auth) with
  no core-engine change; appointment booking (scenario 7) actually writes a booking via the loop with an
  approve-before-book gate.

---

## Phase 7 — Scale-out, connectors & internal delegation (deferred/triggered) · **P2–P3 · each item gated on a measured trigger**

**Objective.** Only when a concrete, recorded trigger fires: extract the WhatsApp session worker behind the
adapter seam; add OAuth2 connectors; introduce Redis for cross-replica state; Postgres RLS as
defense-in-depth; and an internal in-process `delegate()`. **Explicitly skip** external A2A / Temporal / Kafka
and the off-mission flight / LinkedIn-DM scenarios.

| Item | Flip trigger |
|---|---|
| **WhatsApp session-worker process** (sharded by `agentId`, behind `ChannelAdapter`) + move the per-conversation lock to **Postgres advisory locks** in the same change | measured RSS/agent reaches a validated % of the box ceiling |
| **OAuth2 per connector** (Instagram / Gmail / Google Calendar / Business Profile) via `ChannelAdapter.onboard()` | that connector is actually built |
| **Redis** pub/sub + shared rate-limit store | a 2nd replica is needed |
| **Postgres RLS** per tenant table | post-migration defense-in-depth (+ per-request tenant GUC) |
| **OpenTelemetry SDK** | a worker/queue/multi-replica, or a hosted backend to export to |
| **Internal `delegate()`** + role registry (e.g. a narrower-permission Research sub-agent) | a real context/permission-boundary use case — **not** external A2A |

- **Acceptance:** a written **decision record** marks each deferred standard with its concrete flip condition;
  nothing here is built speculatively.

---

## Dependency graph (one glance)

```
Phase 0 (live holes, lock, drift) ──┐        parallel
Phase 1 (migrations, orgId) ────────┴──► Phase 2 (gateway, trace, budget)
                                             │
                                             ▼
                                        Phase 3 (policy, identity, approvals)
                                             │
                     ┌───────────────────────┼───────────────────────┐
                     ▼                        ▼                       │
               Phase 4 (spec,          Phase 5 (event/workflow        │
               versioning, NL)          spine, outbound, webhooks)    │
                     └───────────┬───────────┘                        │
                                 ▼                                    │
                           Phase 6 (tools, bounded loop, RAG) ◄───────┘
                                 │
                                 ▼
                           Phase 7 (triggered scale-out / connectors / delegation)
```

## Per-phase acceptance summary (the "definition of done" ladder)

1. **P0** — no exploitable `/ws`/widget/SSRF hole; no plaintext secret; no double-reply; deterministic builds;
   one source of truth; money path tested.
2. **P1** — `migrate deploy` only; every tenant table has `orgId`.
3. **P2** — provider-swappable gateway; every run traced; per-tenant budget enforced.
4. **P3** — every mutating route + tool authorized (default-deny); hashed/expiring tokens; encrypted secrets;
   generalized approvals + audit.
5. **P4** — Agent Spec round-trips; rollback works; NL builder emits validated config; live-edit still default.
6. **P5** — scheduled monitors + the two outbound plans run on one Postgres spine; billing server-authoritative.
7. **P6** — tools act under policy + approve-before-send; appointment booking writes a booking; common path
   still one Haiku call.
8. **P7** — each heavy item built only on its recorded trigger.

Throughout: **no regression** in the reply loop, the channel-adapter seam, the training model, or the
alert/escalation/approval features. Work phase-by-phase; never attempt the platform in one pass.
