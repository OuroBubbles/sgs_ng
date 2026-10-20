param(
  [ValidateSet('debug', 'release')]
  [string]$BuildKind = 'release'
)

# 只启动并关闭本脚本拥有的程序；不复用旧 CDP 端点作为当前构建的证据。
$ErrorActionPreference = 'Stop'
$verifyRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
& node (Join-Path $verifyRoot 'scripts/build-content.mjs') (Join-Path $verifyRoot 'examples/content/harbor/index.ts') (Join-Path $verifyRoot '.artifacts/content/harbor.sgs.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Content example build failed.' }
& node (Join-Path $verifyRoot 'scripts/build-content.mjs') (Join-Path $verifyRoot 'examples/content/gallery/index.ts') (Join-Path $verifyRoot '.artifacts/content/gallery.sgs')
if ($LASTEXITCODE -ne 0) { throw 'Resource bundle example build failed.' }
$executable = (Resolve-Path -LiteralPath (Join-Path $verifyRoot "src-tauri/target/$BuildKind/sgs-ng.exe")).Path
$port = if ($BuildKind -eq 'release') { 9224 } else { 9223 }
$nativeProfile = Join-Path $verifyRoot ('.artifacts/ui/webview-profile-' + $BuildKind + '-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $nativeProfile -Force | Out-Null
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $port is already in use; close its owner before verifying this build."
}

$variables = @{
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port"
  SGS_NATIVE_BUILD = $BuildKind
  SGS_NATIVE_EXE = $executable
  SGS_NATIVE_CDP = "http://127.0.0.1:$port"
  SGS_NATIVE_PID = $null
  SGS_NATIVE_PROFILE = $nativeProfile
  WEBVIEW2_USER_DATA_FOLDER = $nativeProfile
}
$previous = @{}
$owned = $null
$profileChecks = @()
function Assert-NativeProfile($client) {
  $processes = @(Get-CimInstance Win32_Process)
  $descendants = [Collections.Generic.HashSet[uint32]]::new()
  $null = $descendants.Add([uint32]$client.Id)
  do {
    $changed = $false
    foreach ($process in $processes) {
      if ($descendants.Contains([uint32]$process.ParentProcessId) -and $descendants.Add([uint32]$process.ProcessId)) { $changed = $true }
    }
  } while ($changed)
  foreach ($process in $processes) {
    if ($process.Name -ne 'msedgewebview2.exe' -or !$descendants.Contains([uint32]$process.ProcessId)) { continue }
    if ($process.CommandLine -match '--user-data-dir=(?:"([^"]+)"|(\S+))') {
      $actual = [IO.Path]::GetFullPath($(if ($Matches[1]) { $Matches[1] } else { $Matches[2] }))
      if ($actual.Equals($nativeProfile, [StringComparison]::OrdinalIgnoreCase) -or $actual.StartsWith($nativeProfile + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        return [ordered]@{ processId=$client.Id; webviewProcessId=$process.ProcessId; actualDataDirectory=$actual }
      }
    }
  }
  throw 'WebView2 did not use the isolated verification profile; refusing to change content storage.'
}
function Wait-NativeCdp($client) {
  $deadline = (Get-Date).AddSeconds(20)
  do {
    if ($client.HasExited) { throw 'The native application exited before opening CDP.' }
    try {
      $null = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 1
      return
    } catch {
      if ((Get-Date) -ge $deadline) { throw 'The native CDP endpoint did not become available.' }
      Start-Sleep -Milliseconds 200
    }
  } while ($true)
}
Push-Location -LiteralPath $verifyRoot
try {
  foreach ($key in $variables.Keys) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $variables[$key], 'Process')
  }
  $owned = Start-Process -FilePath $executable -WorkingDirectory $verifyRoot -WindowStyle Hidden -PassThru
  Wait-NativeCdp $owned
  $profileChecks += Assert-NativeProfile $owned
  [Environment]::SetEnvironmentVariable('SGS_NATIVE_PID', [string]$owned.Id, 'Process')
  & node scripts/smoke-native.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Native behavior verification failed.' }
  Stop-Process -Id $owned.Id
  if (!$owned.WaitForExit(10000)) { throw 'The first native process did not terminate.' }
  $deadline = (Get-Date).AddSeconds(10)
  while (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    if ((Get-Date) -ge $deadline) { throw 'The old native CDP listener did not close.' }
    Start-Sleep -Milliseconds 200
  }
  $owned = Start-Process -FilePath $executable -WorkingDirectory $verifyRoot -WindowStyle Hidden -PassThru
  Wait-NativeCdp $owned
  $profileChecks += Assert-NativeProfile $owned
  [Environment]::SetEnvironmentVariable('SGS_NATIVE_PID', [string]$owned.Id, 'Process')
  & node scripts/smoke-content-restart.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Native process restart verification failed.' }
  [ordered]@{ capturedAt=(Get-Date).ToUniversalTime().ToString('o'); buildKind=$BuildKind; isolated=$true; directory=$nativeProfile; checks=$profileChecks } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $verifyRoot ".artifacts/ui/native-profile-$BuildKind.json") -Encoding utf8
} finally {
  if ($owned -and !$owned.HasExited) {
    $current = Get-Process -Id $owned.Id -ErrorAction SilentlyContinue
    if ($current -and $current.Path -eq $executable) { Stop-Process -Id $owned.Id; $null = $owned.WaitForExit(10000) }
  }
  foreach ($key in $previous.Keys) {
    [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
  }
  # 只清理本次生成的独立目录；不触及用户正常应用数据。先校验绝对路径与使用者。
  $profileRoot = [IO.Path]::GetFullPath((Join-Path $verifyRoot '.artifacts/ui'))
  $profilePath = [IO.Path]::GetFullPath($nativeProfile)
  if (!$profilePath.StartsWith($profileRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($profilePath) -notmatch '^webview-profile-(debug|release)-[0-9a-f]{32}$') { throw 'Invalid verification profile cleanup path.' }
  $cleanupDeadline = (Get-Date).AddSeconds(5)
  do {
    $profileUsers = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($nativeProfile) })
    if ($profileUsers.Count -eq 0 -or (Get-Date) -ge $cleanupDeadline) { break }
    Start-Sleep -Milliseconds 200
  } while ($true)
  if ($profileUsers.Count -eq 0 -and (Test-Path -LiteralPath $profilePath)) {
    try { Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction Stop } catch { Write-Warning "Temporary verification profile remains: $profilePath" }
  }
  Pop-Location
}
