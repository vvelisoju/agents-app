# Deployment Guide

Two options. Pick one.

| Option | Client | Server | Best for |
|--------|--------|--------|---------|
| **A — Full Docker** | nginx container (port 80) | Express container | Single VPS, simplest |
| **B — Split** | Vercel / Netlify | Docker on VPS | CDN edge + separate API host |

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
| `DATABASE_URL` | Leave as `file:./prod.db` for SQLite, or a postgres URL |

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

### 7. Database: SQLite → PostgreSQL (optional)

The default is SQLite (`file:./prod.db`), which is fine for a single-server setup.

To switch to Postgres:

1. In `server/.env.production`, set:
   ```
   DATABASE_URL=postgresql://postgres:agents@postgres:5432/agents
   ```
2. In `server/prisma/schema.prisma`, change:
   ```
   provider = "postgresql"
   ```
3. In `docker-compose.yml`, uncomment the `DATABASE_URL` line under `server`.
4. Redeploy: `docker compose up --build -d`

The first boot runs `prisma db push` which creates all tables automatically.

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
| Server crashes on start | Run `docker compose logs server` — usually a missing env var or DB migration error |
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
│   ├── .env.production.example ← template — copy to .env.production
│   └── prisma/schema.prisma   ← change provider here for PostgreSQL
└── client/
    ├── Dockerfile             ← multi-stage build → nginx
    ├── .dockerignore
    ├── nginx.conf             ← SPA routing + /api proxy to server
    └── .env.example           ← VITE_API_URL (empty = nginx proxy mode)
```
