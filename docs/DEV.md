# Running the app (dev)

The production app is split into independently-deployable units (ClassPe pattern):

- **`server/`** — Express + Prisma REST API + WebSocket (port **4001**)
- **`client/`** — React + Vite SPA, Capacitor-ready (port **5173**)

The `platform/` folder is the earlier single-file skeleton (kept as a working reference); the root
`agents/` prototype is the original WhatsApp bot. Neither is affected by the new app.

## First run

```bash
# 1) Server
cd server
cp .env.example .env            # add your ANTHROPIC_API_KEY; DATABASE_URL defaults to SQLite
npm install
npx prisma generate
npx prisma db push              # creates dev.db from the schema
npm run dev                     # API on http://localhost:4001

# 2) Client (new terminal)
cd client
npm install
npm run dev                     # app on http://localhost:5173
```

Open **http://localhost:5173** → create an account → **Add your first agent** (WhatsApp) →
**Connect / show QR** → scan with your phone → **Train** (paste a link, or add facts) →
**Test** → message the number and watch it reply.

If you see `Could not find Chrome`, run `npm run setup-browser` inside `server/`.

## Notes

- The Vite dev server proxies `/api` and `/ws` to the server, so both share an origin in dev.
- Data layer is SQLite for zero-setup dev; switch `provider` to `postgresql` in
  `server/prisma/schema.prisma` + set `DATABASE_URL` for production (see docs/DATA_MODEL.md).
- Auth is a bearer token (stored in the browser) for now; session/passport + phone OTP is backlog B2.1.
- Native iOS/Android (Capacitor wrapper) and the root `concurrently` orchestrator are backlog items
  (B0.3 / B0.1) — the web app is the same codebase they will wrap.
