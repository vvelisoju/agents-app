# Database Migrations

How schema changes are authored, generated, and applied to production for the Secure Agents
server (`server/`, Prisma 5.22). This is the reference for the **dual-schema** strategy, the
**edit → generate → diff → deploy** workflow, the hard **never-`db push`-prod** rule, and the
**recovery runbook** for failed or partially-applied migrations.

> **One rule above all:** migrations are **additive and forward-only**, applied to prod only via
> `prisma migrate deploy`. There is no automatic rollback — recovery is always a *new forward*
> migration. `prisma db push` is for local SQLite only and must **never** touch prod.

---

## 1. The dual-schema strategy

Prisma is driven by **two schema files** on purpose (`server/scripts/gen-pg-schema.js`):

| File | Provider | Committed? | Used for |
|---|---|---|---|
| `prisma/schema.prisma` | `sqlite` | yes — **canonical, hand-edited** | Zero-setup local dev + the fast isolated test suite (no local Postgres needed) |
| `prisma/schema.postgres.prisma` | `postgresql` | yes — **auto-generated, never hand-edit** | Prod runtime (`@prisma/client`) + all Prisma **migrations** |

**Why two.** The test suite and local dev run against SQLite (`file:...`) so a developer needs no
database server and tests stay fast and isolated. Production runs on Railway Postgres. Keeping
`schema.prisma` on SQLite as the source of truth and *deriving* the Postgres variant means one set
of models, two datasource providers.

**They must stay identical except for the provider.** `schema.postgres.prisma` carries a
`DO NOT EDIT BY HAND` banner. The only differences from `schema.prisma` are the generated banner and
`provider = "postgresql"` in the `datasource db` block. `migration_lock.toml` is pinned to
`postgresql`, so migrations are authored and applied for Postgres only.

### How the Postgres schema is generated

`npm run db:gen-pg` runs `node scripts/gen-pg-schema.js`, which:

1. Reads `prisma/schema.prisma` and **asserts** it uses `provider = "sqlite"` (exits non-zero otherwise).
2. Replaces `provider = "sqlite"` with `provider = "postgresql"`.
3. Strips the leading comment block and prepends the `AUTO-GENERATED … DO NOT EDIT BY HAND` banner.
4. Writes `prisma/schema.postgres.prisma`.

The models, indexes, and relations are copied verbatim — only the datasource provider changes.

### CI keeps the two in sync

Two CI gates (`.github/workflows/ci.yml`) protect this setup:

- **Postgres schema in sync (DB-5).** CI re-runs `node scripts/gen-pg-schema.js` and fails if
  `git diff --exit-code prisma/schema.postgres.prisma` shows drift — i.e. someone edited
  `schema.prisma` but did not commit the regenerated Postgres file (or hand-edited the generated one).
  Fix: `npm run db:gen-pg` and commit.
- **No destructive schema sync on the prod path (QA-12).** CI greps `docker-entrypoint.sh` and the
  `Dockerfile` for `accept-data-loss`, `force-reset`, or `db push` and fails the build if any appears.
  The prod boot path is allowed to use `migrate deploy` only.

---

## 2. The migration workflow

Author on your machine, commit the generated SQL, let deploy apply it. **Never generate or edit
migrations against the live database.**

### Step by step

| Step | Command | What it does |
|---|---|---|
| 1. Edit models | — | Change `prisma/schema.prisma` (SQLite, canonical) **only**. |
| 2. Generate PG schema | `npm run db:gen-pg` | Regenerates `prisma/schema.postgres.prisma`. |
| 3. Create the migration SQL | `prisma migrate diff` (see below) | Produces the forward SQL into a new `prisma/migrations/<timestamp>_<name>/migration.sql`. |
| 4. Review | — | Read the generated SQL: confirm it is **additive** (new columns default or nullable, new tables/indexes), with no destructive `DROP`/`ALTER … TYPE`/rewrite. |
| 5. Commit | `git add prisma/` | Commit `schema.prisma`, `schema.postgres.prisma`, and the new migration folder together. |
| 6. Inspect prod state | `npm run migrate:status` | `prisma migrate status --schema prisma/schema.postgres.prisma` — shows which migrations are applied/pending against `DATABASE_URL`. Read-only. |
| 7. Apply to prod | `npm run migrate:deploy` | `prisma migrate deploy --schema prisma/schema.postgres.prisma` — applies committed, already-generated migrations in order. Forward-only; never prompts or generates. |

In production, **step 7 runs automatically on boot** — see §3.

### Authoring the SQL (step 3)

`npm run migrate:diff` (DB-20) wraps the `prisma migrate diff` invocation below and prints the forward
SQL to **stdout**; redirect it into a new migration folder. (`db:gen-pg`, `migrate:status`,
`migrate:deploy`, `migrate:dev` are the other wrapped scripts.) It diffs the migration history against
the regenerated Postgres schema, always with `--schema prisma/schema.postgres.prisma` so you diff
Postgres DDL:

```sh
# from server/
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_<name>
npm run migrate:diff > prisma/migrations/<timestamp>_<name>/migration.sql
# equivalently, the raw command migrate:diff wraps:
#   prisma migrate diff --from-migrations prisma/migrations \
#     --to-schema-datamodel prisma/schema.postgres.prisma --script
```

For local iteration against a throwaway Postgres you can instead use `npm run migrate:dev` (creates +
applies a dev migration interactively). Reset the local **SQLite** dev DB with `npm run db:reset`
(DB-16) — `prisma db push --force-reset`, which drops and recreates every table from `schema.prisma`.

Name the folder `<timestamp>_<snake_case_name>` to match the existing history (e.g.
`20261114210000_connectors`). The SQL should read like the shipped migrations — `CreateTable`,
`AlterTable ADD COLUMN … DEFAULT …`, `CreateIndex`, `AddForeignKey` — never a column drop or type
rewrite on existing data.

### The `0_init` baseline

`prisma/migrations/0_init/` is the **baseline** snapshot of the schema as it already existed on the
live prod DB. It was marked **applied** on prod (`prisma migrate resolve --applied 0_init`) rather than
executed, so `migrate deploy` only ever runs the migrations added *after* the baseline. Do not re-run
or edit `0_init`.

### The deploy command's guarantees

`migrate deploy`:

- applies only **committed, already-generated** migration files, in filename order;
- is **forward-only** — it never rolls back and never auto-generates a migration;
- never prompts and never asks for data-loss acceptance — it is the correct, safe prod command;
- records each applied migration in the `_prisma_migrations` table (name, checksum, timestamps).

---

## 3. How prod applies migrations

On every deploy, `server/docker-entrypoint.sh` runs migrations **before** the server starts (DB-4):

```sh
until npx prisma migrate deploy --schema prisma/schema.postgres.prisma; do
  # retry up to 8 times, 4s apart (DB may still be starting), then FATAL exit 1
done
exec npx tsx src/index.ts
```

So the sequence on a Railway redeploy is: **migrate deploy (with retry) → start server**. The retry
loop tolerates a database that is still waking up; after 8 failed attempts it exits fatally rather
than starting the server against an un-migrated DB. This replaced an earlier destructive
sync-on-boot, which could silently drop prod columns.

Because deploy only applies migrations committed in the image, the forward-only guarantee holds
automatically in prod: you ship a new migration file, redeploy, and it runs once.

---

## 4. The NEVER-`db push`-prod rule

```
db push  →  local SQLite dev ONLY.     NEVER against Postgres / prod.
```

- `npm run db:push` runs `prisma db push --skip-generate`. It **force-syncs the database to match the
  schema** with no migration history and **no additive guarantee** — against Postgres it will drop or
  rewrite columns to make the DB match, destroying data on a live database.
- The prod boot path uses `migrate deploy` only; CI (QA-12) fails the build if `db push`,
  `accept-data-loss`, or `force-reset` appear in `docker-entrypoint.sh` or the `Dockerfile`.
- **`DATABASE_URL` points at the live Railway Postgres in prod.** Any `migrate`/`push`/`studio`
  command targets whatever `DATABASE_URL` is set to. `isPostgres()` (`server/src/lib/spineEnv.ts`)
  treats any URL that is not `file:` / `sqlite:` as Postgres. Before running *anything* that writes
  schema, confirm your `DATABASE_URL` and **override it** for test / `db push` work so you cannot
  touch prod by accident.

Use `db push` only against a local `file:./dev.db` SQLite URL. Everything that reaches Postgres goes
through reviewed, committed migration files.

---

## 5. Recovery runbook

`migrate deploy` is forward-only, so the general recovery pattern is: **inspect state, resolve the
stuck entry, then roll forward with a new corrective migration.** Always run against the Postgres
schema and confirm `DATABASE_URL` first.

```sh
npm run migrate:status   # prisma migrate status --schema prisma/schema.postgres.prisma
```

### 5.1 A migration failed or applied only partially

Symptom: `migrate deploy` errored mid-migration; `migrate:status` reports a migration **started but
failed** / not finished, and later deploys refuse to proceed past it.

1. **Inspect** which migration is stuck and read the error — it names the failing statement.
2. **Check what actually landed.** Postgres runs each statement in the migration; a partial apply
   means some DDL committed and some did not. Query the live schema (`\d <table>`, `information_schema`)
   to see exactly what exists.
3. **Choose one path:**
   - **Finish it manually, then mark applied** — if the remaining statements are safe to run by hand,
     apply them in a `psql` session, then tell Prisma the migration is done:
     ```sh
     prisma migrate resolve --applied <migration_name> --schema prisma/schema.postgres.prisma
     ```
   - **Treat it as not applied, then roll forward** — if nothing of the migration should remain, undo
     any partial DDL by hand so the DB matches the pre-migration state, mark it rolled back (§5.3),
     then ship a corrected migration.
4. **Redeploy.** `migrate deploy` continues from the resolved point.

Never hand-edit a migration file that has already been (partly) applied to prod — its checksum is
recorded in `_prisma_migrations` and Prisma will flag drift. Correct forward with a new migration.

### 5.2 An `INVALID` index from a failed `CREATE INDEX CONCURRENTLY`

The shipped migrations do not use `CONCURRENTLY` today (indexes are created inline), but if a future
migration adds a concurrent index to avoid locking a large table, note that `CREATE INDEX
CONCURRENTLY` **cannot run inside a transaction** and, on failure, leaves behind an **`INVALID`**
index that is never used by the planner but still consumes space and blocks a re-create of the same name.

Recover:

1. **Find invalid indexes:**
   ```sql
   SELECT c.relname
   FROM pg_index i
   JOIN pg_class c ON c.oid = i.indexrelid
   WHERE NOT i.indisvalid;
   ```
2. **Drop the invalid index** (concurrently, to avoid locks):
   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS "<index_name>";
   ```
3. **Re-create it**, then reconcile Prisma's state for that migration with `migrate resolve`
   (`--applied` if the rest of the migration is complete, `--rolled-back` if you backed it all out).

Because a concurrent build cannot be wrapped in a transaction, such a migration should contain **only**
the `CREATE INDEX CONCURRENTLY` statement — never mix it with other DDL in the same file.

### 5.3 `migrate resolve --rolled-back`

When a migration is recorded as *failed/started* in `_prisma_migrations` but you have **manually
reverted** everything it did (so the DB is back to the pre-migration state), tell Prisma to forget it
so it can be retried:

```sh
prisma migrate resolve --rolled-back <migration_name> --schema prisma/schema.postgres.prisma
```

This clears the failed entry. The typical full loop:

1. `migrate deploy` fails on `<migration_name>`.
2. You manually undo any partial DDL so the live schema matches the prior state.
3. `migrate resolve --rolled-back <migration_name>`.
4. Fix the migration SQL (or author a corrected successor), commit.
5. Redeploy → `migrate deploy` applies the fixed migration cleanly.

Use `--rolled-back` only after you have genuinely reverted the changes; use `--applied` (§5.1) when
you instead completed them by hand. Picking the wrong one leaves `_prisma_migrations` out of step with
the real schema.

---

## See also

- `docs/OPERATIONS.md` §3 — migrations in the context of the prod runbook (flags, health, shutdown).
- `docs/DATA_MODEL.md` — the models these migrations build.
- `server/scripts/gen-pg-schema.js` — the generator; `.github/workflows/ci.yml` — the sync + no-`db push` gates.
