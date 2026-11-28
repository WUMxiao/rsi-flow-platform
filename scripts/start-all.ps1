# Start the backend stack: Node worker (39100) + Java backend (39910, H2 in-memory).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
# Requires: Java 8+ on PATH. The backend jar ships with the repo (backend/core-starter-case.jar).
param(
    [string]$Jar = "$PSScriptRoot\..\backend\core-starter-case.jar",
    [string]$EnvFile = "$PSScriptRoot\..\.env.local"
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\.."

if (-not (Test-Path $Jar)) { throw "missing $Jar - run scripts\build-backend.ps1 first" }
if (-not (Test-Path $EnvFile)) { throw "missing $EnvFile - copy .env.example to .env.local and fill OPENAI_*" }

Write-Host '[1/2] starting Node worker on 39100 ...'
Start-Process -FilePath node -ArgumentList "--env-file=$EnvFile", 'server/worker.mjs' -WorkingDirectory $repo -WindowStyle Hidden

Start-Sleep -Seconds 2

Write-Host '[2/2] starting Java backend on 39910 (H2 in-memory) ...'
$env:SPRING_DATASOURCE_URL = 'jdbc:h2:mem:flow;MODE=MySQL;DB_CLOSE_DELAY=-1'
$env:SPRING_DATASOURCE_DRIVER_CLASS_NAME = 'org.h2.Driver'
$env:SPRING_DATASOURCE_USERNAME = 'sa'
$env:SPRING_DATASOURCE_PASSWORD = ''
$env:EUREKA_CLIENT_ENABLED = 'false'
Start-Process -FilePath java -ArgumentList '-jar', $Jar, '--spring.profiles.active=dev', '--logging.level.root=WARN' -WorkingDirectory $repo -WindowStyle Hidden

Start-Sleep -Seconds 25
$workerUp = Test-NetConnection -ComputerName 127.0.0.1 -Port 39100 -InformationLevel Quiet -WarningAction SilentlyContinue
$backendUp = Test-NetConnection -ComputerName 127.0.0.1 -Port 39910 -InformationLevel Quiet -WarningAction SilentlyContinue
Write-Host ''
Write-Host ("worker  39100 -> " + $workerUp)
Write-Host ("backend 39910 -> " + $backendUp)
Write-Host ''
Write-Host 'Page: pnpm dev, then http://localhost:3000/orchestration -> tab "backend run"'
Write-Host 'Batch: node server/run-all-backend.mjs 3'
