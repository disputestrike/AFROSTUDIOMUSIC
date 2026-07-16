#!/usr/bin/env bash
set -euo pipefail

echo "==> pnpm install"
pnpm install

echo "==> docker compose up"
docker compose -f docker-compose.dev.yml up -d
sleep 5

echo "==> prisma db push"
pnpm --filter @afrohit/db push
echo "==> postgis indexes"
psql "postgresql://afrohit:afrohit@localhost:5432/afrohit" -f packages/db/sql/01-postgis-indexes.sql || true
echo "==> seed"
pnpm --filter @afrohit/db seed

echo "==> Done. Run: pnpm dev"
