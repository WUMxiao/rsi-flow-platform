# 一键启动后端链路：Node worker(39100) + Java 后端(39910)
# 用法：powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
param(
    [string]$Jar = "$PSScriptRoot\..\backend\core-starter-case.jar",
    [string]$EnvFile = "$PSScriptRoot\..\.env.local"
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\.."

if (-not (Test-Path $Jar)) { throw "找不到 $Jar，先跑 scripts\build-backend.ps1" }
if (-not (Test-Path $EnvFile)) { throw "找不到 $EnvFile，先 cp .env.example .env.local 并填 OPENAI_*" }

Write-Host '[1/2] 启动 Node worker (39100) ...'
Start-Process -FilePath node -ArgumentList "--env-file=$EnvFile", 'server/worker.mjs' -WorkingDirectory $repo -WindowStyle Hidden

Start-Sleep -Seconds 2

Write-Host '[2/2] 启动 Java 后端 (39910，H2 内存库) ...'
$env:SPRING_DATASOURCE_URL = 'jdbc:h2:mem:flow;MODE=MySQL;DB_CLOSE_DELAY=-1'
$env:SPRING_DATASOURCE_DRIVER_CLASS_NAME = 'org.h2.Driver'
$env:SPRING_DATASOURCE_USERNAME = 'sa'
$env:SPRING_DATASOURCE_PASSWORD = ''
$env:EUREKA_CLIENT_ENABLED = 'false'
Start-Process -FilePath java -ArgumentList '-jar', $Jar, '--spring.profiles.active=dev', '--logging.level.root=WARN' -WorkingDirectory $repo -WindowStyle Hidden

Start-Sleep -Seconds 25
Write-Host ''
Write-Host '检查：'
Write-Host ("  worker  39100 -> " + (Test-NetConnection -ComputerName 127.0.0.1 -Port 39100 -InformationLevel Quiet -WarningAction SilentlyContinue))
Write-Host ("  backend 39910 -> " + (Test-NetConnection -ComputerName 127.0.0.1 -Port 39910 -InformationLevel Quiet -WarningAction SilentlyContinue))
Write-Host ''
Write-Host '页面：pnpm dev 后打开 http://localhost:3000/orchestration → “后端运行”页签'
Write-Host '批量：node server/run-all-backend.mjs 3'
