# Running the app (dev)

> **Source of truth: the code. Last reconciled 2026-11-14.** (PXD-19)
> Corrected from an earlier draft: **production applies schema changes with `prisma migrate deploy`,
> not `prisma db push`** (see [§Database & migrations](#database--migrations)). Also note the two
> environment gotchas below — `DATABASE_URL` in a checked-out `server/.env` points at **prod**, and the
> client dev proxy expects the API on **port 4001**.

The app is split into two independently-deployable units:

- **`server/`** — Express + Prisma REST API + WebSocket, run via `tsx` (no build step)
- **`client/`** — React + Vite SPA (PWA, Capacitor-ready), port **5173**

The `legacy/` folder holds the earlier single-file skeleton and the original `agents/` CLI bot, kept as
reference; neither is part of the live app.

## ⚠️ Two gotchas before you start

1. **`DATABASE_URL` may point at production.** A populated `server/.env` on this project points
   `DATABASE_URL` at the **live Railway Postgres**. Before running tests, `db push`, seeds, or any
   destructive Prisma command, **override it to a local SQLite file** so you don't touch prod:
   ```bash
   export DATABASE_URL="file:./dev.db"   # PowerShell: $env:DATABASE_URL="file:./dev.db"
   ```
   The test suite uses its own isolated SQLite DB and never touches prod (see [TESTING.md](TESTING.md)),
   but ad-hoc Prisma commands inherit whatever `.env` says.
2. **The client proxies to port 4001.** `client/vite.config.*` proxies `/api` and `/ws` to
   `http://localhost:4001`, but the server defaults to **4000**. For local dev run the server with
   `PORT=4001` (or change the proxy) so the SPA and API share an origin.

## First run

```bash
# 1) Server
cd server
cp .env.example .env             # add ANTHROPIC_API_KEY. DATABASE_URL defaults to local SQLite.
export DATABASE_URL="file:./dev.db"   # ensure you're on a LOCAL db, not prod (see gotcha #1)
npm install
npm run db:generate              # prisma generate (SQLite schema.prisma)
npm run db:push                  # dev only: sync schema → dev.db (prisma db push). NOT used in prod.
PORT=4001 npm run dev            # API on http://localhost:4001  (matches the client proxy)

# 2) Client (new terminal)
cd client
npm install
npm run dev                      # app on http://localhost:5173
```

Open **http://localhost:5173** → create an account → **Add your first agent** (WhatsApp) →
**Connect / show QR** → scan with your phone → **Train** (paste a link, add facts, or upload a PDF) →
**Test** → message the number and watch it reply.

If you see `Could not find Chrome`, run `npm run setup-browser` inside `server/`.

## Database & migrations

The project keeps **two Prisma schemas**:

| Schema | Used by | Datasource |
|---|---|---|
| `prisma/schema.prisma` | **dev + tests** | SQLite (`file:./dev.db`) |
| `prisma/schema.postgres.prisma` | **production** | PostgreSQL — **auto-generated** from `schema.prisma` |

- **Dev:** `npm run db:push` (`prisma db push`) is fine for the local SQLite file — it is quick and
  destructive-free enough for throwaway dev data.
- **Prod:** schema changes ship as **committed migrations** applied with **`prisma migrate deploy`**
  (run by `server/docker-entrypoint.sh` on boot, forward-only, with history). **Prod never runs
  `db push`** — that was the old destructive sync-on-boot and has been removed.
- **After editing `schema.prisma`:** regenerate the Postgres variant and create a migration:
  ```bash
  npm run db:gen-pg          # regenerate schema.postgres.prisma from schema.prisma
  # create a migration (against a Postgres dev db), review the SQL, commit it:
  npx prisma migrate dev --schema prisma/schema.postgres.prisma --name <change>
  npm run migrate:status     # prisma migrate status (what prod will apply)
  ```
  Keep both schemas' models identical; `db:gen-pg` is the source of truth for the Postgres one.

## WhatsApp session storage (`WWEBJS_DATA_PATH`)

`whatsapp-web.js` persists each connected agent's login via `LocalAuth` on disk. The path is
`WWEBJS_DATA_PATH` (defaults to the local `.wwebjs_auth` when unset, so local dev and docker-compose are
unaffected). In prod this must point at a **persistent volume** or every deploy forces a QR re-scan —
see [DEPLOY.md](../DEPLOY.md) Option C.

## Notes

- Auth is an opaque bearer token (hashed at rest as `tokenHash`), stored in the browser; signup/reset use
  phone + WhatsApp OTP (dev echoes the code as `devOtp` when the Cloud API isn't configured).
- Key env vars (full list in `server/.env.example`): `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`,
  `WIDGET_SIGNING_SECRET`, `CORS_ORIGIN`; optional `AGENT_MODEL`, `EMBEDDINGS_PROVIDER` (+ key),
  `WORKFLOW_ENABLED` and other feature flags (all **default off** — see [ARCHITECTURE.md](ARCHITECTURE.md)).
- The LinkedIn browser agent runs as a separate own-machine worker: `npm run linkedin:worker`
  (see [LINKEDIN_AGENT_PLAN.md](LINKEDIN_AGENT_PLAN.md)).

---

**See also:** [ARCHITECTURE.md](ARCHITECTURE.md) · [DEPLOY.md](../DEPLOY.md) · [TESTING.md](TESTING.md) ·
[DATA_MODEL.md](DATA_MODEL.md) · [OPERATIONS.md](OPERATIONS.md)
