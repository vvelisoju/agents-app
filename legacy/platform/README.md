# Platform — Phase 1 skeleton

A **runnable** foundation for the multi-agent SaaS. It does the full single-agent loop:
**sign up → add a WhatsApp agent → scan QR → train it → it replies.**

It is isolated in this `platform/` folder; the prototype at the repo root
(`npm run whatsapp`) is untouched.

## Run it

```bash
cd platform
cp .env.example .env            # then put your ANTHROPIC_API_KEY in .env
npm install                     # also downloads a Chrome for WhatsApp Web
npm run dev                     # starts http://localhost:4000
```

Open http://localhost:4000 → sign up → **Add agent** → **Connect / show QR** → scan with
your phone (WhatsApp → Linked Devices) → **Train** it — the easy way is to paste a link
(**Set up your agent from a link**: website / Google / Instagram / Facebook) and keep what it
found; typing instructions is optional — → use the **Test console** → message the number and
watch it reply.

If you see `Could not find Chrome`, run `npm run setup-browser`.

## What's built (Phase 1)

- Email/password auth with per-tenant isolation (`org_id` on every row).
- Agents CRUD; **many WhatsApp agents per account**.
- WhatsApp session manager (whatsapp-web.js), QR + status pushed over WebSocket.
- **Train from a link** (invisible-UI onboarding): paste a website / Google / Instagram / Facebook
  link → the page is fetched, read, and condensed by Claude into a confirmable draft
  (instructions, tone, facts, FAQs, links) → the owner keeps what's right in one click. No typing required.
- Training: instructions, restrictions, tone/language, facts, **shareable links** (`{{LINK:Name}}`
  tokens → exact URLs), FAQs — all editable any time, applied on the next message.
- **Test console** (try a message, see the draft, nothing sent).
- Reply engine: inbound → load current training → Claude (Haiku) → auto-send or draft.
- Conversations view with approve/skip for drafts.

## Deliberate skeleton choices (production path in `../docs`)

| Skeleton (runs now) | Production target | Migration |
|---|---|---|
| SQLite (`data.sqlite`) | PostgreSQL + pgvector | Swap the data layer; schema matches `docs/DATA_MODEL.md` |
| In-process message handling | Redis + BullMQ queue | Move `engine.handleInbound` behind a queue |
| Session worker in-process | Separate worker + RemoteAuth | Extract `whatsapp.ts`; store auth in DB/S3 |
| Static HTML dashboard | React + Vite + Capacitor app | Replace `src/public` with the `/app` build |
| Bearer-token auth | Clerk/JWT, rate limiting | Swap `auth.ts` |

These are tracked in [`../docs/BACKLOG.md`](../docs/BACKLOG.md).

## Layout

```
src/
  index.ts      server + all REST routes + boot
  db.ts         SQLite schema + data helpers
  auth.ts       signup/login + bearer-token middleware
  brain.ts      Claude helper (Haiku)
  learn.ts      "train from a link": fetch -> extract text -> Claude -> training draft
  training.ts   training -> system prompt, {{LINK:Name}} substitution
  engine.ts     inbound message -> reply (or draft)
  whatsapp.ts   whatsapp-web.js session manager
  realtime.ts   WebSocket hub (qr / status / message)
  public/       the dashboard (index.html + app.js)
```
