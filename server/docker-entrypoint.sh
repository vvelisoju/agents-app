#!/bin/sh
# Sync the Prisma schema to the database, then start the server.
# Fails loudly (non-zero exit) if the schema can't be applied, so a broken DB
# surfaces as a failed deploy instead of silent 500s at runtime.
#
# One-time reset: set DB_FORCE_RESET=true in the environment to DROP and recreate
# the database on boot (ALL DATA LOST), then remove the var. Use this when a
# schema change can't apply over existing rows (e.g. adding a required column).
set -e

PUSH_FLAGS="--skip-generate --accept-data-loss"
if [ "$DB_FORCE_RESET" = "true" ]; then
  echo "⚠️  DB_FORCE_RESET=true — dropping and recreating the database. ALL DATA WILL BE LOST."
  echo "    Remove this variable after this deploy so it never wipes again."
  PUSH_FLAGS="$PUSH_FLAGS --force-reset"
fi

echo "⏳ Syncing database schema (prisma db push $PUSH_FLAGS)..."
n=0
until npx prisma db push $PUSH_FLAGS; do
  n=$((n + 1))
  if [ "$n" -ge 8 ]; then
    echo "❌ FATAL: database schema sync failed after $n attempts. See the error above."
    echo "   If this is a destructive change over existing rows, set DB_FORCE_RESET=true once."
    exit 1
  fi
  echo "  schema sync attempt $n failed (db may still be starting); retrying in 4s..."
  sleep 4
done

echo "✅ Database schema in sync. Starting server..."
exec npx tsx src/index.ts
