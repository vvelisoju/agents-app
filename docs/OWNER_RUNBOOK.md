# Owner runbook — maintenance-window & gated tasks

These backlog items can't be shipped silently: they either log everyone out, rewrite columns, or need
backup access. Each is **built/ready** but needs you to run it in a chosen window. Do them one at a
time, verify, and keep the reply path working throughout.

---

## 1. Token hashing + expiry (SEC‑3/4/5) — **logs everyone out once**

Today the bearer token is stored and looked up in plaintext (`User.token`). The hashed scheme stores
only `tokenHash` + `tokenExpiresAt`; the infra is ready (`lib/tokenAuth.ts`: `hashToken`,
`newRawToken`, `tokenExpiry`, `isExpired`; columns already migrated).

**Effect:** every current session becomes invalid → all users (you + staff) must log in again once.

**Steps (code change + deploy, ~30 min, low-traffic window):**
1. On **login/signup/reset**: `const raw = newRawToken()` → store `tokenHash: hashToken(raw)`,
   `tokenExpiresAt: tokenExpiry()`, and return `raw` to the client (unchanged client contract).
2. In **`middleware/auth.ts`**: look the user up by `tokenHash: hashToken(incoming)` and reject when
   `isExpired(user.tokenExpiresAt)`. Add a `/api/auth/logout` that clears the hash.
3. Add rotate-on-login (new token each login) and a test asserting an expired token → 401.
4. Deploy; confirm you can log in and old tabs get 401.

**Rollback:** revert the auth lookup to `token`; existing plaintext tokens still work. Keep both
columns during the transition.

---

## 2. `orgId` NOT‑NULL enforcement (DB) — **after a rehearsal**

The backfilled `orgId` columns (Message, TrainingProfile, TrainingSource, ChannelSession) are
nullable. Making them NOT NULL is safe only once every row is backfilled.

**Steps:**
1. **Rehearse (read-only):** `SELECT count(*) FROM "Message" WHERE "orgId" IS NULL;` (repeat per table).
   All must be 0. If not, run the backfill again from the owning agent.
2. Add a migration `ALTER TABLE "Message" ALTER COLUMN "orgId" SET NOT NULL;` (per table), update
   `schema.prisma` to drop the `?`, `npm run db:gen-pg`, `npm run migrate:deploy`.
3. Verify writes still succeed (send a test message; create training).

**Rollback:** a reverse migration dropping NOT NULL. Only ship after the rehearsal shows 0 nulls.

---

## 3. DR restore drill (DB‑17 / QA‑48) — **needs Railway backup access**

Prove the backup is restorable before you ever need it.

**Steps:**
1. In Railway → Postgres → **Backups**, take/download a current backup.
2. Spin up a **throwaway** Postgres (Railway or local), restore the backup into it.
3. Point a local server at it (`DATABASE_URL=<restore>` + `npm run migrate:status` → "up to date"),
   log in, read an agent + its messages — confirm the data is intact.
4. Record the restore time + any gaps. Tear down the throwaway DB.

Do **not** restore over production. This is a read-only verification against a copy.

---

## 4. Turning features on in prod (no window needed)

Set in Railway → **Variables** (I can also do these via CLI on your word):
- `WORKFLOW_ENABLED=1` · `MONITOR_ENABLED=1` · `MEMORY_ENABLED=1` — **already on**.
- `OUTBOUND_ENABLED=1` — only when you're ready to supervise a drip from a **secondary number**
  (accepted ban-risk; start a tiny campaign + approve it).
- **RAG vectors:** `EMBEDDINGS_PROVIDER=voyage|openai|cohere` + the matching key → then
  `POST /api/agents/:id/knowledge/reindex` to embed documents uploaded before the key.

Each flag is reversible (remove it / set `0` and restart). See `docs/OPERATIONS.md` for the full flag
reference and `docs/SECURITY.md` for the posture.
