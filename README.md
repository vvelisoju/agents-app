# Personal Agent Platform

A multi-tenant web app where anyone can create their own AI agents — no technical
knowledge needed. Describe your business (or paste a link), and the agent replies to
your customers on **WhatsApp**, a **website chat widget**, or **Telegram**. Training is
instant (edit anytime, applies to the next message), and you choose whether replies send
automatically or wait for your approval.

> **This is the product.** The original single-tenant CLI prototype and the earlier
> single-file skeleton now live under [`legacy/`](legacy/) for reference only.

## Layout

```
PersonalAgents/
├─ server/     Node + TypeScript API (Express + Prisma + WebSocket) — agents, training, channels
├─ client/     React + Vite web app (PWA / Capacitor-ready) — the invisible-UI dashboard
├─ docs/       Specs. Start at docs/architecture/ (current state, target, roadmap, backlog)
└─ legacy/     Archived prototype (agents/) + skeleton (platform/) — not the product
```

## Quick start (dev)

**Server** (API on :4001)
```bash
cd server
cp .env.example .env            # add ANTHROPIC_API_KEY; the rest have dev defaults
npm install
npm run dev
```

**Client** (web app on :5173)
```bash
cd client
npm install
npm run dev
```

The web app proxies `/api` and `/ws` to the server. Sign up with a phone number
(the dev OTP is returned in the API response when WhatsApp OTP isn't configured),
add an agent, connect its channel (scan the WhatsApp QR / paste the website snippet /
add a Telegram bot token), train it, and test it in the console before going live.

## Tests

```bash
cd server && npm test     # isolated SQLite DB; never touches a real/prod database (QA-01)
```

## Deploying

See [DEPLOY.md](DEPLOY.md). The server runs as one container (Railway) with a Postgres
database; the client deploys to Vercel (or is served by nginx in the full `docker-compose`).

## Architecture & roadmap

The design and the task-level plan live in [`docs/architecture/`](docs/architecture/):
[current-state](docs/architecture/current-state.md) ·
[target-architecture](docs/architecture/target-architecture.md) ·
[implementation-roadmap](docs/architecture/implementation-roadmap.md) ·
[backlog](docs/architecture/backlog.md) ·
[decision-log](docs/architecture/decision-log.md) ·
[execution-log](docs/architecture/EXECUTION_LOG.md).

## Safety & compliance

- **Reply-only on WhatsApp.** The agent responds to people who message you; it never
  mass-blasts. Bulk/cold promotional sending is the top cause of WhatsApp bans.
- WhatsApp connects via QR (`whatsapp-web.js`), an unofficial method. Risk is low for
  genuine replies within the 24-hour window; outbound campaigns are an explicit,
  accepted-risk, throttled feature on a secondary number.
- Per-agent **approve-before-send** and a `NEEDS_HUMAN` escalation path keep sensitive
  messages from being auto-answered. Secrets are encrypted at rest.

## The old CLI prototype

Still runnable for reference: `npm run whatsapp` (now at
[`legacy/agents/whatsapp-reply/`](legacy/agents/whatsapp-reply/)).
