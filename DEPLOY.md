# Deployment Guide

> **Source of truth: the code. Last reconciled 2026-11-14.** (PXD-24)
> Corrected from an earlier draft: schema changes are applied in prod with **`prisma migrate deploy`**
> (forward-only, reviewed SQL, history) — **never the old destructive `prisma db push` on boot**. `db push`
> is a **dev-only** convenience for the local SQLite DB. There is **no Redis / message broker** in the
> stack: the job queue is a Postgres table and realtime is an in-memory WebSocket fan-out
> (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)). Don't provision one.

**What actually runs in production:** **Option C — Railway.** The frontend is on **Vercel**
(`agents.codevel.com`), the API on **Railway** (`api.agents.codevel.com`), both deploying on push to
`main`. Options A and B below are the generic VPS/split recipes; read **Option C** first if you're
touching the live deploy.

Three options. Pick one.

| Option | Client | Server | Best for |
|--------|--------|--------|---------|
| **A — Full Docker** | nginx container (port 80) | Express container | Single VPS, simplest |
| **B — Split** | Vercel / Netlify | Docker on VPS | CDN edge + separate API host |
| **C — Railway** | Vercel | Railway (1 container) | **The live deploy** (`agents.codevel.com`) |

## Database & migrations (read before any option)

- **Prod** boots `server/docker-entrypoint.sh`, which runs **`prisma migrate deploy --schema
  prisma/schema.postgres.prisma`** (retries if the DB is still starting), then starts the server. Only
  **new** migrations are applied; the baseline (`0_init`) is marked applied on the existing prod DB.
- **`DATABASE_URL` must be a PostgreSQL URL in prod.** The container applies migrations against it on
  every deploy.
- **Never run `prisma db push` against prod** — it is destructive and historyless. It is only for the
  local **SQLite** dev DB (see [docs/DEV.md](docs/DEV.md)).
- To add a schema change: edit `prisma/schema.prisma`, run `npm run db:gen-pg`, create a reviewed
  migration (`prisma migrate dev --schema prisma/schema.postgres.prisma`), and commit it. It applies on
  the next deploy.

---

## Option A — Full Docker Compose (single VPS)

### 1. Prerequisites on the VPS

```bash
# Ubuntu 22.04 / Debian 12
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out + in after this
```

Docker Compose v2 is bundled with Docker Desktop; on headless servers:

```bash
sudo apt-get install docker-compose-plugin
```

Verify: `docker compose version`

---

### 2. Clone & configure

```bash
git clone <your-repo-url> PersonalAgents
cd PersonalAgents

# Create the production env file from the template
cp server/.env.production.example server/.env.production
nano server/.env.production      # fill in the values below
```

**`server/.env.production` — required values:**

| Variable | What to put |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your key from console.anthropic.com |
| `CORS_ORIGIN` | Your domain, e.g. `https://app.secure.studio` |
| `DATABASE_URL` | A **PostgreSQL** URL (e.g. the Compose `postgres` service). The server image applies `prisma migrate deploy` against it on boot — SQLite is dev-only. |
| `ENCRYPTION_KEY` | 32-byte secret (hex/base64) for secrets-at-rest; the server refuses to boot without it |
| `WIDGET_SIGNING_SECRET` | Long random string; signs website widget keys |

Leave `PORT=4000` as-is — docker-compose handles port mapping.

---

### 3. Build & start

```bash
docker compose up --build -d
```

The first build takes 2-5 minutes (downloads Chromium for WhatsApp).

| Service | Accessible at |
|---------|--------------|
| Web app (React) | http://your-server-ip |
| API (debug only) | http://127.0.0.1:4001/api/health |

Check everything is up:

```bash
docker compose ps
docker compose logs server --tail 40
```

---

### 4. HTTPS with Caddy (recommended)

Install Caddy on the VPS:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

`/etc/caddy/Caddyfile`:

```
app.yourdomain.com {
    reverse_proxy localhost:80
}
```

```bash
sudo systemctl reload caddy
```

Caddy auto-provisions a free Let's Encrypt certificate. After this, update `CORS_ORIGIN` in `server/.env.production` to your HTTPS domain and redeploy the server:

```bash
docker compose up -d --build server
```

---

### 5. Connect your first WhatsApp agent

1. Open `https://app.yourdomain.com` in a browser.
2. Sign up for an account.
3. Create an agent → click **Connect WhatsApp**.
4. Scan the QR code from WhatsApp on your phone (Linked Devices).
5. The agent status changes to **Connected**.

WhatsApp sessions are stored in the `wa_auth` Docker volume — they survive server restarts and redeploys.

---

### 6. Updating after a code push

```bash
git pull
docker compose up --build -d
```

Only the changed service(s) are rebuilt. Volumes (database, WhatsApp sessions) are preserved.

---

### 7. Database: PostgreSQL

Production runs on **PostgreSQL**. The committed `prisma/schema.postgres.prisma` + the migrations in
`prisma/migrations/` are the source of truth; the server image generates the Postgres client at build and
applies migrations at boot (no build-time provider swap). For a Compose Postgres:

1. In `server/.env.production`, set a Postgres URL:
   ```
   DATABASE_URL=postgresql://postgres:agents@postgres:5432/agents
   ```
2. In `docker-compose.yml`, uncomment the `DATABASE_URL` line under `server`.
3. Redeploy: `docker compose up --build -d`

On boot, `docker-entrypoint.sh` runs **`prisma migrate deploy`**, which applies any pending migrations
(creating the tables on a fresh DB). It is **not** `db push` and never drops columns. If the DB is slow
to start, the entrypoint retries a few times before failing loudly.

---

## Option B — Split deployment (Vercel/Netlify + VPS)

### Server: deploy to VPS via Docker

Follow steps 1–4 above, but skip the `client:` service — the server only needs to run, and **port 4000 must be reachable** from the internet (open it in the firewall):

```bash
# In docker-compose.yml, change the server ports line to:
# ports: ['4000:4000']
```

### Client: deploy to Vercel

1. Push the repo to GitHub.
2. Import the repo in Vercel; set **Root Directory** to `client`.
3. Add an Environment Variable:
   ```
   VITE_API_URL = https://api.yourdomain.com
   ```
4. Deploy. Vercel runs `npm run build` automatically.

> The `VITE_API_URL` env var is baked into the JS bundle at build time by Vite.
> When it is empty (Option A), nginx proxies `/api` internally — no CORS needed.
> When it is set (Option B), it must match `CORS_ORIGIN` in `server/.env.production`.

---

## Option C — Railway (what agents.codevel.com runs)

Railway builds `server/Dockerfile` and runs **one container** — there is no docker-compose,
so the compose `wa_auth` volume does NOT apply. The container filesystem is **ephemeral**: every
deploy or restart wipes `/app/.wwebjs_auth`, so each connected WhatsApp agent drops back to
**Scan QR** after a deploy. Fix it once with a persistent volume:

1. **Add a Volume** to the server service (Railway → service → **Variables/Settings → Volumes →
   New Volume**). Set the **Mount path** to `/data`.
2. **Add a variable**: `WWEBJS_DATA_PATH=/data/wwebjs_auth`.
3. Redeploy (Railway redeploys automatically on the change).
4. Open the agent → **Connect WhatsApp** → scan **once**. The session now lives on the volume and
   **survives all future deploys** — the server auto-restores connected agents on boot, no re-scan.

> The app reads `WWEBJS_DATA_PATH` (defaults to the local `.wwebjs_auth` when unset, so local dev
> and docker-compose are unaffected). DB and WhatsApp data are separate: Postgres persistence is the
> linked Railway Postgres service; WhatsApp login persistence is this volume.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `docker compose` not found | Use `docker-compose` (v1) or install `docker-compose-plugin` |
| Server crashes on start | Run `docker compose logs server` — usually a missing required env var (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`, `WIDGET_SIGNING_SECRET`, `CORS_ORIGIN`) or a failed `prisma migrate deploy` (check the migration SQL / DB reachability) |
| **WhatsApp shows "Scan QR" again after every deploy (Railway)** | The session dir isn't on a persistent volume. Add a Railway Volume at `/data` + set `WWEBJS_DATA_PATH=/data/wwebjs_auth`, then scan once (see **Option C**). |
| WhatsApp QR keeps resetting (Docker Compose) | The `wa_auth` volume may have been deleted; rescan once and it persists |
| `ANTHROPIC_API_KEY not set` warning | Add the key to `server/.env.production` and restart: `docker compose restart server` |
| Port 80 already in use | Stop the other service (`sudo systemctl stop nginx/apache2`) or change the client port to `8080:80` |
| CORS errors in browser | Make sure `CORS_ORIGIN` in `server/.env.production` matches the exact origin the browser uses (including `https://`) |

---

## File reference

```
PersonalAgents/
├── docker-compose.yml         ← orchestrates all services
├── server/
│   ├── Dockerfile             ← server image (Node + Chromium)
│   ├── .dockerignore
│   ├── docker-entrypoint.sh   ← runs `prisma migrate deploy`, then starts the server
│   ├── .env.production.example ← template — copy to .env.production
│   ├── prisma/schema.prisma            ← dev/test schema (SQLite)
│   ├── prisma/schema.postgres.prisma   ← prod schema (generated; `npm run db:gen-pg`)
│   └── prisma/migrations/              ← committed, forward-only prod migrations
└── client/
    ├── Dockerfile             ← multi-stage build → nginx
    ├── .dockerignore
    ├── nginx.conf             ← SPA routing + /api proxy to server
    └── .env.example           ← VITE_API_URL (empty = nginx proxy mode)
```
