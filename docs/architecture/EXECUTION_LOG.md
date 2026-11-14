# Execution Log — building the Personal Agent Platform

Tracks per-task progress against [backlog.md](backlog.md) (512 tasks). Branch: `feat/agentic-platform`.
Status keys: ✅ done+tested · 🔨 in progress · ⏸️ blocked (needs owner/external resource) · ⬜ not started.

> **Guardrails honored on every task:** additive only; `executionMode:'reply'` stays byte-for-byte the
> default; reply loop / channel-adapter seam / training model / owner-alert / NEEDS_HUMAN / approve-before-send
> / `{{LINK}}` never regress; invisible-UI (minimal clicks, zero-decision defaults) on the front end;
> reuse + maintainability (shared helpers, typed interfaces) on both ends.

## Phase 0 — Live-hole patch, correctness & drift cleanup

| Task | Status | Notes |
|---|---|---|
| QA-01 Isolated test DB + hard prod-DB guard | ✅ | `server/vitest.config.ts` + `server/tests/setup.ts`; forces isolated SQLite, masks + ignores any Postgres/Railway URL; **proven** against a fake Railway URL (credential masked). |
| QA-02 mock-askClaude / gateway test double | ✅ | `vi.mock('../src/lib/brain')` pattern used in `tests/engine.test.ts`. |
| QA-03 mock channel adapter + fixtures | ✅ | `tests/helpers/mockChannel.ts` (capturing 'test' adapter) + `tests/helpers/factories.ts`. |
| FND-40 / QA-04 / QA-05 money/safety tests | ✅ | `tests/engine.test.ts`: auto-send vs draft, ack-ignore, NEEDS_HUMAN, [[ALERT]] owner ping + strip, {{LINK}} exact-URL. 6 tests green. |
| FND-30 per-conversation serialization lock | ✅ | `engine.ts` `withConversationLock` wraps `processInbound` (all channels); serial within a contact, parallel across. |
| FND-41 / QA-06 concurrency test | ✅ | `tests/engine.test.ts`: proves no overlap same-contact (maxActive=1), parallel different-contact (maxActive=2), one Conversation row. |
| FND-15 SSRF allowlist (incl. redirects) | ✅ | `lib/ssrfGuard.ts` (`assertPublicUrl`, `safeFetch` with per-hop re-check) wired into `learn.ts`. |
| FND-43 / QA-09 SSRF tests | ✅ | `tests/ssrf.test.ts`: 13 tests — private/loopback/link-local/metadata/CGNAT ranges + URL rejection, offline. |

| FND-10/11/42 WS per-socket auth + client + test | ✅ | `realtime.ts` `userOwnsAgent`; client sends token + stops reconnect on `unauthorized`. QA-07. |
| FND-12/13/14/54 widget signed key + rate cap + owner endpoint + embed | ✅ | `lib/widgetKey.ts` + `lib/rateLimiter.ts`; `GET /agents/:id/widget-key`; widget.js + ConnectCard carry `data-key`. QA-08. |
| FND-19 non-reflecting CORS + QA-56 | ✅ | `corsOriginFor()` locks same-origin in prod when unset. |
| FND-20/21 Razorpay webhook + block free-upgrade + QA-10 | ✅ | raw-body `POST /api/webhooks/razorpay`; shared `lib/subscription.applyPlan`; `/subscribe` blocked in prod. |
| SEC-1/2/17 AES-256-GCM secrets + botToken encrypt + boot fail-fast | ✅ | `lib/crypto.ts`, `lib/env.ts`; telegram botToken encrypted at rest; QA-25 crypto tests. |
| FND-06 remove unused compose Redis · FND-07 owner-gate /test-send · FND-01 archive legacy→legacy/ | ✅ | `docker-compose.yml`; `/test-send` owner-only; `agents/`+`platform/`+`shared/` → `legacy/` + README. |

**Verification:** full suite **75 tests green**, `tsc --noEmit` clean (server + client), no regression. 6 commits on `feat/agentic-platform` (main untouched).

| FND-35/36 pin all deps + lockfile · QA-15 guard | ✅ | No `latest` in any manifest; server lockfile synced; CI guard fails on `latest`. |
| FND-47 / QA-11 CI workflow | ✅ | `.github/workflows/ci.yml`: server typecheck+tests, client typecheck, no-`latest` guard. |
| PXD-10 decision log + **DB-1** datasource strategy | ✅ | `decision-log.md`: Postgres-everywhere + migrations recommended; blockers flagged. |
| FND-04 / PXD-14 README reconcile · PXD-23 BROADCAST out-of-scope | ✅ | Root README documents the live SaaS; BROADCAST banner added. |

**Phase 0 code-complete.** Every live security hole closed + double-reply fixed; 8 commits; 75 tests green;
main untouched. Remaining Phase-0 items are low-risk polish (FND-50/51 UX already largely covered by the WS
'unauthorized' handling; FND-02/03/05 further doc reconciliation; FND-52/53 finish) — can trail Phase 1.
FND-31 token capture folded into Phase 2 (MGW-1/OBS-3).

### Phase 1 — Migrations & tenant-data hardening (core DONE, applied to prod)
Owner authorized using the Railway DB directly. Resolved **DB-1** (SQLite for tests/dev via `schema.prisma`;
generated `schema.postgres.prisma` for prod + migrations — no local Postgres available).

| Task | Status | Notes |
|---|---|---|
| DB-1/3/4/5/20 migration baseline | ✅ | `0_init` generated + **marked applied on live prod** via `migrate resolve` (prod already matched schema exactly). Entrypoint → `migrate deploy`; Dockerfile drops the sed; `db:gen-pg`/`migrate:*` scripts. |
| DB-7..12 orgId + indexes | ✅ | Nullable `orgId` on ChannelSession/TrainingProfile/TrainingSource/Message + backfill from agent; indexes incl. Message(conversationId,createdAt), UsageEvent(orgId,createdAt). **Applied to Railway prod** via a reviewed migration (additive + backfill, no data loss). Write sites populate orgId. |
| DB-13 tenant-scope test | ✅ | `tests/tenancy.test.ts`. |
| QA-12 / pg-schema-sync CI guards | ✅ | CI fails on any destructive prod schema op or stale pg schema. |

**80 tests green, tsc clean.** The destructive `db push --accept-data-loss`-on-boot is GONE; prod now evolves
via reviewed migrations with history. 14 commits on `feat/agentic-platform`.

### Phase 1 — remaining (lower-risk / owner)
DB-14 tenant-scope helper (apply orgId filters to by-id reads) · DB-15 seed · DB-16 dev-reset · DB-18 divergence
doc · DB-21 perf check · DB-22 doc reconcile · QA-57 backfill-correctness test · **NOT NULL enforcement** on the
new orgId columns (after DB-24 prod-scale rehearsal — owner) · DB-17/QA-48 DR restore drill (owner).

### Phase 2 — Model gateway, observability & cost control (core DONE)
| Task | Status | Notes |
|---|---|---|
| MGW-1/2/3 model gateway + FND-31 token capture | ✅ | `lib/model-gateway.ts` (timeout/retry/usage); `brain.askClaude`/`generate` wrappers. |
| OBS-1/MGW-4 execution trace + Agent.executionMode | ✅ | UsageEvent extended (migration **applied to prod**); `lib/trace.ts` writes one enriched row per reply (fire-and-forget) with cost from `lib/pricing.ts`. |
| MGW-10/11 per-tenant budget gate | ✅ | `lib/budget.ts` daily cap enforced in `processInbound` → covers all channels incl. the widget; `budget_exceeded` outcome. |
| OBS-6 structured logging + redaction · DB-15 seed | ✅ | `lib/log.ts`; `prisma/seed.ts` (prod-guarded, idempotent). |

**Parallel pattern established & working:** subagents authored the 4 independent modules (pricing/log/budget/seed —
7 files, 13 tests) in parallel while the orchestrator did the coupled migration + engine wiring; integrated to green.
**93 tests, tsc clean. 18 commits.** Reply path byte-for-byte unchanged.

### Phase 2 — remaining
OBS-11/13 `/executions`+`/metrics` ✅ · OBS-15 `/health/ready` ✅. Left: OBS-19/20/21 client execution viewer
(client UX) · MGW-7/8 runtime facade/loader · MGW-15/16 client usage/cost surface.

### Phase 3 — Policy, approvals, audit & identity (core DONE)
| Task | Status | Notes |
|---|---|---|
| POL-06/12 + SEC-7 migration | ✅ | Approval/AuditLog/ConnectedAccount tables + User token-hardening columns **applied to Railway prod**. |
| POL-01/02 policy engine · lib/audit · lib/connectedAccount · lib/tokenAuth | ✅ | **Parallel-authored** (4 modules + tests, 22 tests) then integrated. |
| POL-03/04/14/15 authz chokepoint + audit | ✅ | `middleware/authz.ts` gates delete-agent/org-rename/lead-export/audit-view via the policy engine; denials + sensitive actions audited; owner-only `/api/audit`. |
| POL-07/08/09 approval queue | ✅ | `policy/approvals.ts` + `/api/approvals` (idempotent, tenant-scoped, audited); existing draft flow unchanged. |

**126 tests green, tsc clean. 19 commits.** Member day-to-day actions unchanged.

### Phase 3 — remaining
SEC-3/4/5 token hashing + expiry + rotate-on-login + `/auth/logout` — **DEFERRED**: it invalidates all live
sessions (mass re-login) on the running business, so it needs a coordinated maintenance window. Infra (columns,
`lib/tokenAuth.ts`) is ready. · SEC-9 migrate Telegram botToken into ConnectedAccount · POL-10/11/16/20 approval
executors + client Approvals inbox UI.

### Phase 4 — Agent Spec, versioning & Creation Studio (BACKEND core DONE)
| Task | Status | Notes |
|---|---|---|
| SPEC-1 AgentVersion migration | ✅ | AgentVersion + currentVersionId + lifecycleStatus (backfilled) **on prod**. |
| SPEC-2..5/27 agentSpec.ts | ✅ | zod AgentSpec + specFromAgent/applySpec round-trip; channel secrets stripped. |
| SPEC-13..19 versioning endpoints | ✅ | GET /spec, apply-spec, publish /versions, GET /versions, **rollback**, clone, lifecycle — policy-gated + audited. |
| STU-5/7 NL builder | ✅ | lib/agentBuilder.ts generateSpecFromNL → validated draft; POST /api/agents/build (budget-gated, SSRF-safe). |
| STU-16/17 channel catalog | ✅ | adapter metadata + GET /api/channels (registry-driven). |

**133 tests green, tsc clean. 22 commits. 5 migrations safely applied to Railway prod.**

### Phase 4 — Creation Studio UI (CLIENT core DONE)
| Task | Status | Notes |
|---|---|---|
| STU-20..23 describe-in-words creation + review | ✅ | `client/.../agent/CreateAgent.tsx`: one textarea + example chips + registry-driven channel chips → POST /build → editable review (name/instructions/knowledge/warnings) → create + apply-spec. "Skip — set it up myself" blank-agent escape hatch. Wired into `pages/Agents.tsx` (replaced the channel-first picker). |
| STU (simulate) | ✅ | Existing **Test** tab already does describe→simulate ("Ask your agent anything", nothing sent). |
| STU-36..40 version history UI | ✅ | `client/.../agent/VersionsPanel.tsx` + Versions tab in `AgentDetail`: save snapshot (note), confirmed one-tap restore (invalidates agent+training caches), duplicate agent. Wires GET/POST /versions, /rollback, /clone. |

**Client tsc clean.** 2 commits.

### Phase 4 — remaining
STU-24 templates→spec presets · STU-29/31 capability/trigger pickers (ship as 'soon' until Phase 5/6 wiring,
STU-30/32 flip) · STU-6 collapse NL pipeline stages · STU-27..35 richer draft-edit surfaces.

### Phase 5 — Event/Trigger/Workflow spine (CORE DONE, migration on prod)
| Task | Status | Notes |
|---|---|---|
| EWS-01..04 spine tables | ✅ | DomainEvent, Trigger, Job, WorkflowRun, WorkflowStepLog — migration `20261114150000_workflow_spine` **applied to Railway prod** (additive, 5 new tables, zero change to existing). |
| EWS-05/06 envelope + emit outbox | ✅ | `events/envelope.ts` (CloudEvents field-shape, pure makeEvent) + `events/emit.ts` (fire-and-forget, **no-op when WORKFLOW_ENABLED off** → hot path untouched + outbox never grows). |
| EWS-07/08 types + registry | ✅ | `workflow/types.ts` (StepResult union + StepContext + Step ctors) + `workflow/registry.ts` (self-registering, unknown→undefined→dead-letter). |
| EWS-09 dispatcher | ✅ | `triggers/dispatcher.ts`: outbox drain + event→trigger match, exactly-once via derived idempotencyKey, shallow filter, tenant-isolated. |
| EWS-10/11/21 runner + dialect claim + reclaim | ✅ | `jobs/claim.ts` (FOR UPDATE SKIP LOCKED on PG / serialized txn on SQLite; crashed-lease reclaim) + `jobs/runner.ts` (claim/dispatch/apply-StepResult, exp backoff, DLQ at maxAttempts, StepLog history). |
| EWS-12/23 run stepping + approval gate | ✅ | sleep/retry/complete/awaitApproval/fail transitions; awaitApproval creates an Approval row + parks the run. |
| EWS-13 scheduler + cron | ✅ | `jobs/cron.ts` (dependency-free 5-field evaluator) + `jobs/scheduler.ts` (minute-bucketed ticker, no dup across overlapping ticks). |
| EWS-14 boot wiring | ✅ | `jobs/spine.ts` + `index.ts`: start only when WORKFLOW_ENABLED, double-start guard, SIGTERM lease release. |
| EWS-15/28 tests | ✅ | `tests/spine.test.ts` — 24 tests. **157 total green, tsc clean, no regression.** |

### Phase 5 — Runs APIs + Automations UI + first handler (DONE)
| Task | Status | Notes |
|---|---|---|
| EWS-16/17 raw-body Razorpay webhook | ✅ | Already covered by Phase-0 FND-20/21 (`app.ts` mounts `express.raw` before `express.json`; server-authoritative plan apply). |
| EWS-18/19 Runs read + control APIs | ✅ | `modules/workflows/` — GET /api/workflows, GET /:runId (+timeline), GET /api/agents/:id/workflows, POST /:runId/{pause\|resume\|cancel\|approve} (idempotent, authz-gated, audited; approve decides the Approval + enqueues resume). 6 tests. |
| EWS-24/25/26 Automations UI | ✅ | `/automations` route + nav + `pages/Automations.tsx`: outcome-named run list, inline run detail with step timeline, pause/resume/cancel/approve controls; server pushes a 'workflow' WS event on control transitions. |
| SCN-27/28/29/42/36/30/31 scheduled website monitor | ✅ | **First real handler, end-to-end.** Watch model (migration on prod) + cron Trigger; `lib/monitor.ts` (SSRF snapshot+diff) + `lib/notify.ts`; `scheduledMonitor` handler (baseline→change→notify, MONITOR_ENABLED-gated); `/api/agents/:id/watches` CRUD; `GET /api/config` flags; client `MonitorsPanel` (tab shown only when flag on). 10 tests. |

**173 tests green, tsc clean, no regression. 3 migrations safely applied to Railway prod this session.**

### Phase 5 — Outbound QR drip (DONE, gated by OUTBOUND_ENABLED)
| Task | Status | Notes |
|---|---|---|
| SCN-05 outbound data model | ✅ | OutboundConnection/OutboundSendLog/OutboundOptOut + migration **on prod**. Ledger (connection,campaign,recipient) unique = send idempotency; opt-out (agent,phone) unique; encrypted token column. |
| SCN-07 per-agent send mutex | ✅ | `lib/sendMutex.ts` — FIFO per agent, concurrent across agents. |
| SCN-10 STOP opt-out loop | ✅ | `lib/optout.ts` (conservative multilingual matcher) + `engine.ts` pre-check gated by OUTBOUND_ENABLED (off → byte-for-byte): suppress + confirm once + no AI reply. |
| SCN-09/12/18 drip handler | ✅ | `workflow/handlers/outboundDrip.ts` — one send/tick then sleep(jitter); per-send gates: window, warmup cap from ledger (restart-safe), budget, opt-out, ledger idempotency; mandatory STOP footer. |
| SCN-11/40 approval-gated start + API | ✅ | `modules/outbound/` + `/api/agents/:id/outbound/*` — connection upsert (encrypted token, risk-ack to activate), campaign start (parked run + bulk_send Approval → sends nothing until approved via EWS-19), ledger progress, opt-out list/remove. |
| SCN-16/17 console | ✅ | Client `CampaignsPanel` (Campaigns tab, flag-gated): risk-consent → enable → compose+recipients → start (needs approval) → live progress. |
| SCN-19 tests | ✅ | `tests/outbound.test.ts` (7) + `tests/outboundDrip.test.ts` (9). **189 total green, tsc clean.** |

### Phase 5 — remaining
SCN-06 sendMedia (image promos) + message_ack → delivered/read ledger sync (SCN-14) · SCN-08 Trackly HTTP
connector (recipients currently come from the owner's own list — self-contained; Trackly becomes an optional
source) · SCN-15 BROADCAST-exclusion guard/test · SCN-39 ban-risk matrix doc · SCN-37 scenario picker · SCN-38
feature-gated sidebar nav (Campaigns/Monitors are agent-detail tabs today) · SCN-01 channel-aware reply prompt ·
SCN-32/33/35 shared cross-agent lead record. EWS-22 metrics · EWS-33/34 retention sweeps · EWS-30/31 docs +
pg-boss decision · EWS-32 inbound-durability ADR.

### Phase 6 — Tools, agentic loop & booking (CORE DONE)
| Task | Status | Notes |
|---|---|---|
| TOOL-01/02/03 contract + registry + execute | ✅ | `tools/types.ts` (MCP-shaped), `tools/registry.ts`, `tools/execute.ts` (input/output zod validation, side-effect gating [read inline; write/external → Approval, no act until approved], timeout + one retry, in-execution idempotency, one structured log line). |
| TOOL-08/09/10/11 builtin tools | ✅ | knowledge.search (read), crm.create_lead/update_lead (write, org-scoped), web.fetch_page (external, SSRF-guarded), calendar.book (external, double-book guard + idempotent). Self-register at boot (TOOL-28). |
| TOOL-04/05/06/14/21 gateway + agentic loop | ✅ | model-gateway tools array (zod→JSON via `z.toJSONSchema`) + toolCalls; `engine/agentic.ts` bounded loop (budget before every turn, turn + tool caps, allowlist-only, untrusted tool_result blocks); engine branch taken only for agentic agents — reply path byte-identical. Agent.enabledToolsJson column (**on prod**). |
| TOOL-15/17 tools API + picker | ✅ | GET/PUT /api/agents/:id/tools; client `AbilitiesPanel` (outcome-named toggles, approval implication in words, enabling flips to agentic). |
| POL-10/TOOL-19 approval executor | ✅ | `policy/approvalExecutor.ts` (DI seam) + `tools/approvalRunner.ts`: approving a gated tool call runs it `preApproved` exactly once. |
| SCN-20/22/24/25/41 booking | ✅ | Booking model (**on prod**) + calendar.book + bookings read/cancel API + client `BookingsPanel`. |
| TOOL-22/23/24 + SCN-25 tests | ✅ | `tools.test.ts` (9), `agentic.test.ts` (5), `booking.test.ts` (5). **214 total green, tsc clean.** |

### Phase 6 — remaining
TOOL-07 channel.send_message tool · TOOL-16/18/29 per-tool-call step trace + execution viewer UI · TOOL-13
AgentSpec.tools[] round-trip + version snapshot · TOOL-25 'adding a tool' docs · TOOL-26 MCP-client decision
record · TOOL-12 + MK-* pgvector RAG (deferred until a tenant's KB exceeds the prompt budget — small KBs stay
prompt-stuffed). SCN-32/33/35 shared cross-agent lead record. EWS-22/33/34 metrics + retention sweeps.

### Scenarios now built on the spine (all gated/opt-in, prod byte-for-byte until enabled)
Reply (always on) · **Website monitor** (MONITOR_ENABLED) · **Outbound QR drip** (OUTBOUND_ENABLED) ·
**Appointment booking** (per-agent calendar.book ability). Tools/agentic are per-agent (executionMode),
no global flag. 6 migrations applied to Railway prod this session; reply path unchanged throughout.

### Phases 6 (not started)
Tools registry + bounded agentic loop (TOOL-*) · memory/RAG w/ pgvector (MK-*). Booking's calendar.book tool
(SCN-21) depends on the Phase-6 tool registry.

### Phases 5–6 (not started) — feature build
Event/trigger/workflow spine (Postgres SKIP-LOCKED + node-cron) + outbound Trackly QR drip + scheduled monitors +
appointment booking; tools registry + bounded agentic loop; memory/RAG (pgvector on trigger). Plus the broad
client-UX layer (Approvals inbox, Automations console, Insights, Connected accounts, etc.). Large multi-session work.

## Tasks needing owner / external resources (parked, surfaced early)

| Task | Needs |
|---|---|
| DB-2 Shadow clone of prod Postgres | A read/structural clone of the live Railway DB (owner) |
| DB-3/DB-4 Baseline migration + resolve on prod | Run against prod during a deploy window (owner) |
| DB-17 / QA-48 DR restore drill | Railway backup access (owner) |
| QA-46 / QA-47 NFR ceiling + 2nd-replica | Target-box metrics + a 2nd replica (owner) |
| Any live QR / Telegram / Razorpay E2E | A phone to scan, a bot token, Razorpay keys (owner) |
