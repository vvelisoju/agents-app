# Security posture

How the platform protects tenants, secrets, and the people it messages. Reference for reviewers
and operators. Pairs with [OPERATIONS.md](OPERATIONS.md) and [DATA_MODEL.md](DATA_MODEL.md).

## Tenant isolation

- Every tenant-owned row carries `orgId`; all reads/writes filter by it (see DATA_MODEL.md for the
  per-model flags). Agent-sub-resources (watches, tools, bookings, outbound) additionally scope by
  `agentId`, so one agent's route cannot touch a sibling agent's data in the same org.
- The realtime `/ws` channel authenticates per socket and rejects a subscription to an agent the
  token's org does not own (no cross-tenant QR / message / alert leakage).
- The public widget uses a signed, rate-capped key per agent.

## Authentication & authorization

- Bearer-token auth. Token-hashing + expiry + rotate-on-login infra exists (`lib/tokenAuth.ts`,
  `User.tokenHash`/`tokenExpiresAt`) but is **deferred**: enabling it invalidates all live sessions,
  so it needs a coordinated maintenance window (see OPERATIONS.md).
- A default-deny policy engine (`policy/engine.ts`) gates every privileged action through a single
  chokepoint (`middleware/authz.ts` `requirePermission`). Owners allow all; members are denied
  agent-delete, org-admin, team-manage, billing, lead-export, connected-accounts, and audit-view.
- Every denial and every sensitive action is written to an append-only `AuditLog`.

## Secrets at rest

- AES-256-GCM (`lib/crypto.ts`). Channel tokens (Telegram), outbound source tokens, and
  `ConnectedAccount` credentials are stored encrypted and **never** serialized into an AgentSpec,
  a version snapshot, an API response (`/connected-accounts` returns a masked view), or a log line
  (`lib/log.ts` redacts token/authorization/password/body fields).
- Boot fails fast in production if a required secret is missing (`lib/env.ts`).

## Human-in-the-loop & the agentic boundary

- **No model-emitted token ever authorizes a privileged action.** `[[ALERT]]`, `NEEDS_HUMAN`, and
  `[[REMEMBER:…]]` only notify, reduce capability, or store data — they never grant it.
- Agentic tools with side effect `write`/`external` (send, booking, CRM write, web fetch) return
  `pending_approval` from `tools/execute.ts` and create an Approval row; nothing runs until the
  owner approves (Approvals inbox / Automations). The approval executor then runs the gated action
  exactly once.
- A tool result is untrusted data wrapped in a `tool_result` block, never concatenated into the
  system prompt. The agentic loop is budget-gated before every turn and bounded by turn/tool caps.

## SSRF

- Every outbound fetch (training ingest, `web.fetch_page` tool, website monitor) goes through
  `lib/ssrfGuard.ts`: the target and **every redirect hop** are re-validated against an allowlist
  that rejects loopback, private, link-local, CGNAT, and cloud-metadata ranges.

## Outbound messaging (accepted-risk, opt-in)

- The WhatsApp-web QR drip is OFF by default and, when enabled, mitigated by: a mandatory
  `Reply STOP` footer, a STOP opt-out pre-check that suppresses + confirms + never AI-replies, a
  per-connection written risk acknowledgement required to activate, per-campaign owner approval
  (`bulk_send`), low-volume + warmup + randomized jitter + a send window, ledger idempotency
  (exactly-once per recipient), and a per-tenant budget cap. The Cloud-API BROADCAST path is
  explicitly excluded (a guard test asserts `whatsappCloud` is referenced only by OTP).

## Data lifecycle

- Retention sweeps on an always-on maintenance ticker prune processed outbox events, terminal
  jobs/runs + step logs, execution traces, the outbound ledger, and expired contact memory, and
  expire stale pending approvals (`lib/retention.ts`, window `RETENTION_DAYS`).

## Change safety

- Prod evolves only via additive, forward-only `prisma migrate deploy` — never `db push`. CI guards
  reject destructive schema ops and a stale generated Postgres schema. The test suite runs against
  an isolated SQLite DB and hard-refuses any production/Postgres `DATABASE_URL`.
- Every new runtime behavior is gated (`WORKFLOW_ENABLED`, `MONITOR_ENABLED`, `OUTBOUND_ENABLED`,
  `MEMORY_ENABLED`, or per-agent `executionMode`); with all off the reply path is byte-for-byte
  today's.

## Known deferred items (need an owner action)

- Token hashing / expiry rollout (maintenance window).
- `orgId` NOT-NULL enforcement on the backfilled columns (after a prod-scale rehearsal).
- DR restore drill (Railway backup access).
