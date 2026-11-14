# Tools & the agentic runtime

How the in-process tool registry works, how to add a tool, and why we are **not** adding an MCP
client yet. Pairs with [AGENTS.md](../AGENTS.md) and the backlog `TOOL` module.

## The model

A **tool** is a typed, self-registering capability (`server/src/tools/types.ts`): a name, a zod
`inputSchema`/`outputSchema`, a `sideEffect` class, and an `execute(input, ctx)`. Tools run **only**
on the opt-in agentic path (`executionMode='agentic'`); the single-turn reply path never touches
the registry, so default agents are byte-for-byte unchanged.

```
registry.ts   → self-registering Map (mirrors channels/registry.ts)
execute.ts    → the ONE execution interface: validate input → gate by side-effect →
                timeout + retry (read/idempotent only) → validate output → 1 log line + 1 step row
agentic.ts    → the bounded tool_use loop (budget before every turn, turn/tool caps, allowlist-only)
```

### Side-effect gating (the safety rule)

`execute.ts` enforces it, not the model:

| `sideEffect` | Behaviour |
|---|---|
| `read` | runs inline |
| `write` / `external` | creates an **Approval** and returns `pending_approval` — **nothing happens until the owner approves** |

No model-emitted token ever authorizes a privileged action. A tool result is **untrusted data**
wrapped in a `tool_result` block — never concatenated into the system prompt.

## Adding a tool (TOOL-25)

1. Create `server/src/tools/builtin/<name>.ts`:

```ts
import { z } from 'zod';
import { registerTool } from '../registry';
import type { Tool } from '../types';

export const myTool: Tool = {
  name: 'domain.action',               // dotted namespace
  description: 'One line the model sees.',
  inputSchema: z.object({ /* ... */ }),
  outputSchema: z.object({ /* ... */ }),
  sideEffect: 'read',                  // 'write' / 'external' → auto approval-gated
  approvalAction: 'booking',           // only for write/external; maps to the Approval queue
  idempotent: true,                    // allows one retry on transient failure
  timeoutMs: 10_000,
  async execute(input, ctx) { /* return something matching outputSchema */ },
};

registerTool(myTool);
```

2. Add `import './<name>';` to `server/src/tools/builtin/index.ts` (self-registers at boot).
3. It now appears in `GET /api/agents/:id/tools`, the Abilities picker, the gateway, and the
   execution trace automatically. **No edit to `execute.ts` or `agentic.ts` is needed.**
4. For a write/external tool, the approval executor (`policy/approvalExecutor.ts` +
   `tools/approvalRunner.ts`) runs it `preApproved` exactly once when its Approval is approved.
5. Every call writes one redacted `ExecutionStep` row (TOOL-29), surfaced in the client activity
   viewer.

Credentials (TOOL-27): declare `requiresProvider` and read `ctx.credential` — it is decrypted and
injected at call time only, never in prompts or logs.

## Decision: no MCP client yet (TOOL-26)

The `Tool` contract is deliberately **MCP-shaped** (name + JSON-Schema input + structured result),
so a future `McpToolAdapter` can wrap a remote MCP server and register it like any builtin — with
no change to `execute.ts`, the gating, or the loop.

We are **not** building that adapter now:

- **No current need.** Every in-scope scenario (knowledge, CRM, web fetch, calendar, channel send)
  is a first-party in-process tool. An MCP mesh adds a network hop, auth, and a trust boundary for
  zero present benefit.
- **Locked stance.** The platform is modular-monolith-first; external tool meshes (MCP, Google A2A)
  are explicitly deferred.

**Flip trigger:** build the `McpToolAdapter` when a concrete integration can only be reached through
a third-party MCP server (not an HTTP API we can wrap as a builtin). Until then the registry stays
in-process, and untrusted tool output continues to be treated as data, never instructions.
