// ─────────────────────────────────────────────────────────────────────────────
// QA-01 — Isolated test database + hard production-DB guard.
//
// server/.env's DATABASE_URL points at the LIVE Railway Postgres. A test run must
// NEVER connect to it. This file runs BEFORE any test module (and before Prisma is
// instantiated via the app import chain), so it forces DATABASE_URL to an isolated,
// ephemeral SQLite file and refuses to run if anything still looks like production.
//
// Gate speed (Wave 0): the schema is built with `prisma db push` exactly ONCE per run
// (the first setup invocation); every subsequent test file resets state by DELETE-ing
// all rows through the live connection — a few milliseconds versus a full ~3.7s push.
// Isolation is identical (each file starts with empty tables); only the cost drops.
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// Anything that looks like a managed/remote/production database. If the incoming
// DATABASE_URL matches, we ignore it (and the final assertion below guarantees we
// only ever point Prisma at a local SQLite file).
const FORBIDDEN = /(postgres(ql)?:\/\/|railway|rlwy\.net|\.proxy\.|amazonaws|supabase|neon\.tech|mysql:\/\/|mongodb)/i;

const incoming = process.env.DATABASE_URL || '';
if (incoming && FORBIDDEN.test(incoming)) {
  const masked = incoming.replace(/\/\/[^@]*@/, '//***@');
  // eslint-disable-next-line no-console
  console.warn(
    `\n[test-guard] A non-test DATABASE_URL is set (${masked}).\n` +
      `[test-guard] Ignoring it — tests use an isolated SQLite database instead.\n`,
  );
}

// Per-run, per-process isolated DB file (matched by server/.gitignore's *.db).
const TEST_DB = path.join(__dirname, `.vitest-${process.pid}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-unused';

// Belt-and-suspenders: never proceed unless Prisma will hit a local SQLite file.
if (!process.env.DATABASE_URL.startsWith('file:') || FORBIDDEN.test(process.env.DATABASE_URL)) {
  throw new Error('[test-guard] refusing to run: DATABASE_URL is not an isolated SQLite file');
}

const g = globalThis as unknown as { __TEST_SCHEMA_BUILT?: boolean };

if (!g.__TEST_SCHEMA_BUILT) {
  // First setup of the run: build the schema fresh (drops any stale test DB).
  execSync('npx prisma db push --skip-generate --force-reset --accept-data-loss', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'ignore',
  });
  g.__TEST_SCHEMA_BUILT = true;

  // Remove the ephemeral DB (and its journal/WAL) when the test process exits.
  process.on('exit', () => {
    for (const f of [TEST_DB, `${TEST_DB}-journal`, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
      try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
    }
  });
} else {
  // Subsequent files: fast reset — empty every table through the live connection so each
  // file still starts from a pristine, empty database (no schema rebuild).
  const prisma = (await import('../src/lib/prisma')).default;
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`,
  );
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
  for (const { name } of rows) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${name}"`);
  }
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
}
