# Architecture docs — index

> **Source of truth: the code. Last reconciled 2026-11-14.** (PXD-36)
> This folder is the **planning & assessment corpus** for turning the shipped SaaS into a generalized
> agentic platform. Several files are **review drafts** that describe a *target* or a point-in-time
> *assessment*, not necessarily the current shipped state. For **what the running code does today**, read
> the top-level reference docs under [`docs/`](../) (listed at the bottom) — those are the ones kept
> reconciled to the code.

## How to read this folder

Start here, in order, for the "where we are → where we're going" story:

| # | Doc | What it is | Kind |
|---|---|---|---|
| 1 | [current-state.md](current-state.md) | Read-only assessment of the whole repo — the three product generations, the live `server/`+`client/` stack, security findings, and what was absent at the time of writing | Assessment (dated; predates some now-shipped work — see note below) |
| 2 | [gap-analysis.md](gap-analysis.md) | Each target component assessed against the real repo: present / partial / absent | Assessment |
| 3 | [target-architecture.md](target-architecture.md) | The intended generalized platform — modular-monolith-first | Plan (target) |
| 4 | [implementation-roadmap.md](implementation-roadmap.md) | Dependency-ordered, additive, reversible build order | Plan |
| 5 | [backlog.md](backlog.md) | The full end-to-end backlog (512 tasks across 15 modules) | Plan |
| 6 | [PENDING_BACKLOG_PLAN.md](PENDING_BACKLOG_PLAN.md) | What genuinely remains after Phases 0–6 + PDF/RAG/connectors shipped, classified and sequenced | Plan (live) |
| 7 | [EXECUTION_LOG.md](EXECUTION_LOG.md) | Per-task build progress against `backlog.md`, with guardrail notes | Live log |
| 8 | [decision-log.md](decision-log.md) | One line per architecture decision + the **flip trigger** for deferred items; authoritative where narrative docs differ | Live log |
| 9 | [TOOLS.md](TOOLS.md) | The in-process tool registry, how to add a tool, and why there's no MCP client yet | Reference |

> **Staleness note on `current-state.md`:** it was written as a snapshot and lists vector/RAG, a tool
> registry and a workflow/job queue as *absent*. Those have since been **built** (Phases 0–6 + PDF
> ingestion, in-process RAG, DB/REST connectors). Treat its "absent" table as historical; the shipped
> reality is in the reference docs below and in [decision-log.md](decision-log.md).

## Guardrails every change here follows

- **Additive** — layer on existing seams; never rewrite the reply path.
- **Reply path byte-for-byte** — `executionMode:'reply'` is unchanged when new flags/tools are off.
- **Self-registering registries** — channels, tools, workflow handlers, triggers, templates.
- **Approve-before-act** — privileged actions park on an `Approval` until a human OKs.
- **Flags default off** — every new subsystem ships dark.

## Shipped-reality reference docs (kept reconciled to the code)

These top-level docs describe **what exists and runs today**:

- [../ARCHITECTURE.md](../ARCHITECTURE.md) — the live system: one process, channel registry, Postgres job
  spine, no Redis/RLS/pgvector.
- [../EXTENDING.md](../EXTENDING.md) — the seam catalog (add a channel / tool / workflow handler / trigger).
- [../TRAINING.md](../TRAINING.md) — training inputs, train-from-link, PDF ingestion, and the in-process
  cosine + keyword RAG path.
- [../DATA_MODEL.md](../DATA_MODEL.md) — the Prisma models.
- [../CONNECTORS.md](../CONNECTORS.md) — safe DB/REST data connectors.
- [../OBSERVABILITY.md](../OBSERVABILITY.md) — execution traces, metrics, budgets, retention.
- [../POLICY_AND_AUDIT.md](../POLICY_AND_AUDIT.md) — default-deny authorization, approvals, append-only audit.
- [../TESTING.md](../TESTING.md) — the offline Vitest suite.
- [../DEV.md](../DEV.md) / [../../DEPLOY.md](../../DEPLOY.md) — run locally / deploy (migrate flow).
