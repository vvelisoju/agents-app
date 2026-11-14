# Observability — execution traces, metrics, budgets & retention

How the platform records what every agent did, turns those rows into owner-facing metrics,
caps per-tenant spend, and prunes itself. Pairs with [SECURITY.md](SECURITY.md) and
[OPERATIONS.md](OPERATIONS.md).

Design rules: tracing is **additive and fire-and-forget** — a trace write never throws into
the reply path (mirrors `alertOwner`). Reply-mode runs are byte-for-byte unchanged by any of
this; the agentic tool loop adds per-step rows on top.

## 1. The two trace tables

| Table | Grain | Written by | Written when |
|---|---|---|---|
| `UsageEvent` | one row per **produced reply / run** | `writeTrace()` in `lib/trace.ts` | end of `engine.ts` run (and on budget/error short-circuits) |
| `ExecutionStep` | one row per **tool call** | `executeTool()` in `tools/execute.ts` | each tool invocation in the agentic loop |

Reply-mode runs never call `executeTool`, so they write **zero** `ExecutionStep` rows — the
`UsageEvent` is the whole trace. Both tables share the run's `executionId` so steps join back
to their run.

### 1.1 `UsageEvent` — the execution trace (`prisma/schema.prisma`)

All trace fields are **nullable and additive** (OBS-1 / MGW-4). A row is created per produced
reply with model/token/cost/latency/outcome so a reply is traceable end to end.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | PK |
| `orgId` | String | tenant |
| `agentId` | String | which agent produced it |
| `type` | String | always `reply` (default) |
| `createdAt` | DateTime | row time; drives daily-cap and metric windows |
| `executionId` | String? | run id; joins to `ExecutionStep` |
| `model` | String? | model used (e.g. `claude-haiku-5-5`) |
| `provider` | String? | model provider |
| `inputTokens` | Int? | prompt tokens from `callModel` |
| `outputTokens` | Int? | completion tokens |
| `costMicros` | Int? | estimated cost in micro-USD (see §3) |
| `latencyMs` | Int? | model latency |
| `outcome` | String? | `sent` \| `draft` \| `needs_human` \| `away` \| `error` \| `ignored` \| `budget_exceeded` |
| `trigger` | String? | `channel-event` (default) \| `cron` \| `webhook` |
| `conversationId` | String? | conversation it belongs to |
| `agentVersion` | String? | agent config version |
| `errorCode` | String? | set on `error` outcomes (e.g. `model_error`) |
| `approvalState` | String? | `auto` \| `draft` \| `approved` \| `skipped` |

Index: `@@index([orgId, createdAt])` (DB-12) for analytics aggregation.

**Outcomes set in `engine.ts`:** `budget_exceeded` (daily cap hit, before the model call),
`error` + `errorCode: model_error` (model threw), and on success `sent` when `agent.autoSend`
else `draft` (with matching `approvalState`).

### 1.2 `ExecutionStep` — per-tool-call step trace (TOOL-29)

One row per tool invocation in the agentic path, keyed to the run's `executionId`. Input is
stored **redacted and truncated** (`safeInput()` → `redact()` then sliced to 2 000 chars);
secrets never land here.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | PK |
| `orgId` / `agentId` | String | tenant / agent |
| `executionId` | String | the run; joins to `UsageEvent` |
| `stepIndex` | Int | ordinal of the call within the run |
| `toolName` | String | tool invoked |
| `inputJson` | String | redacted + truncated input (default `{}`) |
| `outcome` | String | `ok` \| `invalid_input` \| `invalid_output` \| `timeout` \| `denied` \| `pending_approval` \| `error` |
| `approvalState` | String? | `inline` \| `pending_approval` \| `pre_approved` |
| `latencyMs` | Int? | step latency |
| `createdAt` | DateTime | row time |

Indexes: `@@index([executionId, stepIndex])` (ordered timeline) and `@@index([orgId, createdAt])`.

The write is fire-and-forget (`.catch(() => {})`) so a trace failure never breaks a tool call.
`approvalState` is derived: `pre_approved` when the approval executor is replaying a gated
write, `pending_approval` when the outcome is itself `pending_approval`, else `inline`.

## 2. Metric formulas (`modules/analytics/router.ts`, OBS-13)

`GET /api/analytics/metrics` reads the retained `UsageEvent` rows for the org over a window
(`?from=`, default last 7 days, `outcome` non-null) and computes everything **in JS** so the
query stays dialect-agnostic (SQLite dev / Postgres prod).

Let `total` = number of trace rows in the window, `byOutcome[o]` = count per outcome, and
`produced = byOutcome.sent + byOutcome.draft`.

| Metric | Formula |
|---|---|
| **Success rate** | `produced / total` (0 when `total = 0`) |
| **Intervention rate** | `byOutcome.needs_human / total` |
| **Cost** | `Σ costMicros` over the window (micro-USD) |
| **Latency p50 / p95** | sort non-null `latencyMs` ascending; `pct(p) = lat[min(len-1, floor((p/100)*len))]` |

Response: `{ total, byOutcome, costMicros, latencyP50, latencyP95, successRate, interventionRate }`.
The percentile is a simple nearest-rank pick (no interpolation), clamped to the last index.

## 3. Cost model (`lib/pricing.ts`)

`callModel` returns `inputTokens` / `outputTokens`; `costMicros(model, in, out)` turns those
into an integer **micro-USD** cost (1 USD = 1 000 000 micros) so costs sum without float drift.

- `PRICES` are **indicative list prices** in USD per 1M tokens — an accounting estimate, not a
  billing source of truth. `claude-haiku-5-5` = 1.0 in / 5.0 out; `'*'` fallback = 3.0 / 15.0.
- Since price is USD per 1M tokens, one token costs exactly `pricePerM` micro-USD, so
  `micros = round(inTok * inputPerM + outTok * outputPerM)`.
- Unknown models fall back to `PRICES['*']`; negative token counts clamp to 0.

`writeTrace` computes `costMicros` only when a `model` is present (budget/error short-circuits
store `null`).

## 4. Budget — per-tenant daily cap (`lib/budget.ts`, MGW-10/11)

A **reply-count** cap per calendar day (server local time), by plan. Pure Prisma reads — it
never writes, so it is safe to call before the model gateway. Every channel (including the
public widget) funnels through `engine.ts`, so one check caps spend everywhere.

| Plan (`Subscription.plan`) | Daily reply cap |
|---|---|
| `free` (default) | 200 |
| `growth` | 2 000 |
| `pro` | 10 000 |

`canSpend(orgId)` looks up the org's plan (missing/unknown → `free`), counts `UsageEvent` rows
since local midnight, and returns `{ allowed: used < cap, used, cap }`. When `!allowed`,
`engine.ts` writes a `budget_exceeded` trace and returns without calling the model.

## 5. Redaction (`lib/log.ts`)

`log` is a tiny structured JSON logger (one line per event, no new deps). Every emitted line is
passed through `redact()` first, which masks sensitive keys to `[redacted]`.

- Default masked keys (case-insensitive): `token`, `botToken`, `authorization`, `password`, `body`.
- `redact()` shallow-copies and never throws (a non-object returns as-is) — logging must never
  crash the caller.
- Step-trace input uses the same `redact()` before truncation, so secrets never reach
  `ExecutionStep.inputJson`.

## 6. Retention sweeps (`lib/retention.ts` on the `lib/maintenance.ts` ticker)

One always-on, in-process **maintenance ticker** (EWS-34) runs at boot independent of
`WORKFLOW_ENABLED` — housekeeping runs on every deployment even with the spine off. Interval
`MAINTENANCE_INTERVAL_MS` (default 6h) with a delayed first pass ~30s after boot. Sweeps are
best-effort: one failing sweep never stops the others, and the ticker never throws into the
event loop. Non-zero prune counts are logged as `maintenance` events.

Windows: `RETENTION_DAYS` (default **90**); approvals/audit use `APPROVAL_RETENTION_DAYS`
(default **180**). Sweeps prune only terminal/processed/expired rows — never in-flight runs,
unprocessed outbox events, or inbox `Message` history.

| Sweep | Ticket | Prunes |
|---|---|---|
| `prune-domain-events` | EWS-33 | processed `DomainEvent` past window |
| `prune-jobs` | EWS-33 | `Job` in `completed`/`dead` past window |
| `prune-workflow-runs` | EWS-33 | terminal `WorkflowRun` (+ cascading step logs) |
| `prune-traces` | **OBS-18** | `UsageEvent` + `ExecutionStep` past window |
| `expire-and-prune-approvals` | POL-17 | expires stale pending `Approval`; prunes `AuditLog` past 180d |
| `prune-outbound-ledger` | EWS-33 | terminal `OutboundSendLog` past window |
| `prune-contact-memory` | MK-12 | `ContactMemory` past `expiresAt` |

`prune-traces` deletes trace rows older than the cutoff; metrics over the retained window are
unaffected.

## 7. Endpoints

All org-scoped; the execution/metrics endpoints are **owner-only** (`403 forbidden` otherwise).

### Analytics (`/api/analytics`, auth required)

| Route | Access | Returns |
|---|---|---|
| `GET /` | any member | dashboard counts: `agents`, `conversations`, `repliesTotal`, `repliesToday`, `leadsByStatus`, and a `perAgent` breakdown |
| `GET /executions` | owner | recent traces (OBS-11), filterable `?agentId=&outcome=`, `?limit=` (default 50, max 200), newest first |
| `GET /metrics` | owner | the metrics of §2 (OBS-13), windowed by `?from=` |

`/executions` returns each row's `executionId`, `agentId`, `outcome`, `model`, token counts,
`costMicros`, `latencyMs`, `approvalState`, and `at` (createdAt).

### Spine metrics (`/api/workflows/metrics`, EWS-22)

`spineMetrics(orgId)` in `modules/workflows/service.ts` — org-scoped queue health from `Job`
and `WorkflowRun` group-by counts. (Route is declared before `/:runId` so it isn't shadowed.)

Returns:

| Field | Meaning |
|---|---|
| `queueDepth` | pending jobs |
| `leased` / `running` | jobs in flight |
| `dlq` | dead jobs |
| `dueBacklog` | pending jobs with `nextRunAt <= now` (overdue) |
| `jobsByStatus` | full `Job` status histogram |
| `runsByStatus` | full `WorkflowRun` status histogram |

Related workflow reads: `GET /api/workflows` (run list) and `GET /api/workflows/:runId`
(run + ordered `WorkflowStepLog` timeline).

## 8. Where things are written (quick map)

- `engine.ts` → `writeTrace()` on every run outcome (`budget_exceeded`, `error`, `sent`/`draft`).
- `tools/execute.ts` → `executionStep.create()` per tool call (agentic path only).
- `lib/budget.ts::canSpend()` → called in `engine.ts` before the model gateway.
- `lib/retention.ts` → registers `prune-traces` (and siblings) on the maintenance ticker.
