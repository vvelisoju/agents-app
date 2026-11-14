# Policy & Audit (POL-19)

Reference for the platform's authorization, approval, and audit subsystem. Describes
the code as shipped. Source of truth lives in `server/src/policy/`, `server/src/middleware/authz.ts`,
`server/src/lib/audit.ts`, `server/src/lib/retention.ts`, and the `Approval` / `AuditLog`
models in `server/prisma/schema.prisma`.

Design stance: **default-deny**, **approve-before-act**, **append-only audit**. The engine is a
pure, data-driven matrix (no DB, no side effects) so new roles/actions are a one-line change and
are unit-testable in isolation.

---

## 1. Role permission matrix

`server/src/policy/engine.ts` holds the single source of truth. `authorize(ctx, action)` reads
`PERMISSION_MATRIX[action][role]` and returns `{ decision, reason }`. There are two roles
(`owner`, `member`) and three possible decisions (`allow`, `require_approval`, `deny`).

**Default-deny is structural:** an unknown action (stale/forged value not in the matrix) and an
unknown role both fall through to `deny` before the matrix is consulted.

| Action (`Action` union) | Meaning | owner | member |
|---|---|---|---|
| `send_reply` | emit an outbound channel reply | allow | allow |
| `approve` | decide a pending Approval | allow | allow |
| `train_edit` | edit an agent's training / knowledge | allow | allow |
| `agent_create` | create a new agent | allow | allow |
| `agent_delete` | delete an agent (destructive) | allow | **deny** |
| `org_admin` | org-level settings / configuration | allow | **deny** |
| `team_manage` | invite / remove / re-role teammates | allow | **deny** |
| `billing` | billing, plans, payment methods | allow | **deny** |
| `lead_export` | bulk export of lead / contact PII | allow | **deny** |
| `connected_accounts` | manage OAuth / connected accounts | allow | **deny** |
| `audit_view` | read the audit log | allow | **deny** |

Members get day-to-day operational actions; everything privileged or destructive is owner-only.
The matrix currently ships only `allow`/`deny` values — `require_approval` is a defined decision
the engine supports but no row uses yet.

### Enforcement chokepoint

`requirePermission(action)` (`server/src/middleware/authz.ts`) is the Express middleware that
enforces the matrix on privileged routes. It reads `req.user.role`, calls `authorize`, and:

- `allow` → `next()`
- otherwise → writes a `denied:<action>` audit row and returns `403 { error: "not permitted", code: "forbidden" }`

Representative gated routes (action in parens):

- `agents/router.ts` — build/clone (`agent_create`), delete (`agent_delete`), training/version/rollback/watch/outbound edits (`train_edit`)
- `approvals/router.ts` — approve/reject (`approve`)
- `workflows/router.ts` — run approve (`approve`)
- `leads/router.ts` — `/export` (`lead_export`)
- `connectors/router.ts`, `linkedin/router.ts` connect/disconnect, `routes.ts` `DELETE /api/connected-accounts/:id` (`connected_accounts`)
- `routes.ts` `PATCH /api/org` (`org_admin`), `GET /api/audit` (`audit_view`)

---

## 2. Approval lifecycle (approve-before-act)

Privileged/side-effecting actions do not run directly — they create an `Approval` row and wait for
a human decision. Code: `server/src/policy/approvals.ts`, `approvalExecutor.ts`.

### States

`Approval.status` (schema default `pending`):

```
pending ──approve──▶ approved ──executor──▶ executed
   │
   ├──reject───────▶ rejected
   │
   └──expire───────▶ expired     (expiresAt passed; can no longer execute)
```

| Status | Set by | Terminal? |
|---|---|---|
| `pending` | `createApproval()` | no |
| `approved` | `decideApproval(..., 'approved')` | no (executor may advance it) |
| `rejected` | `decideApproval(..., 'rejected')` | yes |
| `expired` | `decideApproval` (lazy, on decide) or the retention sweep | yes |
| `executed` | the consumer's executor / handler, after the gated action actually runs | yes |

### Decisions are idempotent

`decideApproval(orgId, id, decision, userId)`:

1. Not found → `{ ok:false, reason:'not_found' }`.
2. `status !== 'pending'` → `{ ok:false, reason:'already_decided' }`. A non-pending approval is
   never re-decided and **never executed twice**.
3. `expiresAt` in the past → flips to `expired`, returns `{ ok:false, reason:'expired' }`.
4. Otherwise sets `status`, `decidedByUserId`, `decidedAt`; writes an `approval.<decision>` audit
   row; and on `approved` calls `fireApproved(approval)`.

The HTTP surface (`modules/approvals/router.ts`) maps `not_found → 404` and the other failures →
`409`. Approving from the inbox also resumes any `workflowRun` parked on that approval, so the two
entry points are equivalent.

### Who creates approvals

`createApproval()` callers set `actionType` from the originating side-effect:

- `tools/execute.ts` — any `write` / `external` tool (payload `{ tool, input }`)
- `modules/outbound/service.ts` — bulk/outbound sends
- `jobs/runner.ts` — scheduled/gated jobs

`Approval.actionType` free-text examples: `send_reply | bulk_send | booking | delete | financial | social_publish`, plus a tool's `approvalAction` or its raw side-effect class.

### The executor seam (POL-10)

`approvalExecutor.ts` is a decoupling seam so **policy never imports tools** (no cycle):

- A consumer registers one executor via `onApproved(fn)`.
- `decideApproval` calls `fireApproved(approval)` only after the row flips to `approved`.
- `fireApproved` runs the executor **exactly once**, **best-effort**: a throw is caught and logged
  (`approval executor failed`), never propagated back into the decision path.

The live consumer is `tools/approvalRunner.ts` (`registerApprovalRunner()`): it parses the stored
`{ tool, input }`, reconstructs `{ agent, orgId }` context, and calls `executeTool(..., { preApproved: true })`
to run the previously-gated tool for real. Approvals whose payload has no `tool` (e.g. `bulk_send`)
are handled by the workflow-resume path instead.

---

## 3. No model-emitted token authorizes an action

A core invariant of the agentic loop (`server/src/engine/agentic.ts`): **no token the model emits
can authorize a privileged action.** The model can *request* a tool, never *commit* one.

Mechanism, in `tools/execute.ts`:

- Every tool runs through the single `executeTool` interface.
- `read` tools run inline.
- `write` / `external` tools, when `preApproved` is not set, **create an Approval and return
  `{ ok:false, code:'pending_approval', approvalId }` without acting.**
- The agentic loop surfaces `pending_approval` as a step outcome; it never force-runs the tool.
- The tool actually executes only later, through the approval executor seam (§2), with
  `preApproved: true` — i.e. only after a human with the `approve` permission decided it.

Reinforcing rules from the same loop: only owner-enabled tools are offered (TOOL-14); per-tenant
budget and hard turn/tool-call caps bound the run (TOOL-21); tool results are untrusted data wrapped
in `tool_result` blocks, never concatenated into the system prompt (TOOL-20). The single-turn reply
path never calls `executeTool` at all.

---

## 4. Audited actions

`server/src/lib/audit.ts` — `audit(event)` appends one `AuditLog` row per security-relevant action.

Properties:

- **Append-only / tamper-evident:** the app only ever inserts `AuditLog` rows; it never updates or
  deletes them (pruning aside — §5).
- **Fire-and-forget:** `audit()` returns `void` and **never throws into the caller**. The insert
  runs on its own promise; a failure becomes `log.error('audit.write_failed', ...)` and the business
  action proceeds.
- **Secrets never land in the trail:** `metadata` is passed through `redact()` (the logger's key
  list — token/password/authorization-type fields) before being `JSON.stringify`'d into
  `metadataJson`. Non-serializable metadata (cycles, BigInt) is replaced with an error marker rather
  than losing the whole row.

### `AuditLog` fields

| Field | Notes |
|---|---|
| `orgId` | tenant the action belongs to (required — trail is per-org) |
| `actorType` | `user` \| `system` \| `agent` (schema default `user`) |
| `actorUserId` | the human who acted, when applicable |
| `action` | short verb, e.g. `approval.approved`, `agent.delete` |
| `targetType` / `targetId` | the kind + id of the thing acted on |
| `metadataJson` | redacted, JSON-encoded extra context |
| `ip` | request IP, when available |
| `createdAt` | insert time; indexed with `orgId` |

### Actions currently emitted

| `action` | Where | target |
|---|---|---|
| `denied:<action>` | `middleware/authz.ts` | — (RBAC denial) |
| `approval.approved` / `approval.rejected` | `policy/approvals.ts` | `approval` |
| `workflow.<step>` | `modules/workflows/service.ts` | `workflow_run` |
| `org.rename` | `routes.ts` | — |
| `connected_account.revoke` | `routes.ts` | `connected_account` |
| `agent.tools_update` | `modules/agents/router.ts` | `agent` |
| `agent.apply_spec` / `agent.publish_version` / `agent.rollback` / `agent.clone` / `agent.lifecycle` / `agent.delete` | `modules/agents/router.ts` | `agent` |
| `booking.cancel` | `modules/agents/router.ts` | `booking` |
| `watch.create` / `watch.delete` | `modules/agents/router.ts` | `watch` |
| `outbound.connection_upsert` / `outbound.campaign_start` | `modules/agents/router.ts` | `agent` |
| `lead.export` | `modules/leads/router.ts` | — |
| `connector.create` / `connector.delete` / `connector.add_op` | `modules/connectors/router.ts` | `connector` / `connector_op` |
| `linkedin.connect` / `linkedin.disconnect` | `modules/linkedin/router.ts` | `agent` |
| `linkedin.action_create` / `linkedin.action_approve` / `linkedin.watch_create` | `modules/linkedin/router.ts` | `linkedin_action` / `linkedin_watch` |

Read surface: `GET /api/audit` (owner-only via `audit_view`) returns the org's 100 most recent rows,
newest first.

---

## 5. Retention

`server/src/lib/retention.ts` registers idempotent sweeps on the shared maintenance ticker
(`lib/maintenance.ts`, driven by `index.ts`). Sweeps touch only terminal/processed/expired rows and
never in-flight work.

| Concern | Window (env, default) | Behavior |
|---|---|---|
| Pending approvals | — | `expiresAt < now` and still `pending` → flipped to `expired` (can no longer execute) |
| Audit log | `APPROVAL_RETENTION_DAYS`, **180** | rows older than the window are deleted |
| Default for other sweeps | `RETENTION_DAYS`, **90** | domain events, terminal jobs, terminal workflow runs, traces, outbound ledger, expired contact memory |

Notes:

- The `expire-and-prune-approvals` sweep handles both approval expiry and audit pruning.
- `Approval` rows themselves are not bulk-deleted by a retention sweep — only their status is
  advanced to `expired`; decided approvals persist for the record.
- Audit retention (180 days) is deliberately longer than the general 90-day window.
- All windows are env-overridable; the audit trail is append-only up to its retention horizon.
