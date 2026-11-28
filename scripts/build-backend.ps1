# 构建后端运行包：把节点实现与 H2 注入原 fat jar，产出 core-starter-case.jar
# 前提：JDK 8 + Python 3；原 fat jar 位于 rsi-flow-spring-boot/core-starter/target/
param(
    [string]$SourceJar = "$PSScriptRoot\..\..\rsi-flow-spring-boot\core-starter\target\core-starter-1.0.0-executable.jar",
    [string]$H2Jar     = "$PSScriptRoot\..\..\.tools\h2-1.4.200.jar",
    [string]$OutJar    = "$PSScriptRoot\..\backend\core-starter-case.jar"
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\.."
$build = Join-Path $repo 'build'
$fat = Join-Path $build 'fat'
$classes = Join-Path $build 'classes'

if (-not (Test-Path $SourceJar)) { throw "找不到原 fat jar: $SourceJar" }
if (-not (Test-Path $H2Jar))     { throw "找不到 H2 jar: $H2Jar（可用 mvn dependency:get 或从 Maven Central 下载 h2-1.4.200.jar）" }

Write-Host '[1/4] 解包原 jar ...'
if (Test-Path $fat) { Remove-Item $fat -Recurse -Force }
if (Test-Path $classes) { Remove-Item $classes -Recurse -Force }
New-Item -ItemType Directory -Force -Path $fat, $classes | Out-Null
Push-Location $build
try { py -3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" $SourceJar $fat }
finally { Pop-Location }

Write-Host '[2/4] 编译节点类 ...'
$cp = "$fat\BOOT-INF\lib\*;$fat\BOOT-INF\classes"
& javac -parameters -encoding UTF-8 -cp $cp -d $classes `
    (Join-Path $repo 'server\FlowCodeRun.java') `
    (Join-Path $repo 'server\FlowCodeCase.java') `
    (Join-Path $repo 'server\CorsConfig.java')
if ($LASTEXITCODE -ne 0) { throw 'javac 失败' }

Write-Host '[3/4] 重新打包 ...'
$py = @'
import zipfile, shutil, sys, os
src, dst, h2, cls, flowjson = sys.argv[1:6]
shutil.copyfile(src, dst)
with zipfile.ZipFile(dst, 'a', compression=zipfile.ZIP_STORED) as z:
    z.write(h2, 'BOOT-INF/lib/h2-1.4.200.jar')          # 嵌套 jar 必须 STORED
with zipfile.ZipFile(dst, 'a', compression=zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(cls):
        for f in files:
            if f.endswith('.class'):
                p = os.path.join(root, f)
                z.write(p, 'BOOT-INF/classes/' + os.path.relpath(p, cls).replace('\\', '/'))
    if os.path.exists(flowjson):
        z.write(flowjson, 'BOOT-INF/classes/flow/Case/flow-case-IB-06.json')
print('patched', dst)
'@
$pyPath = Join-Path $build 'patch-jar.py'
Set-Content -Path $pyPath -Value $py -Encoding utf8
& py -3 $pyPath $SourceJar $OutJar $H2Jar $classes (Join-Path $repo 'cases\backend\CASE_IB-06.json')
if ($LASTEXITCODE -ne 0) { throw '打包失败' }

Write-Host "[4/4] 完成：$OutJar"
