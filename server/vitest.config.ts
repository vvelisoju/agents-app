import { defineConfig } from 'vitest/config';

// QA-01: all tests run in ONE forked process (matches the shared singleton
// PrismaClient and the single isolated SQLite test DB) and load tests/setup.ts
// FIRST, which forces an isolated DATABASE_URL and hard-fails on a prod DB.
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['./tests/setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Quiet the expected prod-DB-guard warning noise during normal runs; set to
    // 'default' when debugging the guard.
    reporters: 'default',
  },
});
