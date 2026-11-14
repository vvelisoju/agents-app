// DB-1/DB-5 — generate the Postgres schema from the canonical schema.prisma.
// The committed schema.prisma stays SQLite so the fast, isolated test suite (QA-01)
// and zero-setup local dev keep working. schema.postgres.prisma is the Postgres variant
// used for PROD runtime + Prisma migrations (there is no local Postgres here). A CI check
// keeps the two in sync (identical models; only the datasource provider differs).
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const out = path.join(__dirname, '..', 'prisma', 'schema.postgres.prisma');

let s = fs.readFileSync(src, 'utf8');
if (!/provider\s*=\s*"sqlite"/.test(s)) {
  console.error('expected schema.prisma to use provider "sqlite"'); process.exit(1);
}
s = s.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');

const banner =
  '// AUTO-GENERATED from schema.prisma by `npm run db:gen-pg` — DO NOT EDIT BY HAND.\n' +
  '// Postgres variant for prod runtime + migrations. Dev/test use schema.prisma (SQLite).\n' +
  '// Keep models identical in schema.prisma; run db:gen-pg after any schema change.\n\n';

fs.writeFileSync(out, banner + s.replace(/^\/\/[^\n]*\n(\/\/[^\n]*\n)*/, ''));
console.log('wrote', path.relative(process.cwd(), out));
