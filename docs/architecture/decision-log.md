# Architecture Decision Log

One line per decision: the choice, why, and (for deferred items) the **flip trigger** that
promotes it. Authoritative over the narrative docs where they differ. (PXD-10)

## Adopted now
| # | Decision | Rationale |
|---|---|---|
| ADR-1 | **Modular monolith on one deployable** (`server/`) | Tier-2-SMB scale; a service split is premature (gap-analysis §5). |
| ADR-2 | **Postgres is the single backbone** — relational + job queue (`SKIP LOCKED`) + outbox + pgvector-later | Avoids adding Redis/Kafka/Temporal at one replica. |
| ADR-3 | **`whatsapp-web.js` (QR) is the only agent transport**; official Cloud API / BROADCAST path **dropped** | Owner decision 2026-11-14. Outbound = Trackly-style QR drip only. Guarded by QA-58. |
| ADR-4 | **In-process typed Tool registry + native Anthropic tool-use**, not a full MCP mesh | ~3–6 first-party tools; keep contract MCP-shaped for later. |
| ADR-5 | **Hashed + expiring bearer token**, not JWT/OIDC IdP | Fixes plaintext-token hole without IdP ops cost. |
| ADR-6 | **In-repo `authorize()` + per-action table**, not OPA/Cedar | Owner/member + ~8 actions; a PDP sidecar is unjustified. |
| ADR-7 | **App-level AES-256-GCM secrets** (env key + `keyId`), not external KMS | Removes plaintext-at-rest now; KMS envelope is a later upgrade. |
| ADR-8 | **Inbound is persisted synchronously before the reply**, serialized per conversation — no separate inbound queue/outbox | At this scale a DB write + per-conversation lock gives durability + exactly-one-reply without the ops cost of an inbound broker. See below. |

## DB-1 — datasource & migration strategy  ⚠️ **owner decision needed before Phase 1 execution**
**Chosen (recommended): Postgres everywhere, real migrations.**
- Prod + local dev + CI all run **PostgreSQL**; schema changes ship as committed **Prisma migrations**
  applied with `prisma migrate deploy` (replacing the destructive `prisma db push --accept-data-loss`
  on boot). This is the only way to get Postgres-only features the roadmap needs (`SKIP LOCKED` queue,
  pgvector) and a safe, reviewable, rollback-able change history against the live DB.
- The **fast unit/integration test suite keeps its isolated ephemeral DB (QA-01)**. Because Prisma's
  schema has a single `provider`, moving the schema to `postgresql` means the test DB must also be
  Postgres (an ephemeral per-run database), **not** the current SQLite file. Postgres-only behaviours
  (queue, vector) then get real coverage (QA-13 runs migrations against an ephemeral Postgres in CI).

**Why this is not yet executed (honest blockers — need owner):**
1. **A Postgres instance for dev/test.** The current sandbox has no Postgres; cutting the schema
   `provider` to `postgresql` would break the 75 passing SQLite tests until a dev/CI Postgres exists
   (docker-compose already defines one — confirm it's the intended local DB).
2. **A structural shadow clone of the live Railway prod DB** (schema only, no data) to diff the baseline
   migration against, OR explicit approval to generate the baseline from the current schema and run
   `prisma migrate resolve --applied 0_init` against prod yourself in a deploy window (DB-2/3/4).
3. The `orgId` backfills (DB-7..10) are **data** migrations (add nullable → backfill from `agentId` →
   set NOT NULL) and must be rehearsed on a prod-scale clone for lock duration (DB-24) before cutover.

**Interim state (safe, in place):** tests run on isolated SQLite via `db push` (QA-01) and never touch
prod; prod still boots via `db push` until DB-4 lands. No destructive change has been made to prod.

**Alternatives rejected:** keeping SQLite-dev + Postgres-prod with a build-time `sed` swap and no
migrations (the status-quo hazard Phase 1 exists to remove); maintaining two provider-specific migration
histories (DB-18 divergence, error-prone).

## ADR-8 — inbound message durability (EWS-32)

**Context.** A channel (WhatsApp, website widget, …) hands an inbound message to
`processInbound`. If the process crashed mid-reply, could a customer message be lost or answered
twice?

**Decision.** `processInbound` runs **serialized per conversation** (`withConversationLock(agentId:from)`)
and **persists the inbound `Message` row (status `received`) before** any model call or reply
(`engine.ts`, right after the `Conversation` upsert). The reply is produced after, and the outbound
is persisted as `draft`/`sent`. There is **no separate inbound queue or transactional outbox** — the
single synchronous DB write is the durability point.

**Properties this gives us.**
- *Durable inbound:* once the `received` row is committed, the message survives a crash; the owner
  sees it in the inbox even if reply generation later failed.
- *Exactly-one-reply per turn:* the per-conversation lock means two near-simultaneous messages can't
  both load the same history and double-reply; the deterministic post-processing
  (`NEEDS_HUMAN`/`[[ALERT]]`/`{{LINK}}`) runs once.
- *At-least-once, not exactly-once end-to-end:* a crash **between** reply-send and persisting the
  outbound row can, in the worst case, resend on a channel retry. This is accepted at this scale;
  the WhatsApp adapter's own send is the only external effect and is mutexed per agent.

**Flip trigger.** Move inbound onto the Postgres `Job`/outbox spine (durable, replayable, DLQ) when
either (a) a single channel pushes inbound faster than synchronous processing can drain, or (b) we
need cross-process inbound fan-out. The spine already exists (`jobs/`, gated by `WORKFLOW_ENABLED`),
so this is a routing change, not new infrastructure.

## Deferred — with flip triggers
| Item | Trigger to adopt |
|---|---|
| pgvector + embeddings | A tenant's training exceeds the prompt budget, or PDF/catalog upload (MK-4). |
| MCP client (allowlisted) | A concrete external/third-party tool server is needed (TOOL-26). |
| OAuth2 per connector | That connector (Instagram/Gmail/Calendar) is actually built (SEC-20). |
| Postgres RLS | Post-migration defense-in-depth + a per-request tenant GUC (DB-19). |
| Redis / BullMQ | Going multi-replica, or a heavy throttled sender (EWS-31 → pg-boss first). |
| Separate WhatsApp session worker + Postgres advisory lock | Measured RSS/agent hits a validated % of the box ceiling (QA-46 → QA-59). |
| OpenTelemetry SDK | A worker/queue/multi-replica, or a hosted backend to export to. |

## Skipped (not at this scale)
Temporal · Kafka/NATS · Google A2A protocol · LangGraph · external IdP (Keycloak/Auth0/Ory).

---

## ADR process

How entries in this log are numbered, moved through their lifecycle, added, and superseded. This log
is the single authoritative record of architecture decisions; it wins over the narrative docs where
they differ.

### Numbering

- **Adopted** decisions are `ADR-<n>`, numbered sequentially and never reused. A number is permanent:
  once `ADR-7` exists, the next adopted decision is `ADR-8` even if `ADR-7` is later superseded.
- **Domain-scoped** decisions that travel together keep a prefix + sequence (e.g. the `DB-*`
  datasource/migration thread). The prefix groups them; the sequence orders them within the group.
- **Deferred** and **skipped** items are not numbered — they live in their tables until a flip
  trigger promotes a deferred item, at which point it becomes the next `ADR-<n>`.

### Status lifecycle

| Status | Meaning | Lives in |
|---|---|---|
| **proposed** | written down, not yet agreed; needs owner sign-off before execution | its own heading with a ⚠️ note (see DB-1) |
| **accepted** | the decision in force today; code should match it | **Adopted now** table |
| **deferred** | consciously not done yet; has an explicit **flip trigger** | **Deferred** table |
| **superseded** | replaced by a later decision; kept for history, not in force | struck-through in place, pointing at the new ADR |
| **skipped** | ruled out at this scale, no trigger | **Skipped** list |

A decision moves **proposed → accepted** only after the owner sign-off its note calls for. It moves
**deferred → accepted** only when its flip trigger actually fires.

### Adding a decision

1. Append a row to **Adopted now** with the next `ADR-<n>`, a one-line **Decision** and a one-line
   **Rationale** (cite the backlog/gap-analysis item that drove it).
2. If it is not ready to execute, add it as **proposed** (its own heading + a ⚠️ owner-decision note)
   instead, and promote it to the table once accepted.
3. If it is a "not now" choice, put it in **Deferred** with a concrete **flip trigger**, or in
   **Skipped** if there is no trigger.

Keep it to one line per decision. Detail belongs in the referenced doc, not here.

### Superseding a decision

- Never silently edit an accepted decision to mean something new. Instead add a **new** `ADR-<n>` that
  states the replacement, then mark the old row **superseded by ADR-<n>** (strike-through) and leave
  it in place. The history of what was true, and when it changed, stays visible.
- A superseding ADR names the owner call / date that authorized the change (as `ADR-3` records the
  2026-11-14 transport decision).

### Per-phase flip-trigger review

Deferred items carry a flip trigger precisely so they are not forgotten. At the **start of each
phase** (and whenever a phase's scope is cut), walk the **Deferred** table and, for each row, ask:
*has this phase's work made the trigger true?*

- **Yes** → promote it to an accepted `ADR-<n>` and schedule the work in that phase's plan.
- **No** → leave it deferred; if the trigger is now wrong, update the trigger wording (not the
  decision).

This review is the mechanism that keeps "defer with a trigger" honest — a deferred decision that is
never re-examined is just a decision that was quietly skipped.
