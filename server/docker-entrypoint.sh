#!/bin/sh
# DB-4 — apply pending Prisma migrations (forward-only, reviewed SQL with history),
# then start the server. This replaces the previous destructive sync-on-boot (and its
# reset escape hatch), which could silently drop prod columns/data.
#
# Migrations are Postgres (prisma/schema.postgres.prisma). The baseline (0_init) was
# marked applied on the existing prod DB; migrate deploy only runs NEW migrations.
set -e

echo "⏳ Applying database migrations (prisma migrate deploy)..."
n=0
until npx prisma migrate deploy --schema prisma/schema.postgres.prisma; do
  n=$((n + 1))
  if [ "$n" -ge 8 ]; then
    echo "❌ FATAL: prisma migrate deploy failed after $n attempts. See the error above."
    exit 1
  fi
  echo "  migrate attempt $n failed (db may still be starting); retrying in 4s..."
  sleep 4
done

echo "✅ Migrations applied. Starting server..."
exec npx tsx src/index.ts
