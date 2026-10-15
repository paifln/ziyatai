$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& npx tsx scripts/prepare-local-containers.ts
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare container settings.' }
& docker compose -f infra/compose.app-local.yml up -d --force-recreate
if ($LASTEXITCODE -ne 0) { throw 'Could not restart application containers.' }
Write-Host 'Settings applied. Open http://localhost:3000'
