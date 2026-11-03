param(
  [ValidateSet('check', 'desktop', 'desktop-debug', 'android-init', 'android', 'android-debug')]
  [string]$Task = 'check'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'toolchain.ps1')
Set-Location -LiteralPath $projectRoot

function Copy-DesktopHost([string]$buildKind) {
  # --no-bundle 不执行安装器资源暂存；便携程序使用与安装包相同的 host 相对目录。
  $hostSource = Join-Path $projectRoot '.artifacts/desktop-host'
  $hostTarget = Join-Path $projectRoot "src-tauri/target/$buildKind/host"
  New-Item -ItemType Directory -Path $hostTarget -Force | Out-Null
  foreach ($file in @('node.exe', 'main.mjs', 'LICENSE.txt')) {
    Copy-Item -LiteralPath (Join-Path $hostSource $file) -Destination (Join-Path $hostTarget $file) -Force
    if ((Get-FileHash -LiteralPath (Join-Path $hostSource $file)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $hostTarget $file)).Hash) { throw 'Desktop host staging differs from its build.' }
  }
}

switch ($Task) {
  'check' { & node scripts/check-platform.mjs }
  'desktop' {
    & pnpm exec tauri build --no-bundle
    if ($LASTEXITCODE -eq 0) { Copy-DesktopHost 'release' }
  }
  'desktop-debug' {
    & pnpm exec tauri build --debug --no-bundle
    if ($LASTEXITCODE -eq 0) { Copy-DesktopHost 'debug' }
  }
  'android-init' {
    & pnpm exec tauri android init
    if ($LASTEXITCODE -eq 0) { & node scripts/configure-android.mjs }
  }
  'android' { & pnpm exec tauri android build --apk --target aarch64 }
  'android-debug' { & pnpm exec tauri android build --debug --apk --target aarch64 }
}

exit $LASTEXITCODE
