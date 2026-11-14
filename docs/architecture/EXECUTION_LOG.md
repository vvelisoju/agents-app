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

### Phase 1 — BLOCKED on owner decision/resource (see decision-log.md DB-1)
Migrations require: (1) a **Postgres instance for dev/test** (cutting the schema to `postgresql` breaks the
SQLite test suite until one exists — docker-compose defines one); (2) a **structural shadow clone of the live
prod DB** to diff the baseline against, or approval to generate the baseline and `migrate resolve` it on prod
in a deploy window (DB-2/3/4). No prod change made. **Next once unblocked:** DB-1→DB-5 migration baseline,
then DB-7..10 orgId backfills (rehearsed per DB-24).

## Tasks needing owner / external resources (parked, surfaced early)

| Task | Needs |
|---|---|
| DB-2 Shadow clone of prod Postgres | A read/structural clone of the live Railway DB (owner) |
| DB-3/DB-4 Baseline migration + resolve on prod | Run against prod during a deploy window (owner) |
| DB-17 / QA-48 DR restore drill | Railway backup access (owner) |
| QA-46 / QA-47 NFR ceiling + 2nd-replica | Target-box metrics + a 2nd replica (owner) |
| Any live QR / Telegram / Razorpay E2E | A phone to scan, a bot token, Razorpay keys (owner) |
