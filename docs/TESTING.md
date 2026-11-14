# Testing (QA-54)

The server suite is the safety net for a multi-tenant SaaS that sends real customer
messages and spends real money. It runs **Vitest** against an **isolated SQLite database**
and **never** touches the live Postgres. ~300 cases across 46 files, all offline and
deterministic.

> Scope: everything here lives under `server/`. The `client/` has no test suite yet.

---

## 1. How to run it

```bash
cd server
npm test            # vitest run — one pass, exits non-zero on failure
```

`npm test` maps to `vitest run` (see `server/package.json`). There is no watch script;
use `npx vitest` directly for watch mode. Config is `server/vitest.config.ts`.

No `ANTHROPIC_API_KEY`, network, or external DB is required — `setup.ts` supplies a dummy
key and every model/network boundary is mocked.

### Runner shape (`vitest.config.ts`)

| Setting | Value | Why |
|---|---|---|
| `pool` | `forks`, `singleFork: true` | All files share ONE process — matches the shared singleton `PrismaClient` and the single test DB. |
| `setupFiles` | `./tests/setup.ts` | Runs **first**, before any test module imports Prisma. |
| `hookTimeout` | 60s | The one-time `prisma db push` schema build fits inside it. |
| `testTimeout` | 30s | Per-case cap. |

---

## 2. The NEVER-touch-prod rule (`tests/setup.ts`)

`server/.env`'s `DATABASE_URL` points at the **live Railway Postgres**. A test run must
never connect to it. `tests/setup.ts` enforces this before any test runs:

1. **Detect & ignore** a managed DB URL. A `FORBIDDEN` regex matches
   `postgres://`, `postgresql://`, `railway`, `rlwy.net`, `.proxy.`, `amazonaws`,
   `supabase`, `neon.tech`, `mysql://`, `mongodb`. If the incoming `DATABASE_URL` matches,
   it is logged (credentials masked) and discarded.
2. **Force an isolated SQLite file.** `DATABASE_URL` is overwritten to
   `file:tests/.vitest-<pid>.db` and `NODE_ENV=test`. The per-pid name keeps parallel runs
   from colliding; `*.db` is gitignored.
3. **Hard-fail guard.** If after that `DATABASE_URL` does not start with `file:` *or* still
   matches `FORBIDDEN`, setup `throw`s and the run aborts — Prisma is never constructed.

The guard runs purely on the URL string, so it holds even if a Postgres URL is exported in
the shell. There is no code path that lets a test reach production data.

---

## 3. Fast per-file reset

Schema is built **once per run**, state is reset **per file** — same isolation, far cheaper.

- **First setup invocation:** `npx prisma db push --skip-generate --force-reset
  --accept-data-loss` builds the schema fresh (~3.7s) and sets a global
  `__TEST_SCHEMA_BUILT` flag. A `process.on('exit')` hook deletes the `.db` (+ `-journal`,
  `-wal`, `-shm`) when the process ends.
- **Every later file:** no rebuild. Setup `DELETE`s every row from each non-system table
  through the live connection (`PRAGMA foreign_keys = OFF` → delete → `ON`), a few
  milliseconds. Each file therefore starts from **empty tables**.

Isolation is identical to a full rebuild; only the cost drops. Because all files share one
process and one DB, tests must not assume rows survive across files, and factories mint
unique identifiers (phones, tokens) rather than reusing fixed values.

---

## 4. Mocking patterns

Three reusable patterns keep tests offline and deterministic. Helpers live in
`tests/helpers/`.

### a. Mock the brain / model boundary — `vi.mock`

The LLM is always mocked; tests assert on a scripted reply, not a real generation.

- **Reply engine** mocks `src/lib/brain`:
  ```ts
  vi.mock('../src/lib/brain', () => ({ askClaude: vi.fn(), generate: vi.fn() }));
  const gen = vi.mocked(generate);
  gen.mockResolvedValue(reply('Hello!'));   // reply() returns {text, model, tokens, ...}
  ```
  Used by `engine`, `memory`, `outbound`, `studio`, `tenancy`, `widget`, `pdf`.
- **Model gateway** mocks the Anthropic SDK itself (`@anthropic-ai/sdk`) to test token
  capture / refusal / retry (`gateway.test.ts`).
- **Agentic loop** mocks `src/lib/model-gateway` (`callModel`) and `src/lib/budget`
  (`canSpend`) to script a multi-tool run (`agentic.test.ts`).
- **Other boundaries** mocked the same way: `pdf-parse` (`pdf.test.ts`),
  `src/lib/embeddings` (`knowledge.test.ts`), `src/lib/monitor`'s `snapshot`
  (`monitor.test.ts`).

### b. The `mockChannel` 'test' adapter

`tests/helpers/mockChannel.ts` self-registers a capturing channel adapter under
`type: 'test'` (the default `channelType` factories use). Its `send()` pushes to an
in-memory array instead of a network, so engine/outbound tests assert exactly what would be
sent:

```ts
import { sends, resetSends } from './helpers/mockChannel';
beforeEach(resetSends);
// ...
expect(sends).toHaveLength(1);
expect(sends[0].text).toBe('Hello! How can we help?');
```

`register()` is a `Map.set`, so importing it is idempotent. Reset with `resetSends()` in
`beforeEach` (sends accumulate across cases otherwise).

### c. Factories (`tests/helpers/factories.ts`)

One place to build the org/agent/training shape, so a schema change touches one file.

| Factory | Builds |
|---|---|
| `createOrg(name?)` | an `Org` |
| `createUser(orgId, role='owner')` | a `User` with a bearer `token` + unique phone (auth/RBAC/WS tests) |
| `createAgent(orgId, data?)` | an `Agent` (defaults `channelType: 'test'`, `autoSend: true`) + empty `TrainingProfile` |
| `addSource(agentId, type, data, enabled?)` | a `TrainingSource` (`fact`/`link`/`faq`), org-stamped like the real router |
| `createOrgWithAgent(data?)` | an org + one agent in one call — the common case |

Factories mirror the real write path (e.g. `addSource` stamps `orgId` for tenant scoping),
so tests exercise the same row shapes production creates.

---

## 5. Money & safety coverage

The highest-value tests pin the **reply path** and the **spend/approval gates** so refactors
can't silently change what an agent sends or what it costs.

- **`engine.test.ts` (FND-40 / QA-04 / QA-05)** — the money & safety regression. Pins:
  auto-send delivers + logs `sent`; `autoSend:false` saves a **draft** and sends nothing;
  a bare `ok` is **ignored** and never calls the model; `NEEDS_HUMAN` escalates and sends
  nothing to the customer; `[[ALERT]]` pings the owner and **strips** the control line from
  the customer reply; `{{LINK:Name}}` substitutes the exact owner-whitelisted URL (never
  model text). Also per-contact serialization (FND-30 / QA-06): same contact serializes,
  different contacts parallelize.
- **`budget.test.ts`** — `canSpend` allows under the plan cap and flips `allowed:false` at
  the cap; defaults to the free cap with no subscription; uses the higher growth cap.
- **`agentic.test.ts` (TOOL-05/14/21/23)** — the bounded agentic loop: step cap and budget
  gate bound the loop, a non-allowlisted tool is never executed, and the plain reply path
  stays byte-identical (the loop is only entered for agentic agents).
- **`webhook.test.ts` (FND-20)** — the Razorpay webhook makes billing server-authoritative.
- **`pricing.test.ts`** — `costMicros` computes token cost exactly in micro-USD, falls back
  to `PRICES['*']`, clamps negatives to 0.
- **Approval gates** — `booking.test.ts` (nothing booked until approved + double-book
  guard), `outboundDrip.test.ts` / `outboundApi.test.ts` (a campaign parks a `WorkflowRun`
  at `awaiting_approval` + a pending `bulk_send` Approval and sends **nothing**),
  `approvals.test.ts` / `approvalsInbox.test.ts` (idempotent approve/reject, inbox resumes
  the parked run).
- **Tenant isolation** — `tenancy.test.ts` (orgId stamped at write time),
  `authz.test.ts` (RBAC on privileged routes), `realtime.test.ts` (a socket may only
  subscribe to an agent its token's user owns — the cross-tenant-leak fix),
  `ssrf.test.ts` / `security.test.ts` (SSRF guard, Phase-0 crypto).

---

## 6. Scenario → test matrix

| Area / scenario | File(s) |
|---|---|
| Reply engine: auto-send, draft, ack-filter, NEEDS_HUMAN, [[ALERT]], {{LINK}} | `engine.test.ts` |
| Per-conversation serialization | `engine.test.ts` |
| Daily spend cap | `budget.test.ts` |
| Token cost math | `pricing.test.ts` |
| Model gateway: token capture, refusal, retry | `gateway.test.ts` |
| Agentic loop: step/budget bounds, allowlist, off-path parity | `agentic.test.ts` |
| Tool registry, validation, side-effect gating, timeout/retry/idempotency | `tools.test.ts`, `toolsApi.test.ts`, `toolsFinish.test.ts`, `toolSchema.test.ts` |
| Calendar booking: approve-before-book, double-book guard | `booking.test.ts` |
| Approvals queue + inbox resume | `approvals.test.ts`, `approvalsInbox.test.ts` |
| Outbound: STOP opt-out, suppression, send mutex, drip cap/window, idempotent ledger | `outbound.test.ts`, `outboundDrip.test.ts`, `outboundApi.test.ts`, `broadcastExclusion.test.ts` |
| Billing webhook (Razorpay) | `webhook.test.ts` |
| Auth: signup OTP, bearer-token hardening, RBAC + audit | `api.test.ts`, `tokenAuth.test.ts`, `authz.test.ts`, `audit.test.ts` |
| Tenant isolation (org-scoped writes/reads) | `tenancy.test.ts` |
| WebSocket subscription authorization | `realtime.test.ts` |
| SSRF guard / Phase-0 security / crypto store | `ssrf.test.ts`, `security.test.ts`, `connectedAccount.test.ts`, `connectedAccountsApi.test.ts` |
| Website widget: signed key + per-agent rate cap | `widget.test.ts` |
| Knowledge / RAG: chunking, cosine, keyword + vector search, doc→facts fallback | `knowledge.test.ts` |
| PDF / document ingestion | `pdf.test.ts` |
| Per-contact memory ([[REMEMBER]], recall/inject, TTL, off-path parity) | `memory.test.ts` |
| Configurable connectors: mgmt API, data.query/action, REST binding, access gating | `connectors.test.ts` |
| Website monitor: diff, Watch CRUD, SSRF, trigger wiring | `monitor.test.ts`, `monitorsApi.test.ts` |
| Workflow spine: envelope, queue, idempotency, backoff, DLQ, cron, off-by-default | `spine.test.ts`, `workflows.test.ts` |
| Retention sweeps + spine metrics | `maintenance.test.ts` |
| Observability: execution viewer, readiness, structured logger/redaction | `observability.test.ts`, `log.test.ts` |
| Policy (default-deny authz, pure) | `policy.test.ts` |
| Agent Spec round-trip, versioning, rollback, clone | `agentSpec.test.ts` |
| Studio: channel catalog from registry + NL agent builder | `studio.test.ts` |
| Channel-aware prompt (names the agent's own channel) | `channelPrompt.test.ts` |
| LinkedIn agent: session store, catalog adapter, actions/worker/API (mock driver) | `linkedin.test.ts`, `linkedinActions.test.ts` |
| REST API integration (health, signup→agent→training→template) | `api.test.ts` |
| Misc unit | `unit.test.ts`, `security.test.ts` |

---

## 7. Conventions for new tests

- **Offline & deterministic.** Mock every model/network boundary (§4a). No real
  `ANTHROPIC_API_KEY`, HTTP, or external DB.
- **Use the factories and the 'test' adapter.** Don't hand-build org/agent rows or hit a
  real channel; assert sends via `mockChannel`.
- **Reset shared state in `beforeEach`.** `resetSends()`, `mockReset()` on your mocks — the
  DB is already empty per file, but the sends array and mock call history are not.
- **Mint unique identifiers.** Phones/tokens/emails must be unique across the run (one
  shared DB) — follow the factory / `api.test.ts` patterns.
- **Guard additive invariants.** When a feature is flagged off by default or must leave the
  reply path byte-for-byte, add a test that pins it (see `agentic`, `memory`, `spine`,
  `broadcastExclusion`).
