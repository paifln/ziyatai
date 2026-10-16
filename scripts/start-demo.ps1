param([switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath '.env.local')) {
  throw 'Local settings are missing. Follow docs/demo.md before starting the demonstration.'
}
$dockerCommand = Get-Command docker -ErrorAction Stop
$dockerRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $dockerCommand.Source))
function Test-DockerReady {
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } finally { $ErrorActionPreference = $savedPreference }
}
function Test-AntivirusReady {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connection = $client.ConnectAsync('127.0.0.1', 13310)
    if (-not $connection.Wait(1000)) { return $false }
    $stream = $client.GetStream()
    $stream.ReadTimeout = 1000
    $ping = [System.Text.Encoding]::ASCII.GetBytes("zPING`0")
    $stream.Write($ping, 0, $ping.Length)
    $buffer = New-Object byte[] 64
    $count = $stream.Read($buffer, 0, $buffer.Length)
    return [System.Text.Encoding]::ASCII.GetString($buffer, 0, $count).Contains('PONG')
  } catch { return $false }
  finally { $client.Dispose() }
}
if (-not (Test-DockerReady)) {
  $desktopExecutable = Join-Path $dockerRoot 'Docker Desktop.exe'
  if (-not (Test-Path -LiteralPath $desktopExecutable)) { throw 'Start Docker Desktop, then run this script again.' }
  Start-Process -FilePath $desktopExecutable -WindowStyle Hidden
  Write-Host 'Starting Docker Desktop...'
  $dockerDeadline = (Get-Date).AddMinutes(2)
  do {
    Start-Sleep -Seconds 2
    if (Test-DockerReady) { break }
  } while ((Get-Date) -lt $dockerDeadline)
  if (-not (Test-DockerReady)) { throw 'Docker Desktop is not ready. Open it and check its status.' }
}
$requiredContainers = @('ziyatai-local-postgres-1','ziyatai-local-storage-1','ziyatai-local-mail-1','ziyatai-tools-renderer-1','ziyatai-tools-antivirus-1')
$availableContainers = & docker ps -a --format '{{.Names}}'
foreach ($containerName in $requiredContainers) {
  if ($containerName -notin $availableContainers) { throw "Local service $containerName has not been configured. See docs/demo.md." }
}
& docker start @requiredContainers | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not start the demonstration services.' }
& npx tsx scripts/prepare-local-containers.ts
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare local application settings.' }
& docker compose -f infra/compose.app-local.yml up -d --force-recreate
if ($LASTEXITCODE -ne 0) { throw 'Could not start the application.' }
Write-Host 'Waiting for the application and document services...'
$readyDeadline = (Get-Date).AddMinutes(3)
$ready = $false
do {
  try {
    $response = Invoke-WebRequest -Uri 'http://localhost:3000/api/health/ready' -UseBasicParsing -TimeoutSec 5
    $rendererResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:18090/health' -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200 -and $rendererResponse.StatusCode -eq 200 -and (Test-AntivirusReady)) { $ready = $true; break }
  } catch { }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $readyDeadline)
if (-not $ready) { throw 'Services did not become ready. Check Docker Desktop and docs/demo.md.' }
Write-Host ''
Write-Host 'ZiyatAI: http://localhost:3000'
Write-Host 'Lite:    http://localhost:3000/lite/'
Write-Host 'Codes:   http://localhost:8025 (local demonstration mailbox)'
Write-Host 'Keep this computer and Docker Desktop running during the demonstration.'
if ($OpenBrowser) { Start-Process 'http://localhost:3000' }
exit 0
