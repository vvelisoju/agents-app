# Data Model

Reference for every Prisma model in `server/prisma/schema.prisma`. One model = one table.

## Datasource & environments

- **Dev / test** use `server/prisma/schema.prisma` with the **SQLite** provider (`provider = "sqlite"`, `url = env("DATABASE_URL")`) so it runs with zero setup. Tests clear all tables before each file.
- **Prod** runtime and migrations use `server/prisma/schema.postgres.prisma` — the **PostgreSQL** variant. It is **auto-generated** from `schema.prisma` by `npm run db:gen-pg`; the two files keep identical models, so never edit the postgres file by hand — change `schema.prisma` and regenerate.
- **Prod schema evolution is via `prisma migrate deploy`** (applies the committed, reviewed migrations under `server/prisma/migrations/`). Prod **never** uses `db push` — `db push` diffs and mutates the live schema without a migration record and can drop data, so it is dev-only.

## Tenant isolation

The tenant root is **`Org`** (its own `id` is the tenant key; it carries no `orgId`). Most tables carry an **`orgId`** column for direct tenant scoping and analytics; queries filter on it. A model **without** `orgId` is scoped indirectly through its parent relation (noted per model below). Several `orgId` columns on hot/child tables are **nullable** (`String?`) because they were added additively and backfilled; they are populated at write time.

---

## Core

### Org
Tenant root — one customer account. **orgId: n/a (it is the tenant).**
- Key fields: `id`, `name`, `createdAt`.
- Relations: `users[]`, `agents[]`, `subscription?`.

### User
A person who can sign in to an org. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `phone`, `passwordHash`, `token`, `tokenHash?`, `tokenExpiresAt?`, `lastLoginAt?`, `role` (default `owner`).
- Uniques: `phone` (normalized 10-digit local mobile), `token`, `tokenHash` (SEC-4: hashed bearer token), all `@unique`.
- Cascade-deletes with its `Org`.

### Subscription
Per-org plan / limits. **orgId: yes (required, one per org).**
- Key fields: `id`, `orgId`, `plan` (default `free`), `status` (default `active`), `maxAgents` (default 10), `createdAt`.
- Unique: `orgId` `@unique` (1:1 with `Org`).

### Agent
A configured bot: channel, status, behavior, alerting. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `name`, `channelType` (default `whatsapp-web`), `status` (default `draft`), `autoSend`, `executionMode` (`reply` default | `agentic`), `enabledToolsJson?` (JSON `string[]` of enabled tools), `currentVersionId?` (active `AgentVersion` pointer; null = live-edit), `lifecycleStatus` (`draft|active|paused|archived`), `paused`, `awayMessage?`, `hoursStart?`/`hoursEnd?`, `timezone` (default `Asia/Kolkata`), `alertNumber?`, `alertCondition?` (owner's-own-words trigger), `channelConfig?` (JSON per-channel settings), `createdAt`.
- Relations: `profile?`, `sources[]`, `conversations[]`, `session?`, `versions[]`.

### AgentVersion
Immutable published snapshot of an agent's full config (AgentSpec JSON) for history + one-click rollback. **orgId: no — scoped via `agentId`.**
- Key fields: `id`, `agentId`, `version` (Int), `specJson`, `status` (default `published`), `note?`, `createdByUserId?`, `createdAt`.
- Unique: `@@unique([agentId, version])`. Index: `@@index([agentId])`.

### Conversation
A thread between an agent and one contact. **orgId: yes (required).**
- Key fields: `id`, `agentId`, `orgId`, `contactNumber`, `contactName?`, `lastMessageAt`, `takenOver`, `muted`, `leadStatus` (default `new`), `leadNotes?`, `alertedAt?` (set when urgent lead pinged owner; dedupe + 🔥 badge).
- Unique: `@@unique([agentId, contactNumber])` (one thread per contact per agent).

### Message
A single inbound/outbound message. Highest-growth table. **orgId: `String?` (nullable, backfilled).**
- Key fields: `id`, `orgId?`, `conversationId`, `agentId`, `direction` (`inbound|outbound`), `body`, `status` (`received|draft|sent|skipped|needs_human`), `createdAt`.
- Indexes: `@@index([orgId])`, `@@index([conversationId, createdAt])` (history reads).

### TrainingProfile
Per-agent persona / guardrails. **orgId: `String?` (nullable).**
- Key fields: `id`, `orgId?`, `agentId`, `instructions`, `restrictions`, `tone`, `language`, `escalationKeyword` (default `NEEDS_HUMAN`), `updatedAt`.
- Unique: `agentId` `@unique` (1:1 with `Agent`). Index: `@@index([orgId])`.

### TrainingSource
A knowledge item feeding the agent (fact/link/faq). **orgId: `String?` (nullable).**
- Key fields: `id`, `orgId?`, `agentId`, `type` (`fact|link|faq`), `dataJson` (shape depends on type), `enabled`, `createdAt`.
- Index: `@@index([orgId])`.

### ChannelSession
Channel connection state for an agent (e.g. WhatsApp QR link). **orgId: `String?` (nullable, backfilled).**
- Key fields: `id`, `orgId?`, `agentId`, `status` (default `pending_qr`), `phoneNumber?`, `lastConnectedAt?`, `updatedAt`.
- Unique: `agentId` `@unique` (1:1 with `Agent`). Index: `@@index([orgId])`.

### PhoneVerification
One-time WhatsApp OTP codes (signup + password reset); code is bcrypt-hashed. **orgId: no (pre-auth, no org yet).**
- Key fields: `id`, `phone`, `codeHash`, `purpose` (`signup|password_reset`), `attempts`, `expiresAt`, `verifiedAt?`, `consumedAt?`, `createdAt`.
- Index: `@@index([phone, purpose])`.

---

## Observability

### UsageEvent
One row per engine run — the end-to-end execution trace (model/token/cost/latency/outcome). **orgId: yes (required).**
- Key fields: `id`, `orgId`, `agentId`, `type` (default `reply`), `createdAt`.
- Trace fields (all nullable, additive): `executionId?`, `model?`, `provider?`, `inputTokens?`, `outputTokens?`, `costMicros?`, `latencyMs?`, `outcome?` (`sent|draft|needs_human|away|error|ignored`), `trigger?` (`channel-event|cron|webhook`), `conversationId?`, `agentVersion?`, `errorCode?`, `approvalState?` (`auto|draft|approved|skipped`).
- Index: `@@index([orgId, createdAt])` (analytics aggregation).

### ExecutionStep
One row per tool invocation on the agentic path, keyed to the run's `executionId` (reply-mode runs write zero rows). Input stored redacted; no secrets. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `agentId`, `executionId`, `stepIndex`, `toolName`, `inputJson` (redacted, default `{}`), `outcome` (`ok|invalid_input|invalid_output|timeout|denied|pending_approval|error`), `approvalState?` (`inline|pending_approval|pre_approved`), `latencyMs?`, `createdAt`.
- Indexes: `@@index([executionId, stepIndex])`, `@@index([orgId, createdAt])`.

---

## Policy / Identity

### Approval
Generalized human-in-the-loop approval queue (draft reply is the first instance; bulk send / booking / delete / financial become rows too). **orgId: yes (required).**
- Key fields: `id`, `orgId`, `agentId?`, `actionType` (`send_reply|bulk_send|booking|delete|financial|social_publish`), `payloadJson` (default `{}`), `status` (`pending|approved|rejected|expired|executed`), `requestedBy?`, `decidedByUserId?`, `decidedAt?`, `expiresAt?`, `createdAt`.
- Index: `@@index([orgId, status])`.

### AuditLog
Append-only trail of security-relevant actions. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `actorType` (default `user`; `user|system|agent`), `actorUserId?`, `action`, `targetType?`, `targetId?`, `metadataJson?`, `ip?`, `createdAt`.
- Index: `@@index([orgId, createdAt])`.

### ConnectedAccount
Encrypted external credentials (channel tokens, OAuth) as an AES-256-GCM blob. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `agentId?`, `provider` (`telegram|meta|google|...`), `encBlob` (ciphertext), `keyId?`, `scopes?`, `status` (default `active`), `expiresAt?`, `createdAt`.
- Indexes: `@@index([orgId])`, `@@index([agentId])`.

---

## Phase-5 spine (Event / Trigger / Workflow — gated behind `WORKFLOW_ENABLED`)

### DomainEvent
Transactional outbox (CloudEvents field-shape); a dispatcher drains unprocessed rows and matches them to Triggers. Not a broker; written fire-and-forget. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `source`, `type` (e.g. `message.received`), `subject?`, `dataJson` (default `{}`), `idempotencyKey?` `@unique`, `processedAt?`, `createdAt`.
- Indexes: `@@index([processedAt])`, `@@index([orgId, type])`.

### Trigger
Binds a source signal (event/cron/webhook) to a registered workflow handler. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `agentId?`, `kind` (`event|cron|webhook`), `eventType?`, `cronExpr?`, `filterJson` (default `{}`), `handlerName`, `enabled`, `nextRunAt?`, `createdAt`.
- Indexes: `@@index([enabled, kind])`, `@@index([eventType])`.

### Job
The runner's claimable unit of work; lease/leaseUntil give single-owner execution + crash reclaim. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `workflowRunId?`, `handlerName`, `status` (`pending|leased|running|completed|failed|dead`), `nextRunAt`, `attempts`, `maxAttempts` (default 5), `stateJson` (default `{}`), `lease?`, `leaseUntil?`, `idempotencyKey?` `@unique` (blocks double-enqueue), `lastError?`, `createdAt`, `updatedAt`.
- Indexes: `@@index([status, nextRunAt])`, `@@index([leaseUntil])`, `@@index([orgId])`.

### WorkflowRun
A durable multi-step run (reconstructable/replayable). **orgId: yes (required).**
- Key fields: `id`, `orgId`, `agentId?`, `workflowName`, `status` (`running|sleeping|awaiting_approval|paused|completed|failed|canceled`), `currentStep?`, `stateJson` (default `{}`), `approvalId?`, `startedAt`, `updatedAt`, `finishedAt?`.
- Relation: `steps[]`. Indexes: `@@index([orgId, status])`, `@@index([agentId])`.

### WorkflowStepLog
Append-only step history for a `WorkflowRun`. **orgId: no — scoped via `runId`.**
- Key fields: `id`, `runId`, `stepName`, `result` (`complete|retry|sleep|awaitApproval|fail`), `detailJson` (default `{}`), `createdAt`.
- Cascade-deletes with its `WorkflowRun`. Index: `@@index([runId, createdAt])`.

---

## Scenarios

### Watch
A scheduled website/offer/price monitor; owns one cron `Trigger` on the spine. SSRF-guarded fetch, hashes text, notifies on change. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `agentId`, `url`, `label?`, `cronExpr` (default `0 * * * *`, hourly), `notifyNumber?`, `active`, `triggerId?` (the spine Trigger), `lastHash?`, `lastSnapshot?`, `lastCheckedAt?`, `lastChangedAt?`, `lastChangeNote?`, `createdAt`.
- Indexes: `@@index([orgId])`, `@@index([agentId])`.

### OutboundConnection
A recipient-source connection + send policy for the outbound QR drip (whatsapp-web only, gated by `OUTBOUND_ENABLED`). Token stored encrypted; cannot activate without a persisted risk acknowledgement. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `agentId`, `provider` (default `trackly`), `tokenEnc?` (ciphertext, never logged), `dailyCap` (50), `windowStart` (10) / `windowEnd` (18) local hours, `minGapSec` (240) / `maxGapSec` (420), `warmupDays` (5), `warmupStart` (10), `active` (default false), `riskAckAt?`, `createdAt`.
- Indexes: `@@index([orgId])`, `@@index([agentId])`.

### OutboundSendLog
Send ledger — source of truth for the daily counter and the idempotency guard. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `connectionId`, `campaignId` (default `""`), `recipient` (normalized phone), `status` (`sent|delivered|read|failed|opted_out`), `providerMessageId?`, `createdAt`.
- Unique: `@@unique([connectionId, campaignId, recipient])` (send once per tuple). Indexes: `@@index([orgId, createdAt])`, `@@index([connectionId, createdAt])`.

### OutboundOptOut
STOP/unsubscribe suppression; a suppressed `(agent, phone)` is never sent to by the drip. **orgId: yes (required).**
- Key fields: `id`, `orgId`, `agentId`, `phone`, `createdAt`.
- Unique: `@@unique([agentId, phone])`. Index: `@@index([orgId])`.

### Booking
Appointment booking; a confirmed booking holds a slot (overlap guard rejects overlapping confirmed bookings on the same agent). **orgId: yes (required).**
- Key fields: `id`, `orgId`, `agentId`, `conversationId?`, `contactNumber`, `contactName?`, `startAt`, `endAt`, `status` (`draft|confirmed|cancelled`, default `confirmed`), `note?`, `externalRef?` (dedupe/idempotency key).
- Unique: `@@unique([externalRef])`. Indexes: `@@index([orgId])`, `@@index([agentId, startAt])`.
