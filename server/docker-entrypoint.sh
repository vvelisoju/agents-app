#!/bin/sh
# Sync the Prisma schema to the database, then start the server.
# Fails loudly (non-zero exit) if the schema can't be applied, so a broken DB
# surfaces as a failed deploy instead of silent 500s at runtime.
set -e

echo "⏳ Syncing database schema (prisma db push)..."
n=0
until npx prisma db push --skip-generate --accept-data-loss; do
  n=$((n + 1))
  if [ "$n" -ge 8 ]; then
    echo "❌ FATAL: database schema sync failed after $n attempts. See the error above."
    exit 1
  fi
  echo "  schema sync attempt $n failed (db may still be starting); retrying in 4s..."
  sleep 4
done

echo "✅ Database schema in sync. Starting server..."
exec npx tsx src/index.ts
