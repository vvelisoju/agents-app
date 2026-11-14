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
