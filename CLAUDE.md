# CLAUDE.md — working rules for this repo

Multi-tenant WhatsApp / website agent SaaS (a modular monolith in `server/`, React app in
`client/`). Phases 0–6 are built and deployed: reply engine, workflow spine, tools + approvals,
PDF ingestion + RAG, DB/REST connectors, LinkedIn browser agent (Wave 0–2). Read this before
changing code. It encodes the non-negotiable guardrails; the long-form rationale lives in
`docs/` (start with `docs/EXTENDING.md`, `docs/architecture/decision-log.md`,
`docs/guardrail-matrix.md`).

These rules apply to humans and AI contributors equally. A change that breaks one of them is wrong
even if it passes tests.

---

## The eight guardrails (binding)

1. **Invisible UI.** The interface gets out of the way: zero-decision defaults, ≤3 controls before
   the primary button (the rest behind one named disclosure that states its default in words),
   outcome-named buttons (`Connect WhatsApp`, never `Submit`), and "show what changed" after every
   write. No tours, tooltips, or coach-marks. See `docs/UX_PRINCIPLES.md`.

2. **Additive only.** New behaviour is added alongside what exists; you do not alter or remove a
   working path to make room for it. Extend the schema, add a module, add a flag — never rewrite the
   engine or mutate an existing contract in place.

3. **Reply path stays byte-for-byte.** The default inbound→reply path (`engine/engine.ts`
   `processInbound`) must produce exactly today's output when all feature flags are off. Any new
   capability (workflow spine, monitor, outbound drip, memory, LinkedIn) is dormant by default and
   must not touch the hot reply path until its flag is explicitly turned on. If your change alters a
   default reply, it is wrong.

4. **Self-registering registry seams only — the engine never imports a concrete module.** Everything
   pluggable (channel adapter, tool, workflow handler, trigger, template) registers itself into an
   in-process `Map` at module load. The engine reaches a seam **only** by name through its registry
   (`getAdapter` / `getTool` / `getWorkflow`), never by importing a concrete channel/tool/handler.
   Concrete modules are pulled in once at boot via barrel imports that exist only to run the
   `register*()` side effect. An unknown handler/tool name degrades (dead-letter / lookup miss),
   never crashes. **A new channel/tool/handler/trigger = one new module + one `register*()` call +
   one barrel import, with zero core-engine change.** See `docs/EXTENDING.md`.

5. **Approve before act.** Every `write`/`external` tool runs through `tools/execute.ts`, which
   creates an `Approval` row and returns `pending_approval` **without acting**; the real call happens
   only later via the approval runner. Workflow handlers use `Step.awaitApproval` for outbound /
   irreversible actions. **No model-emitted token ever authorizes a privileged action** — approval is
   a human decision recorded in the DB, never a string the model produced.

6. **Feature flags default OFF.** `WORKFLOW_ENABLED`, `MONITOR_ENABLED`, `OUTBOUND_ENABLED`,
   `MEMORY_ENABLED`, `LINKEDIN_ENABLED` (`server/src/lib/spineEnv.ts`) are all off unless explicitly
   set. With them unset the app is the single-turn reply bot and no proactive send can occur.
   Per-connection `active=false` and per-watch `active` are a second gate. Ship new behaviour behind
   a flag that defaults off.

7. **Migrations, not `db push`, for prod.** Schema changes are **additive and forward-only**,
   authored on the canonical SQLite `prisma/schema.prisma`, generated to
   `prisma/schema.postgres.prisma` (`npm run db:gen-pg` — never hand-edit the Postgres file), and
   applied to prod **only** via `prisma migrate deploy`. There is no auto-rollback; recovery is a new
   forward migration. `prisma db push` is for local SQLite only and must **never** touch prod. See
   `docs/MIGRATIONS.md`.

8. **Tests never touch prod.** The Vitest suite runs against an isolated SQLite DB, fully offline and
   deterministic (no `ANTHROPIC_API_KEY`, no network, no external DB). `server/.env`'s `DATABASE_URL`
   points at the **live Railway Postgres** — override it before any `db push` / manual DB work, and
   never point a test or a destructive command at it. See `docs/TESTING.md`.

---

## Security contract (applies to every new seam)

- **Default-deny `authorize()`** (`policy/engine.ts`): unknown role or unknown action → deny. Add
  governed actions to the closed `Action` union + `PERMISSION_MATRIX`.
- **Secrets only via `ConnectedAccount` + AES-256-GCM** (`lib/crypto.ts`): injected into
  `ToolContext.credential` at call time only; never serialized into specs, snapshots, logs, or prompts.
- **Outbound fetch behind the SSRF guard** (`lib/ssrfGuard.ts`): refuses loopback/private/link-local/
  metadata, re-checks every redirect hop. Every owner/model-supplied URL fetched server-side.
- **Untrusted input validated at the boundary:** tool I/O via zod; event `data` and tool results are
  opaque — never blindly concatenated into the system prompt.
- **Per-tenant isolation + budget:** every query/trigger is scoped by `orgId`; cross-org rows are
  skipped. Volume/cost work checks `budget.canSpend(orgId)` before acting.

---

## Layout

| Path | What |
|---|---|
| `server/src/engine/` | reply engine (`processInbound`) + agentic loop |
| `server/src/channels/` | channel adapters + `registry.ts` (whatsapp, website, telegram, linkedin) |
| `server/src/tools/` | tool registry, `execute.ts` (approval gate), `builtin/` |
| `server/src/workflow/` | workflow handler registry + `handlers/` |
| `server/src/triggers/`, `jobs/` | event dispatcher, cron scheduler, job runner |
| `server/src/policy/` | `authorize()`, approvals, approval executor |
| `server/prisma/` | `schema.prisma` (SQLite, canonical) + generated `schema.postgres.prisma` + migrations |
| `client/src/` | React + Vite invisible-UI dashboard |
| `docs/` | reference docs; `docs/architecture/decision-log.md` is authoritative on decisions |

## Conventions

- Deliverables are repo files, never external artifacts/Docs.
- Prod domains: `agents.codevel.com` (Vercel), `api.agents.codevel.com` (Railway); both deploy on
  push to `main`. Don't commit or push unless asked; branch first if on `main`.
- Don't commit secrets. Channel/connector credentials are encrypted at rest; keys live in Railway +
  `server/.env`, never git.
