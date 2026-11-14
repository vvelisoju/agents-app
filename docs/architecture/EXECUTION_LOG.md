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

### Phase 4 — remaining (mostly CLIENT UX)
STU-20..42 the Creation Studio **UI** (describe-in-words screen, draft review, capability/trigger/channel/approval
pickers, simulate step, guided wizard, gallery, version-history/rollback UI, clone) — the big client-UX build.
STU-24 templates→spec presets · STU-6 collapse NL pipeline stages.

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
