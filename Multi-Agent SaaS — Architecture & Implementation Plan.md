# Multi-Agent SaaS — Architecture & Implementation Plan

> ⚠️ **This file is superseded.** The full, corrected spec now lives in **[`docs/`](docs/README.md)**.
> This was an earlier export (before the latest requirements), so its Phase 1 is out of date and its
> diagram did not survive the export. Use the `docs/` folder instead.

## What changed and why

The earlier version put the official WhatsApp **Cloud API**, Meta **Embedded Signup**, and **Razorpay
billing** inside the Phase 1 MVP. Per the latest requirements, Phase 1 is now:

- **WhatsApp via QR login** — the user scans a QR (`whatsapp-web.js`) and is logged in; many agents
  per user. (Cloud API is a later, optional scaling path, behind the same adapter.)
- **Subscription / Razorpay deferred** to a later phase — build the end-to-end functionality first.
- **Training is the centerpiece** — easy to give links, instructions, restrictions and facts; easy to
  view what the agent knows; editable at any time, applying immediately.

## Read the real spec

Start at **[docs/README.md](docs/README.md)**:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, flows, the WhatsApp **session manager**,
  and the channel-adapter design (with Mermaid diagrams that render in the repo).
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — the PostgreSQL schema.
- [docs/TRAINING.md](docs/TRAINING.md) — the agent-training feature in full.
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — phased plan, API surface,
  **end-to-end acceptance criteria**, and a **risk review**.
