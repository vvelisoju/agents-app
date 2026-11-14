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

**Verification:** full suite **60 tests green** (40 original + 7 engine + 13 ssrf), `tsc --noEmit` clean, no regression to any existing behaviour. Branch `feat/agentic-platform` (main untouched).

### Phase 0 — remaining (next up, in sequence)
WS auth FND-10/11 + QA-07 · widget key FND-12/13/14 + QA-08 · crypto/secrets SEC-1/2/3/17 + QA-25 ·
CORS FND-19 + QA-56 · Razorpay webhook FND-20/21 + QA-10 · res.usage capture FND-31 · legacy archive FND-01 ·
remove compose Redis FND-06 · gate /test-send FND-07 · pin deps FND-35/36 · CI FND-47 · drift docs (PXD-owned) ·
env/secrets docs FND-52/53 · UX FND-50/51 + UX-04.

## Tasks needing owner / external resources (parked, surfaced early)

| Task | Needs |
|---|---|
| DB-2 Shadow clone of prod Postgres | A read/structural clone of the live Railway DB (owner) |
| DB-3/DB-4 Baseline migration + resolve on prod | Run against prod during a deploy window (owner) |
| DB-17 / QA-48 DR restore drill | Railway backup access (owner) |
| QA-46 / QA-47 NFR ceiling + 2nd-replica | Target-box metrics + a 2nd replica (owner) |
| Any live QR / Telegram / Razorpay E2E | A phone to scan, a bot token, Razorpay keys (owner) |
