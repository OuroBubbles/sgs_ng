param(
  [ValidateSet('check', 'desktop', 'desktop-debug', 'android-init', 'android', 'android-debug')]
  [string]$Task = 'check'
)

. (Join-Path $PSScriptRoot 'toolchain.ps1')
Set-Location -LiteralPath $projectRoot

switch ($Task) {
  'check' { & node scripts/check-platform.mjs }
  'desktop' { & pnpm exec tauri build --no-bundle }
  'desktop-debug' { & pnpm exec tauri build --debug --no-bundle }
  'android-init' {
    & pnpm exec tauri android init
    if ($LASTEXITCODE -eq 0) { & node scripts/configure-android.mjs }
  }
  'android' { & pnpm exec tauri android build --apk --target aarch64 }
  'android-debug' { & pnpm exec tauri android build --debug --apk --target aarch64 }
}

exit $LASTEXITCODE
