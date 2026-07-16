# PowerShell setup for Windows devs. Run from repo root.
# Usage:  .\scripts\setup.ps1

$ErrorActionPreference = "Stop"

Write-Host "==> Installing pnpm dependencies" -ForegroundColor Cyan
pnpm install

Write-Host "==> Starting Postgres + Redis + MinIO via Docker" -ForegroundColor Cyan
docker compose -f docker-compose.dev.yml up -d
Start-Sleep -Seconds 5

Write-Host "==> Pushing Prisma schema and seeding" -ForegroundColor Cyan
pnpm --filter @afrohit/db push
psql "postgresql://afrohit:afrohit@localhost:5432/afrohit" -f packages/db/sql/01-postgis-indexes.sql 2>$null
pnpm --filter @afrohit/db seed

Write-Host "==> Done. Run: pnpm dev" -ForegroundColor Green
