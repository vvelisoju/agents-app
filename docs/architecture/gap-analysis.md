# Gap Analysis — current repo vs. the generalized agentic-platform target

> **Status:** Review draft · **Date:** 2026-11-14 · **Reads with:** [current-state.md](current-state.md),
> [target-architecture.md](target-architecture.md), [implementation-roadmap.md](implementation-roadmap.md).
> **Method:** each master-prompt target component (§4A–L, §5, §6, §8, §9) was assessed against the real
> code, then an architect pass checked for over-engineering and sequenced the result. **No code changed.**

This document answers master-prompt deliverables **#4 (architecture gaps)**, **#5 (missing foundational
components)**, **#17 (technology decisions)** and **#20 (risks / trade-offs)**. The guiding principle —
from the master prompt itself — is **modular-monolith-first, lightest-sufficient, additive**: build the
foundation, adopt a heavy standard only when a concrete trigger justifies it, and never regress the
working reply loop.

---

## 1. The headline

The product today is a **single-turn reply bot**: one LLM completion per inbound message, no tools, no
workflows, no triggers beyond "a message arrived." The master prompt asks for an **agent operating
system**: specs, a runtime, tools, workflows, triggers, memory, policy, observability, multi-agent.

The gap is therefore **large but not a rewrite** — the repo has three high-value seams to build *onto*
(the **channel-adapter registry**, the **single `askClaude` chokepoint** in [brain.ts](../../server/src/lib/brain.ts),
and the **pure prompt/training functions** in [training.ts](../../server/src/lib/training.ts)). Everything
below layers additively around those. **Two things must happen before any agentic feature, though:**
(1) close the **live security holes** and the **double-reply bug**, and (2) replace **`prisma db push`
with real migrations**, because every new capability needs new tables and the current boot script runs
`prisma db push --accept-data-loss` against the **live prod Postgres**.

---

## 2. Component-by-component gap table

Legend — **State:** 🟢 implemented · 🟡 partial · 🔴 absent. **Priority:** P0 (foundational / fixes a live
hole) → P3 (aspirational). "Phase" refers to [implementation-roadmap.md](implementation-roadmap.md).

| # | Master-prompt component | State | Gap (one line) | Recommended *lightest* approach | Pri | Phase |
|---|---|---|---|---|---|---|
| 4C | **Agent Runtime** | 🟡 | Single-turn only; provider hardcoded; no `executionId`/version/trace; no budget gate | Keep single-turn as default `executionMode:'reply'`; evolve `brain.ts` into a **model gateway** (timeout, retry, token capture); add a **budget gate**; a bounded tool loop is an opt-in sibling path | **P0** | 2 |
| 4J | **Multi-tenancy & Identity** | 🟡 | App-level `orgId` only (no RLS; 4 tables lack `orgId`); RBAC at 5/30 routes; plaintext never-expiring tokens; plaintext channel secrets; no OAuth | One central `authz` middleware; **hash+expire+rotate** tokens; **`ConnectedAccount`** table with AES-256-GCM; backfill `orgId`; OAuth2 **per connector**, later | **P0** | 1,3 |
| 4K+L | **Policy Engine + HITL + Security** | 🟡 | Approval exists only as per-draft approve/skip + `NEEDS_HUMAN`; no policy engine, audit log, per-tenant cost cap; SSRF + unauth widget/ws live | One `authorize(ctx,action)` default-deny chokepoint; generalize drafts into an **`Approval`** queue; **`AuditLog`**; per-tenant budget; fix live holes first | **P0** | 0,3 |
| 4L | **Observability & Evaluation** | 🟡 | `console.*` only; `UsageEvent` is a bare counter; token usage is **captured then discarded** in `brain.ts`; no eval metrics | Return token counts from `brain.ts`; extend `UsageEvent` into an **execution-trace** row (one per `processInbound`, all outcomes); **pino** logs; metrics by SQL; OTel later | **P0** | 2 |
| 5+9 | **Tech decisions + Non-functional** | 🟡 | `prisma db push` vs prod; unpinned deps; **lost per-conversation lock → double-reply**; no horizontal scale; no DR drill | **Migrations**, **pin deps**, **restore the per-conversation lock**, Postgres-as-queue, pino; split the WhatsApp worker only on a measured trigger | **P0** | 0,1 |
| 4B+6 | **Agent Spec + Lifecycle** | 🟡 | Config is a flat `Agent` row + training; no version, no spec, no rollback; `Agent.status` already means *connection* state | One **zod `AgentSpec`** = serialization of existing rows; **`AgentVersion`** snapshot + `currentVersionId` (rollback); **4-state** lifecycle on a *new* column; live-edit stays default | **P1** | 4 |
| 4A | **Agent Studio / Builder** | 🟡 | Templates + config + guided setup exist; NL only via `learn.ts`; no visual builder | Generalize `learn.ts` into **`generateSpecFromNL()`** emitting validated spec (never code); defer the visual builder until spec+workflow exist | **P1** | 4 |
| 4D | **Workflow Engine** | 🔴 | No engine, queue, scheduler, or run-state | One **Postgres `WorkflowRun`** state machine + a single in-process ticker (`SKIP LOCKED`); code handlers, not a DSL; reply loop stays inline | **P1** | 5 |
| 4H | **Event & Trigger Engine** | 🔴 | Only an inbound-message trigger, handled inline; realtime is UI fan-out, not a bus | **CloudEvents-shaped envelope** (type only) + `Trigger`/`Job` tables + node-cron + webhook ingestion (Meta/Razorpay); no broker | **P1** | 5 |
| 4E | **Tool & Integration Registry** | 🔴 | No registry, no function-calling; "tools" are faked text tokens | In-process **typed `Tool` registry** mirroring the channel registry + native Anthropic tool-use; first tools wrap existing capabilities; MCP-shaped for later | **P2** | 6 |
| 4I | **Memory & Knowledge** | 🟡 | "Knowledge" = full training stuffed into every prompt; "memory" = last-8 truncation; no RAG | Keep prompt-stuffing with a **token-budget guard**; add **pgvector `KnowledgeChunk`** *in existing Postgres* only when a KB outgrows the prompt; define memory scopes | **P2** | 6 |
| 4F | **MCP** | 🔴 | None; and there are no tools for it to expose yet | **Client-only, allowlisted**, behind the tool registry — *adopt-later*; never expose an MCP server now | **P2** | 6/7 |
| 4G | **Multi-agent & A2A** | 🔴 | One agent per channel; no delegation | Many-agents-per-org + **in-process `delegate()`** to a shared task record; **skip the external A2A protocol** | **P3** | 7 |
| 8 | **E2E scenario validation** | 🟡 | Only scenario 1 (WhatsApp agent) runs; 2/6/7 reachable; 3/4/5 absent | One **trigger→runtime→tools→policy→send** spine; a scenario = a Spec + ≤1 Tool + 1 Trigger; see [target-architecture.md §12](target-architecture.md) | **P1** | 5,6 |

---

## 3. Missing foundational components (master-prompt deliverable #5)

Ranked by how much else depends on them. These are the "build these first" items.

1. **Migration discipline** (replace `prisma db push --accept-data-loss`). *Hard blocker* — every new
   table below is unsafe against live prod until this exists. → Phase 1.
2. **Model gateway** (provider-abstracted `brain.ts` + token/cost capture + retry + budget gate). The
   chokepoint the runtime, cost-caps and observability all hang off. → Phase 2.
3. **Execution-trace record** (extend `UsageEvent`; one row per run, all outcomes). The data source every
   later async/retrying feature and every eval metric needs. → Phase 2.
4. **Authorization chokepoint** (`authorize(ctx,action)`, default-deny) + **`AuditLog`** + generalized
   **`Approval`** queue. Must exist before tools can act safely. → Phase 3.
5. **Connected-account / credential store** (encrypted) + token hardening + `orgId` backfill. → Phase 1/3.
6. **Agent Spec** (zod) + **`AgentVersion`** snapshot/rollback. The definition the Studio, tools and
   workflows all reference. → Phase 4.
7. **Event/trigger/workflow spine** (Postgres `Job`/`Trigger`/`WorkflowRun` + node-cron + webhooks). The
   one enabler of scheduled monitors and the two written outbound plans. → Phase 5.
8. **Tool registry + bounded tool loop** + **retrieval-on-trigger** (pgvector when needed). → Phase 6.

---

## 4. Technology decisions (master-prompt deliverable #17)

The architect pass rendered a verdict on every standard in master-prompt §5, judged for a **tier-2-SMB,
single-process, one-LLM-call-per-message** product. Each "adopt-later" carries an explicit flip trigger.

### Adopt now (low cost, high payoff, mostly already in-repo)
| Decision | Why |
|---|---|
| **Prisma migrations** (kill `db push --accept-data-loss`) | Top operational hazard + hard blocker for every new table against live prod |
| **Pin deps + commit lockfile** | Most server deps are `"latest"` → non-deterministic builds |
| **pino structured logging** + correlation/tenant IDs + redaction | Cheapest way off `console.*`; redaction stops leaking tokens/PII |
| **Per-conversation async lock** (restore the prototype's lost queue) | Fixes the confirmed double-reply bug |
| **zod `AgentSpec`** (emit JSON Schema later via `zod-to-json-schema`) | zod already a dep; validates the spec at publish — AJV now is redundant |
| **Per-tenant cost/rate limits** (DB counters over `UsageEvent`) | Bounds the unauthenticated-widget Claude spend |
| **Postgres-as-queue** (`SELECT … FOR UPDATE SKIP LOCKED`) + node-cron | Durable jobs/triggers/outbound with zero new infra, on SQLite-dev and Postgres-prod alike |

### Lighter alternative (get the value without the heavy dependency)
| Standard | Lighter-alt chosen |
|---|---|
| External KMS/Vault | **App-level AES-256-GCM** (env key + `keyId` for rotation) |
| JWT/OIDC for own login | **Hashed + expiring bearer token**, rotate on login |
| OPA/Cedar/Casbin policy engine | **In-repo `authorize()`** + a small per-action table (default-deny) |
| CloudEvents SDK/broker | **Envelope field-shape only** (a TS type), broker-ready later |
| Full MCP mesh | **In-process typed Tool registry** + native Anthropic tool-use (kept MCP-shaped) |

### Adopt later (named trigger required)
| Standard | Flip trigger |
|---|---|
| **OpenTelemetry SDK + collector** | A worker/queue/multi-replica, or a hosted backend to export to |
| **pgvector + embeddings** (in existing Postgres) | A tenant's training exceeds the prompt budget, or PDF/catalog upload |
| **MCP (client-only, allowlisted)** | A specific external/third-party tool server is needed |
| **OAuth2/OIDC per connector** | The Instagram/Gmail/Google-Calendar adapter actually ships |
| **Postgres RLS** | Post-migration defense-in-depth (+ a per-request tenant GUC) |
| **Redis / BullMQ** | Going multi-replica, or a heavy throttled sender |
| **Separate worker / session sharding** | Measured RSS/agent hits a validated % of the box ceiling |

### Skip (not justified at this scale)
**Temporal** (durable-workflow cluster for 1–3-step flows) · **Kafka** (no firehose, one replica) ·
**Google A2A protocol** (all agents first-party in one process) · **LangGraph** (heavy lock-in over one
clean chokepoint) · **External IdP** (Keycloak/Auth0/Ory — in-repo authz suffices below hundreds of tenants).

---

## 5. Over-engineering guardrails — what NOT to build yet

The master prompt explicitly warns against introducing every technology. The architect pass flagged these
specific temptations (each with the lighter path already chosen above):

- **The full 10-state lifecycle + AJV + per-run version pinning.** It fights the "edit applies to the next
  message, no retrain" promise. → 4 states + zod + snapshot/rollback.
- **Temporal / Kafka / NATS.** A cluster + workers for a one-call-per-message bot. → Postgres queue + node-cron.
- **A full MCP mesh / exposing an MCP server.** Solves third-party tool interop the repo doesn't have (it
  has *no tools yet*). → in-process registry first; MCP client-only later.
- **Google A2A (agent cards, per-agent HTTP servers).** → internal `delegate()`; and even that is P3.
- **Redis now.** A new stateful dependency for a single process (and `docker-compose` already declares an
  unused Redis — delete it). → Postgres for queue/rate-limit/jobs.
- **Full OTel stack.** The "distributed trace" is a single span at `numReplicas=1`. → pino + DB execution rows.
- **pgvector pipeline built up front.** Most tier-2 SMBs fit in a page or two that prompt-stuffing handles
  *more accurately*. → add only on the token-budget trigger.
- **A visual drag-and-drop workflow builder now.** There are no multi-step nodes to wire. → the existing
  `TrainingPanel` + `SetupGuide` *are* today's builder.
- **The full 11-stage NL pipeline.** Four stages return "none" (no tools/workflows/per-capability
  permissions yet). → collapse to requirement → extraction → spec-gen → validation → simulation → deploy.
- **Microservices / session sharding now.** Premature at one container. → modular monolith with clean
  `triggers/ tools/ outbound/ policy/` boundaries so any one can be extracted later.
- **Scenarios 4 (flight) and 3 (LinkedIn DM).** Flight is off-mission; LinkedIn DM automation has no
  official API and risks permanent bans. → skip both.

---

## 6. Top risks & trade-offs (master-prompt deliverable #20)

| # | Risk | Why it matters | Mitigation |
|---|---|---|---|
| 1 | **`prisma db push --accept-data-loss` on every boot vs. live prod** | A bad schema edit silently drops prod columns; also the hard blocker for all new tables | Baseline migrations against a **shadow** of prod; switch entrypoint to `prisma migrate deploy`; CI guard forbids `--accept-data-loss` on the prod path |
| 2 | **Live exploitable holes**: unauth `/ws` (QR/account takeover + cross-tenant leak), unauth widget (unbounded spend), SSRF in `learn.ts`, plaintext secrets | Exploitable on the deployed instance *now* | Phase 0 fixes, **zero new tables**, ship immediately |
| 3 | **Double-reply regression** | The prototype's per-conversation queue was lost; Telegram is fire-and-forget, no lock anywhere → two rapid messages = two sends | Restore an in-process `Map<convKey,Promise>` lock (Phase 0) |
| 4 | **Money/safety path untested** | `askClaude` is never mocked → auto-send, `NEEDS_HUMAN`, `[[ALERT]]`, `{{LINK}}` have no unit test | Land mock-`askClaude` regression tests **before** the `brain.ts`→gateway refactor |
| 5 | **Over-standardization** | Temporal/Kafka/MCP-mesh/A2A/full-OTel multiply failure modes at `numReplicas=1` | The verdicts in §4; spend the complexity budget on correctness/observability/eventual worker split |
| 6 | **Single-process ceiling** | 1 Chromium/agent (~25–50/box) + in-memory WS/session/rate-limit maps → horizontal scale is a coordinated change, not a flag | Keep the adapter seam; split the worker on a *measured* trigger; move the lock to Postgres advisory locks *in the same change* |
| 7 | **Instant-edit vs versioned-publish tension** | Mandatory versioning breaks the "applies to next message" promise | Live mode stays the default (`currentVersionId=null`); publish is explicit/optional |
| 8 | **DR gap** | `whatsapp-web.js` `LocalAuth` on a filesystem volume; Railway Postgres backups unverified | Run an actual restore drill; confirm session persistence survives a redeploy |
| 9 | **Model/SDK drift** | `@anthropic-ai/sdk` is `"latest"`; `output_config.effort` cast `as any`; future-dated model ids | Pin the SDK; cover the gateway with tests; keep model id in config |
| 10 | **Provider ToS / ban risk** | `whatsapp-web.js` bulk/cold send (Trackly path) risks *permanent* bans; LinkedIn hostile to automation | Reply-only on the QR line; business-initiated marketing via the official Cloud API + approved templates + opt-in; LinkedIn content-only |

---

## 7. What this means in one paragraph

Build the **foundation**, not the cathedral. Close the live holes and the double-reply bug (Phase 0),
get on migrations (Phase 1), turn `brain.ts` into a gateway with cost capture and a budget gate plus
real logging (Phase 2), add the policy/identity/approval/audit layer (Phase 3), then the Agent Spec +
versioning + NL builder (Phase 4), then the Postgres-backed event/trigger/workflow spine that unlocks the
two outbound plans and scheduled monitors (Phase 5), then the tool registry + bounded loop + retrieval
(Phase 6). Everything heavier — Temporal, Kafka, a full MCP mesh, A2A, OAuth connectors, RLS, OTel, a
separate worker — waits behind an explicit, recorded trigger (Phase 7). At every step the change is
**additive** around the working reply loop, the channel-adapter seam, the training model, and the
alert/escalation/approval features, so nothing that works today regresses.
