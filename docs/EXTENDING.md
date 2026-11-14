# Extending the platform — the seam catalog

> **Status:** reference doc for the shipped code (Phases 0–6). Covers backlog items **PXD-1/2/5/6/7/8/20/26/32**.
> Everything below describes code that exists in `server/src` today. Fields marked _forward-declared_ are in the type but not yet consumed.

The platform grows by **adding a module, not editing the engine**. Every pluggable thing — a channel, a tool, a workflow handler, a trigger, a vertical template — is registered into an in-process `Map` at module load. The core engine never imports a concrete channel/tool/handler; it only ever looks one up by name through a registry.

---

## The core-engine invariant

> **A new channel / tool / workflow handler / trigger / template = one new module + one `register*()` call, with zero core-engine change.**

The engine references the four runtime seams **only** through their registries — never by importing a concrete adapter/tool/handler module:

| Engine site | How it reaches the seam | Never does |
|---|---|---|
| `modules/agents/router.ts` (channel send, agentic tool list) | `getAdapter(type)`, `listTools()`, `getTool(name)` | `import '../../channels/whatsapp'` |
| `jobs/runner.ts` (workflow runner) | `getWorkflow(job.handlerName)` | import a handler module |
| `jobs/scheduler.ts` + `triggers/dispatcher.ts` | read `Trigger` rows, dispatch by `handlerName` | hardcode a handler |

Concrete modules are pulled in **once**, at boot, through barrel imports that exist only to run the `register*()` side effects:

- `index.ts` → `import './channels/whatsapp'`, `import './channels/linkedin'`; `app.ts` → `import './channels/website'`, `import './channels/telegram'`
- `index.ts` → `import './tools/builtin'` (barrel re-exports each tool file)
- `index.ts` → `import './workflow/handlers'` (barrel re-exports each handler file)

If the runner gets a `handlerName` it doesn't know, `getWorkflow()` returns `undefined` and the job is **dead-lettered**, not crashed. The reply path (`lib/brain.ts` → `processInbound`) never touches the tool/handler registries unless an agent is explicitly `executionMode='agentic'` with tools enabled, so default deployments stay **byte-for-byte** today's reply behaviour.

---

## Seam catalog at a glance

| Seam | Contract (`types.ts`) | Registry file | Register fn | Self-registers in | Looked up by |
|---|---|---|---|---|---|
| **Channel adapter** | `channels/types.ts` `ChannelAdapter` | `channels/registry.ts` | `register(a)` | each `channels/*.ts` | `getAdapter` / `listAdapters` |
| **Tool** | `tools/types.ts` `Tool` | `tools/registry.ts` | `registerTool(tool)` | each `tools/builtin/*.ts` | `getTool` / `listTools` |
| **Workflow handler** | `workflow/types.ts` `WorkflowHandler` | `workflow/registry.ts` | `registerWorkflow(name, h)` | each `workflow/handlers/*.ts` | `getWorkflow` / `listWorkflows` |
| **Trigger** | `Trigger` row (`cron` \| `event`) | DB + `jobs/scheduler.ts` / `triggers/dispatcher.ts` | insert a `Trigger` row | — (data, not code) | the ticker + the dispatcher |
| **Vertical template** | `lib/templates.ts` `AgentTemplate` | `TEMPLATES[]` array | add an array entry | `lib/templates.ts` | `getTemplate(id)` |

---

## 1 · Channel adapter seam

**Interface** — `server/src/channels/types.ts`. The engine is 100% channel-agnostic: every adapter normalises its channel to `InboundMessage` and provides `send()`.

```ts
interface ChannelAdapter {
  type: string;                 // 'whatsapp-web' | 'website' | 'telegram' | …
  onboarding: 'qr' | 'embed' | 'oauth' | 'token' | 'none';
  label?: string;              // picker metadata (STU-16) — fallbacks in GET /api/channels
  blurb?: string;
  ready?: boolean;             // false = coming-soon tile (default true)
  capabilities?: string[];     // forward-declared: ['text','images','location',…]
  start?(agentId: string): Promise<void>;   // optional lifecycle (WhatsApp needs it)
  stop?(agentId: string): Promise<void>;
  send(agentId: string, to: string, text: string): Promise<void>;
}
```

> **Reconcile (PXD-2/20):** `docs/AGENTS.md` and `docs/ARCHITECTURE.md` sketch a richer adapter (`displayName`, `onboard()`, `onInbound()`). That is the **target** shape. The **current** shape is exactly the five fields above plus optional `start/stop`. `capabilities[]` is a type field with sensible fallbacks but is not yet behaviourally consumed. Inbound is normalised by each channel's own router (e.g. the website public router, the WhatsApp listener), not an `onInbound()` method.

**Self-register** — each channel file calls `register()` at module load, then a barrel import runs that side effect:

```ts
// channels/website.ts
import { register } from './registry';
export async function send(_agentId: string, _to: string, _text: string) { /* widget polls; no-op */ }
register({ type: 'website', onboarding: 'embed', label: 'Website', ready: true, capabilities: ['text'], send });
```

**Add a channel — recipe:**
1. Create `channels/<name>.ts`; implement `send()` (and `start/stop` if the channel is stateful like WhatsApp).
2. Call `register({ type, onboarding, label, blurb, ready, send })` at the bottom.
3. Add one barrel import (`import './channels/<name>'`) in `index.ts` or `app.ts`.
4. Nothing else. `GET /api/channels` and the client picker are generated from `listAdapters()`.

**Security contract:** channel secrets (bot tokens) are stored **encrypted** (AES-256-GCM via `lib/crypto.ts`) and decrypted only at send time — never serialized into an `AgentSpec`, a version snapshot, or a prompt. Any owner-supplied URL the channel fetches server-side must go through the SSRF guard (`lib/ssrfGuard.ts`).

---

## 2 · Tool seam

**Interface** — `server/src/tools/types.ts`. MCP-shaped (name + zod input/output + structured result) so a future `McpToolAdapter` fits the same registry. A tool declares its **side-effect class**, which drives execution gating.

```ts
type SideEffect = 'read' | 'write' | 'external';

interface Tool<I = any, O = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  sideEffect: SideEffect;
  approvalAction?: string;     // Approval.actionType for a gated write/external tool ('booking', …)
  requiresProvider?: string;   // credential pulled from ConnectedAccount at call time (TOOL-27)
  idempotent?: boolean;
  timeoutMs?: number;
  execute(input: I, ctx: ToolContext): Promise<O>;
}
```

**Self-register** — `registerTool()` rejects duplicate names; the `tools/builtin/index.ts` barrel imports every tool file:

```ts
// tools/builtin/calendar.ts
import { registerTool } from '../registry';
export const calendarBook: Tool = { name: 'calendar.book', sideEffect: 'external', approvalAction: 'booking', /* … */ };
registerTool(calendarBook);
```

**Add a tool — recipe:**
1. Create `tools/builtin/<name>.ts`; define a `Tool` with zod `inputSchema`/`outputSchema` and the correct `sideEffect`.
2. For a write/external tool, set `approvalAction` (and `requiresProvider` if it needs a stored credential).
3. Call `registerTool(theTool)` at the bottom.
4. Add `import './<name>';` to `tools/builtin/index.ts`.
5. Enable it on an agent by listing its `name` in the agent's `enabledToolsJson` / spec `tools[]` (a non-empty tool set flips the agent to `executionMode='agentic'`).

**Execution + security contract** — every tool runs through the single interface `tools/execute.ts` (`executeTool`), which:
- validates input against the zod schema (`invalid_input` on failure);
- **gates by side-effect:** `read` runs inline; `write`/`external` create an `Approval` row and return `pending_approval` **without acting**. The real call only happens later via the approval runner (`preApproved: true`). **No model-emitted token ever authorizes a privileged action** — approval is a human decision recorded in the DB.
- enforces a per-tool timeout with one retry for `read`/idempotent tools, dedupes within an execution, validates output, and emits exactly one redacted step-trace row.
- injects decrypted `credential` into `ToolContext` at call time only (never in prompts/logs).

---

## 3 · Workflow handler seam

**Interface** — `server/src/workflow/types.ts`. The runner drives a handler one tick at a time; the handler returns exactly one `StepResult`.

```ts
type StepResult =
  | { kind: 'complete'; output?: Record<string, unknown> }
  | { kind: 'retry'; afterMs: number; reason?: string }
  | { kind: 'sleep'; until: Date; reason?: string }
  | { kind: 'awaitApproval'; actionType: string; payload?; reason?: string }
  | { kind: 'fail'; error: string };

type WorkflowHandler = (ctx: StepContext) => Promise<StepResult>;
```

`StepContext` gives the handler `orgId`, `agentId`, the `Job`/`WorkflowRun`, a read-only `state` snapshot plus `setState(patch)` (crash-safe durable state), `emit(type, data)` (outbox DomainEvent), and `log(message)`. Use the `Step` constructors (`Step.complete`, `Step.sleep`, …) so handlers read declaratively. Multi-step runs advance by writing `ctx.setState` and returning `retry{afterMs:0}` (run again now) or `sleep{until}` (resume later).

**Self-register** — `registerWorkflow()` rejects duplicates; `workflow/handlers/index.ts` imports every handler:

```ts
// workflow/handlers/scheduledMonitor.ts
import { registerWorkflow } from '../registry';
export const MONITOR_HANDLER = 'scheduled-monitor';
const handler: WorkflowHandler = async (ctx) => { /* … */ return Step.complete({ changed }); };
registerWorkflow(MONITOR_HANDLER, handler);
```

**Add a handler — recipe:**
1. Create `workflow/handlers/<name>.ts`; export a const `HANDLER_NAME` and a `WorkflowHandler`.
2. Gate the body behind its feature flag (e.g. `if (!monitorEnabled()) return Step.complete({ skipped: … })`).
3. Call `registerWorkflow(HANDLER_NAME, handler)` at the bottom.
4. Add `import './<name>';` to `workflow/handlers/index.ts`.
5. The runner (`jobs/runner.ts`) dispatches **by name only** — no runner edit. An unknown name dead-letters, never crashes.

**Security contract:** a handler that performs a write/outbound action must route it through an explicit gate — either `Step.awaitApproval(actionType, …)` (human approves first) or a tool with `sideEffect:'write'|'external'`. Event `data` is treated as **opaque** (EWS-20): matched and stored, never concatenated into a prompt. Handlers enforce their own per-tenant caps (the drip handler checks send-window, warmup cap, `canSpend(orgId)` budget, opt-out suppression, and ledger idempotency on every send).

---

## 4 · Trigger seam

Triggers are **data, not code**: a `Trigger` row (per-org, tenant-isolated) names a `handlerName` to enqueue. Two kinds ship today:

| Kind | Fired by | Match rule | State handed to the job |
|---|---|---|---|
| `cron` | `jobs/scheduler.ts` `tickCron()` | `nextRunAt` due (first eval fires immediately) | `{ triggerId, agentId, scheduledFor }` |
| `event` | `triggers/dispatcher.ts` `drainEvents()` | `eventType` match **and** every key in `filterJson` equals the event's `data`/`subject` | `{ triggerId, agentId, eventId, eventType, data }` |

Both enqueue through `enqueueJob` with a **derived idempotency key** so re-ticking or re-draining the same slot/event enqueues nothing:
- cron: `cron:<triggerId>:<minute-bucket>`
- event: `trig:<triggerId>:ev:<eventId>`

Events come from the outbox (`events/emit.ts` → `DomainEvent`), which is **gated by `WORKFLOW_ENABLED`** and written fire-and-forget, so the hot reply path is untouched by default.

**Add a trigger — recipe:**
1. Pick an existing registered `handlerName` (the trigger points at a handler; it does not define one).
2. Insert a `Trigger` row: `kind:'cron'` with a `cronExpr`, **or** `kind:'event'` with `eventType` + `filterJson`.
3. Scope it with `orgId` + optional `agentId`; set `enabled:true`.
4. **No scheduler/dispatcher edit** — `tickCron`/`drainEvents` pick it up on the next tick.

**Security contract:** the dispatcher enforces tenant isolation (`t.orgId !== ev.orgId → skip`). A trigger only _enqueues_ work; the downstream handler still enforces approval/budget/opt-out gates. Event payloads are opaque data, never prompt-concatenated.

---

## 5 · Vertical / role template seam

**Interface** — `server/src/lib/templates.ts`. Picking a business type pre-fills an agent's **persona only** (instructions/tone/restrictions) so it behaves sensibly before the owner adds facts. Templates **never** inject fake facts or prices.

```ts
interface AgentTemplate { id: string; label: string; emoji: string; instructions: string; tone: string; language: string; restrictions: string; }
```

Seven ship today: `coaching`, `salon-clinic`, `real-estate`, `retail`, `gym`, `coworking`, `restaurant`. All share `COMMON_RESTRICTIONS` (never quote a fixed final price, never promise availability/outcomes, escalate when unsure).

**Add a template — recipe:** add **one entry** to the `TEMPLATES[]` array with all six fields (`id`, `label`, `emoji`, `instructions`, `tone`, `language`/`restrictions`). `getTemplate(id)` resolves it and the one-tap apply path writes it through `applySpec()` — **no engine change**. (Deferred: **PXD-30** moves templates to a `Template` DB table + `GET /api/templates` so a new template is data not a deploy — flip trigger is a public template marketplace; status **deferred**, do not build.)

**Security contract:** templates set behaviour text only. They do not grant tools, do not set facts/prices, and compile through the same validated `AgentSpec` path (`lib/agentSpec.ts`) as the form and NL builder, so a template can never bypass spec validation.

---

## Capstone — add a whole scenario (PXD-26)

The architecture-level pass/fail test: a **new standard scenario** (e.g. _website offer/price monitoring_) is **1 trigger + 1 tool + 1 handler + 1 AgentSpec**, with **zero** changes to `processInbound` or the channel registry.

| Piece | File / artifact | What it is |
|---|---|---|
| **1 trigger** | a `Trigger` row, `kind:'cron'`, `cronExpr:'*/30 * * * *'`, `handlerName:'scheduled-monitor'` | fires every 30 min; the ticker enqueues a job |
| **1 handler** | `workflow/handlers/scheduledMonitor.ts` (`registerWorkflow('scheduled-monitor', …)`) | fetch (SSRF-guarded) → hash → notify only on real change; `Step.retry` on transient failure |
| **1 tool** | a `web.fetch_page` / monitor read tool in `tools/builtin/` (`sideEffect:'read'`) | fetches the page through `executeTool` + SSRF guard |
| **1 spec** | the agent's `AgentSpec` (`tools[]` + a `Watch` row + the trigger) | declares intent; compiles via `applySpec()` |

Wiring cost: **1 barrel import** for the handler, **1 barrel import** for the tool, **1 DB row** for the trigger, **1 spec edit**. `jobs/runner.ts`, `channels/registry.ts`, `lib/brain.ts`/`processInbound` are **unchanged** — the proof that the seams, not the engine, carry the feature.

---

## Security contract — the checklist every new seam PR must satisfy (PXD-32)

Non-negotiable rules, tied to the real seams. A new tool/channel/trigger/handler PR must honour **all** that apply:

- [ ] **Default-deny authorize().** Every privileged/org action is checked against `policy/engine.ts` `authorize(ctx, action)`; unknown role **or** unknown action → `deny`. Add new governed actions to the closed `Action` union + `PERMISSION_MATRIX`.
- [ ] **Approve-before-act on writes.** Any `write`/`external` tool goes through `executeTool`, which creates an `Approval` and does **not** act until approved. Handlers use `Step.awaitApproval` for outbound/irreversible actions.
- [ ] **No model-emitted token authorizes a privileged action.** Approval is a human/DB decision — never a string the model produced, never a field in the model's output.
- [ ] **Validate untrusted input at the boundary.** Tool inputs/outputs validated by zod; event `data` and tool results are treated as opaque and **never blindly concatenated into the system prompt**.
- [ ] **Secrets only via ConnectedAccount / AES-GCM.** Credentials are stored encrypted (`lib/crypto.ts`), injected into `ToolContext.credential` at call time only, and never serialized into specs, snapshots, logs, or prompts.
- [ ] **Outbound fetch behind the SSRF guard.** Any server-side fetch of an owner/model-supplied URL goes through `lib/ssrfGuard.ts` (refuses loopback/private/link-local/metadata, re-checks every redirect hop).
- [ ] **Per-tenant budget gate.** Volume/cost-spending work checks `budget.canSpend(orgId)` (and the feature flag) before acting; flags default **off**.
- [ ] **Tenant isolation.** Every query/trigger match is scoped by `orgId`; cross-org events/rows are skipped.
- [ ] **Additive + flag-gated.** New behaviour sits behind a flag that defaults off and leaves the reply path byte-for-byte unchanged when disabled.

---

## See also

- `docs/ARCHITECTURE.md`, `docs/AGENTS.md` — system overview and the target adapter shape
- `docs/CONNECTORS.md` — DB/REST connector setup and credential handling
- `docs/SECURITY.md`, `docs/guardrail-matrix.md` — the guardrail layers
- `docs/architecture/backlog.md` — PXD-1/2/5/6/7/8/20/26/30/32 source items
