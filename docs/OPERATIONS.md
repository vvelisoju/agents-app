# Operations Runbook

> **RAG / embeddings (pluggable, off by default).** Document search (`knowledge.search`) works today
> with keyword retrieval and **needs no config**. To switch on vector search, set two env vars on the
> server: `EMBEDDINGS_PROVIDER` = `voyage` | `openai` | `cohere`, and the matching key
> (`VOYAGE_API_KEY` / `OPENAI_API_KEY` / `COHERE_API_KEY`). Optional `EMBEDDINGS_MODEL` overrides the
> default model. New document uploads embed automatically; to embed documents uploaded *before* the
> key was set, call `POST /api/agents/:id/knowledge/reindex` per agent. `GET /api/config` reports
> `features.rag`, and `GET /api/agents/:id/knowledge` reports chunk/embedded counts + the provider.


Operational reference for running the Secure Agents server (`server/`, Node + TypeScript + Express + Prisma) in production. Covers the workflow-spine feature flags and exactly what each turns on, the safe enable sequence, how migrations are applied against prod, health/readiness probes, and graceful-shutdown behavior on redeploy.

> **Golden rule:** With all three feature flags unset (the default), the process behaves **byte-for-byte as today** — the inbound reply path is unchanged and no background work runs. Everything new is gated off by default.

---

## 1. Feature flags

All three flags are read from the environment and treated as **on only when the value is exactly `1` or `true`** (see `server/src/lib/spineEnv.ts`). Any other value — unset, empty, `0`, `false`, `yes`, `TRUE` — is **off**. They are independent switches, but they have a dependency order (below).

The server exposes the live flag state to the authenticated UI at `GET /api/config` as `{ features: { workflow, monitor, outbound } }`, so the client only surfaces a scenario when its handler is actually enabled (no dead-end controls).

| Flag | Default | What it enables |
|---|---|---|
| `WORKFLOW_ENABLED` | **off** | The entire workflow spine — the runner loop and the scheduler ticker. |
| `MONITOR_ENABLED` | **off** | The scheduled website-monitor handler. |
| `OUTBOUND_ENABLED` | **off** | The inbound STOP opt-out pre-check **and** the outbound drip handler. |
| `MEMORY_ENABLED` | **off** | Per-contact memory recall/store in the reply path. |
| `SUMMARY_ENABLED` | **off** | Conversation rolling-summary: folds turns older than the recent window into a compact running summary (one background model call every ~10 messages). Independent of the spine. |

### `WORKFLOW_ENABLED` — the master switch

Checked by `workflowEnabled()` and consumed in `server/src/jobs/spine.ts`. On boot, `startSpine()` is a no-op unless this flag is on. When on, it starts two tickers exactly once (a double-start guard makes any second call a no-op):

- **Runner loop** — `runOnce()` every `WORKFLOW_RUNNER_MS` ms (default `2000`), which leases and executes pending jobs.
- **Scheduler ticker** — `drainEvents()` then `tickCron()` every `WORKFLOW_TICK_MS` ms (default `30000`), which dispatches trigger events and fires due cron schedules.

**This is the prerequisite for everything else.** The monitor and outbound scenario flags gate *whether a handler does work*, but **nothing fires at all** unless the spine is running to execute the jobs. Turning on `MONITOR_ENABLED` or `OUTBOUND_ENABLED` while `WORKFLOW_ENABLED` is off has no runtime effect — the handlers are never driven.

**Risk:** This is the flag that makes the process start doing background work on a schedule. It introduces the runner/scheduler load and begins executing any already-enqueued workflow jobs. Enable it first, on its own, and confirm the spine started (see the boot log in §2) before enabling any scenario flag. By itself, with both scenario flags off, the monitor and outbound handlers short-circuit, so turning on only the spine does not send any outbound message or run any website check.

### `MONITOR_ENABLED` — website monitors

Checked by `monitorEnabled()`; consumed in `server/src/workflow/handlers/scheduledMonitor.ts`. With it off the scheduled-monitor handler returns immediately (`skipped: monitor_disabled`) and does nothing. With it on (and the spine running), scheduled website monitors execute their checks on their cron cadence.

**Risk:** Each enabled monitor makes an **outbound HTTP request from the server** to the watched URL on a schedule. Scope it to intended targets only, and be mindful of fetch volume/frequency. It does not message end users directly; it feeds monitor results into workflows.

### `OUTBOUND_ENABLED` — STOP opt-out pre-check + outbound drip

Checked by `outboundEnabled()`; it gates **two** things:

1. **Inbound STOP opt-out pre-check** (`server/src/engine/engine.ts`). With the flag off, `processInbound` is byte-for-byte today's. With it on, an inbound message is matched against the opt-out matcher (`server/src/lib/optout.ts`, conservative — only short, essentially-just-the-word STOP/unsubscribe messages trigger it); a match suppresses the contact and sends the opt-out confirmation instead of a normal reply.
2. **Outbound drip handler** (`server/src/workflow/handlers/outboundDrip.ts`). With it off the handler returns `skipped: outbound_disabled`. With it on (and the spine running), approved campaigns drip messages to recipients, honoring per-tenant budget, opt-out suppression, and the send ledger.

**Risk — WhatsApp ban exposure.** Outbound/promotional sending over an unofficial WhatsApp Web session is the single highest-risk capability in the platform: WhatsApp actively bans numbers that send unsolicited bulk/promotional traffic. Mitigations are built in — a mandatory opt-out footer on every promo (`OPT_OUT_FOOTER` in `server/src/lib/outbound.ts`), the STOP pre-check above, a per-connection **risk acknowledgement** that must be recorded before a connection can go active (`riskAckAt`), and a **per-campaign owner approval** (`bulk_send`) that holds the run at `awaiting_approval` and sends nothing until approved. Even so, treat it as the highest-risk flag.

> **Strong recommendation:** run outbound on a **dedicated secondary WhatsApp number**, never the primary business line that handles live customer replies. If WhatsApp bans the sending number, a secondary number keeps the core reply agent online.

---

## 2. Safe enable sequence (production)

Enable in dependency order, one step at a time, verifying each before the next.

1. **Set `WORKFLOW_ENABLED=1` and redeploy.** This starts the spine but drives no scenario yet (both scenario handlers short-circuit while their flags are off).
2. **Verify the runner actually started — read the boot log.** On successful start you will see, from `server/src/index.ts`:
   ```
   ✅ Server listening on http://localhost:4000  (API at /api)
      ⚙️  Workflow spine enabled (runner + scheduler).
   ```
   plus a structured `workflow spine started { runnerMs, tickMs }` line from `server/src/jobs/spine.ts`. **If the `⚙️ Workflow spine enabled` line is absent, the spine did not start** (flag not seen as `1`/`true`) — stop and fix the env before going further. You can also confirm via `GET /api/config` → `features.workflow === true`.
3. **Enable one scenario flag at a time** once the spine is confirmed running:
   - **Monitors:** set `MONITOR_ENABLED=1`, redeploy, confirm via `GET /api/config` (`features.monitor === true`), then activate monitors for the intended URLs only.
   - **Outbound:** set `OUTBOUND_ENABLED=1`, redeploy, confirm `features.outbound === true`. Outbound additionally requires, per connection and per campaign:
     - a **per-connection risk acknowledgement** — a connection cannot be set active without `riskAckAt` recorded; `setActive(active: true)` fails with `risk_ack_required` otherwise, and `startCampaign` fails with `inactive` if the connection isn't active or has no risk ack.
     - **owner approval per campaign** — `startCampaign` parks the run at `awaiting_approval` behind a `bulk_send` approval and sends nothing until an owner approves it from the Approvals inbox (approving there also resumes the run).
4. **Monitor after each step** — watch logs and the Insights/Approvals surfaces before widening scope.

To roll back any scenario, unset its flag (or set it to `0`) and redeploy; the handler goes inert immediately. Unsetting `WORKFLOW_ENABLED` stops all background work on next boot.

---

## 3. Migrations (production)

Prisma is run with **two schemas**, by design (`server/scripts/gen-pg-schema.js`):

- `prisma/schema.prisma` — the **committed, canonical schema**, kept on the **SQLite** provider so the fast isolated test suite and zero-setup local dev work with no local Postgres.
- `prisma/schema.postgres.prisma` — **auto-generated** Postgres variant used for **prod runtime + migrations**. Identical models; only the datasource `provider` differs. **Never edit it by hand** (it carries a DO-NOT-EDIT banner).

### Workflow

1. Change models in `prisma/schema.prisma` only.
2. **Regenerate the Postgres schema:**
   ```
   npm run db:gen-pg        # node scripts/gen-pg-schema.js → writes prisma/schema.postgres.prisma
   ```
   This reads `schema.prisma`, swaps `provider = "sqlite"` for `"postgresql"`, and rewrites the generated file. (A CI check keeps the two in sync.)
3. **Deploy migrations against prod** using the Postgres schema:
   ```
   npm run migrate:status   # prisma migrate status --schema prisma/schema.postgres.prisma  (dry inspection)
   npm run migrate:deploy   # prisma migrate deploy --schema prisma/schema.postgres.prisma
   ```
   `migrate:deploy` applies only committed, already-generated migration files, in order. It is **forward-only** and does not generate or prompt — the correct command for prod.

### Rules

- **Migrations are additive and forward-only.** New columns/tables are added without dropping or rewriting existing data. `migrate deploy` never rolls back; recovery is a new forward migration.
- **NEVER run `db push` against prod.** `npm run db:push` (`prisma db push`) is schema-sync for **local/dev SQLite only**. Against Postgres it can drop or rewrite columns to force the DB to match the schema, with no migration history and no additive guarantee — it is destructive on a live database.
- **`DATABASE_URL` points at the live Railway Postgres in prod.** Any migrate/push command targets whatever `DATABASE_URL` is set to. Before running migrations or tests, confirm you are pointed at the intended database and override `DATABASE_URL` for test/`db push` work so you never touch prod. (`isPostgres()` treats any non-`file:`/`sqlite:` URL as Postgres.)

---

## 4. Health & readiness endpoints

Two separate probes (`server/src/routes.ts`):

| Endpoint | Auth | Behavior | Use for |
|---|---|---|---|
| `GET /api/health` | none | Always `200 {"ok": true}` as long as the process is up. | **Liveness** — is the process running? |
| `GET /api/health/ready` | none | Runs `SELECT 1` against the DB: `200 {"ready": true, "db": true}` on success, **`503 {"ready": false, "db": false}`** if the DB is unreachable. | **Readiness** — can it serve traffic? Point the load balancer / platform readiness check here so a DB outage pulls the instance out of rotation. |

Do not use `/api/health` for readiness — it stays `200` even if the database is down.

---

## 5. Graceful shutdown & lease release on redeploy

On `SIGTERM` or `SIGINT` (what the platform sends on redeploy/restart), `server/src/index.ts` runs a guarded shutdown once:

1. **`stopSpine()`** (`server/src/jobs/spine.ts`) — clears the runner and ticker intervals, then **releases this process's held job leases**: every `Job` row still in `status: 'leased'` is reset to `status: 'pending'` with `lease` / `leaseUntil` cleared, and the count is logged (`released leases on shutdown`). This ensures no job is **stranded** mid-flight — a job this instance had leased becomes immediately re-claimable by the next instance instead of waiting for its lease to expire.
2. **`server.close(...)`** — stops accepting new connections and exits once in-flight requests drain.
3. A **5-second failsafe** `process.exit(0)` (unref'd) guarantees the process exits even if `server.close` hangs.

Because leases are released on shutdown and re-claimed on the next boot's runner loop, a rolling redeploy is safe: a brief pause in background processing during the handover, no lost or duplicated jobs. This is only meaningful when `WORKFLOW_ENABLED` is on; with the spine off there are no leases to release.
