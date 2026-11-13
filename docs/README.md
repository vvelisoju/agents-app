# Secure Agents — SaaS Platform Spec

> Living specification for turning the single-tenant WhatsApp prototype in this repo
> into a multi-tenant SaaS. Kept **in the repo** (no external docs). Last updated 2026-11-13.

## What we are building

A SaaS where any business signs up and runs AI agents that reply to their customers on
messaging channels. The first channel is **WhatsApp**. A signed-in user can:

1. **Sign up** and (later) take a paid **subscription**.
2. **Add one or more WhatsApp agents** — each linked by **scanning a QR code** with their phone.
3. **Train each agent easily** — give instructions, restrictions, links and free-text info;
   **view** the current training; and **add more training at any time**.
4. Have each agent **auto-reply** (or draft replies for approval) to incoming WhatsApp
   messages, using that agent's own training.

## Core requirements (from the product owner, in order of priority)

1. **End-to-end functionality first.** Build the full working loop before anything fancy.
2. **Subscription (Razorpay) comes later.** For the first build, subscription is stubbed —
   every signed-up user gets access. Billing is wired in a later phase.
3. **WhatsApp via QR login.** User selects "WhatsApp agent", scans a QR, and is logged in.
   A user can add **many** WhatsApp agents (each its own number/session).
4. **Training is the heart of the product.** It must be:
   - **Easy** — paste links, type instructions, set restrictions, add facts.
   - **Viewable** — the user can always see what their agent currently knows and how it behaves.
   - **Editable any time** — add or change training whenever they want; changes apply immediately.

## MVP scope vs later

| | Phase 1 (MVP — end-to-end) | Later phases |
|---|---|---|
| Auth | Email/password signup + login | SSO, team seats |
| Subscription | Stubbed (free for all signed-up users) | **Razorpay** billing + plan limits |
| WhatsApp | **QR login** (whatsapp-web.js), many agents | Official **Cloud API** for scale |
| Training | Instructions, restrictions, links, facts, test console | Auto-learning from past chats, analytics |
| Channels | WhatsApp only | Instagram, Gmail, Telegram, web chat |

## Documents in this folder

| File | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, message/onboarding flows, the WhatsApp session manager, the channel-adapter design, security |
| [DATA_MODEL.md](DATA_MODEL.md) | PostgreSQL schema for orgs, agents, sessions, training, conversations |
| [TRAINING.md](TRAINING.md) | The agent-training feature in full — the heart of the product |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phased plan, API surface, **end-to-end acceptance criteria**, and a **risk review** |
| [UX_PRINCIPLES.md](UX_PRINCIPLES.md) | **Invisible-UI** doctrine, AI-agentic feel, click budgets, mobile+web design system |
| [AGENTS.md](AGENTS.md) | Agent model, extensibility (any number, any type), the **catalog + tier-2 priorities**, easy training |
| [BACKLOG.md](BACKLOG.md) | The complete end-to-end **task bundles → tasks** with acceptance criteria |

**Standards:** the stack and conventions are aligned with the existing **ClassPe** app — Vite + React 18
+ Capacitor 8, shadcn/ui + Tailwind tokens, wouter, TanStack React Query, react-hook-form + Zod,
i18next (en/hi/te) on the client; Express + Prisma + PostgreSQL, session + passport auth, feature-module
layering on the server. [BACKLOG.md](BACKLOG.md) B0 is authoritative on the stack.

## Key decisions

- **WhatsApp onboarding (Phase 1): QR via `whatsapp-web.js`**, one live session per agent — exactly
  the "scan a QR and log in" flow requested. **Honest caveat:** this is an unofficial method and
  does not scale to thousands of numbers (resource cost + ban risk). Phase 3 migrates heavy use to
  the official **WhatsApp Cloud API** behind the *same* adapter interface, so app code does not change.
  See [ARCHITECTURE.md § WhatsApp session manager](ARCHITECTURE.md#whatsapp-session-manager).
- **Frontend: React + Vite + Capacitor** — one codebase ships to web, iOS and Android.
- **Backend: Node + TypeScript.** The prototype's Claude "brain" and persona/link patterns carry over.
- **AI: Claude Haiku** (cheapest; ~₹0.02/reply) via a shared helper.
- **Training applies instantly** — the reply engine reads the agent's current training on every message.
