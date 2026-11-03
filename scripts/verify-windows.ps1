param(
  [ValidateSet('debug', 'release')][string]$BuildKind = 'release',
  [switch]$Network,
  [string]$ExecutablePath
)

# 仅控制本次创建的原生进程；内容直接来自程序源码，没有安装/数据库恢复步骤。
$ErrorActionPreference = 'Stop'
$verifyRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$launchPath = if ($ExecutablePath) { $ExecutablePath } else { Join-Path $verifyRoot "src-tauri/target/$BuildKind/sgs-ng.exe" }
$executable = (Resolve-Path -LiteralPath $launchPath).Path
$workingDirectory = Split-Path -Parent $executable
$port = if ($BuildKind -eq 'release') { 9224 } else { 9223 }
$peerPort = $port + 2
foreach ($candidatePort in @($port, $peerPort)) {
  if (Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue) { throw "Port $candidatePort is occupied." }
}
$runRoot = Join-Path $verifyRoot ('.artifacts/native/' + $BuildKind + '-' + [Guid]::NewGuid().ToString('N'))
$nativeProfile = Join-Path $runRoot 'owner'
New-Item -ItemType Directory -Path $nativeProfile -Force | Out-Null
$profiles = @($nativeProfile)
$variables = @{
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --mute-audio"
  WEBVIEW2_USER_DATA_FOLDER = $nativeProfile
  SGS_NATIVE_BUILD = $BuildKind
  SGS_NATIVE_EXE = $executable
  SGS_NATIVE_CDP = "http://127.0.0.1:$port"
  SGS_NATIVE_PID = $null
  SGS_NATIVE_PROFILE = $nativeProfile
  SGS_NATIVE_PEER_CDP = "http://127.0.0.1:$peerPort"
}
$previous = @{}
$owned = $null
$peer = $null
$checks = @()
function Stop-Owned($process) {
  if ($process -and !$process.HasExited -and $process.Path -eq $executable) {
    Stop-Process -Id $process.Id
    if (!$process.WaitForExit(10000)) { throw 'Owned native process did not exit.' }
  }
}
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
        return [ordered]@{ processId=$client.Id; executablePath=$client.Path; webviewProcessId=$process.ProcessId; actualDataDirectory=$actual }
      }
    }
  }
  throw 'WebView2 did not use the isolated verification profile; refusing to operate a shared profile.'
}
function Wait-NativeCdp($client) {
  $deadline = (Get-Date).AddSeconds(20)
  do {
    if ($client.HasExited) { throw 'The native application exited before opening CDP.' }
    if ((Get-Date) -ge $deadline) { throw 'The native CDP page did not become available.' }
    try {
      $pages = @(Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 1)
      if (@($pages | Where-Object { $_.url -like '*tauri.localhost*' }).Count) { return }
    } catch {}
    Start-Sleep -Milliseconds 200
  } while ($true)
}
Push-Location -LiteralPath $verifyRoot
try {
  foreach ($key in $variables.Keys) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $variables[$key], 'Process')
  }
  $owned = Start-Process -FilePath $executable -WorkingDirectory $workingDirectory -WindowStyle Hidden -PassThru
  Wait-NativeCdp $owned
  $checks += Assert-NativeProfile $owned
  [Environment]::SetEnvironmentVariable('SGS_NATIVE_PID', [string]$owned.Id, 'Process')
  if ($Network) {
    $nativeProfile = Join-Path $runRoot 'peer'
    $profiles += $nativeProfile
    New-Item -ItemType Directory -Path $nativeProfile | Out-Null
    $port = $peerPort
    [Environment]::SetEnvironmentVariable('WEBVIEW2_USER_DATA_FOLDER', $nativeProfile, 'Process')
    [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', "--remote-debugging-port=$port --mute-audio", 'Process')
    $peer = Start-Process -FilePath $executable -WorkingDirectory $workingDirectory -WindowStyle Hidden -PassThru
    Wait-NativeCdp $peer
    $checks += Assert-NativeProfile $peer
    & node scripts/smoke-native.mjs --network
    if ($LASTEXITCODE -ne 0) { throw 'Native room verification failed.' }
    $proofPath = Join-Path $verifyRoot ".artifacts/validation/native-source-network-$BuildKind.json"
    $proof = Get-Content -LiteralPath $proofPath -Raw -Encoding utf8 | ConvertFrom-Json
    Stop-Owned $owned
    $deadline = (Get-Date).AddSeconds(10)
    do {
      $remaining = Get-CimInstance Win32_Process -Filter "ProcessId=$($proof.result.hosting.ProcessId)" | Where-Object {
        $_.ParentProcessId -eq $proof.result.hosting.ParentProcessId -and $_.ExecutablePath -eq $proof.result.hosting.ExecutablePath
      }
      if (!$remaining) { break }
      Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)
    if ($remaining -or (Get-NetTCPConnection -LocalPort $proof.result.hosting.port -State Listen -ErrorAction SilentlyContinue)) { throw 'Hosting child or port survived owner exit.' }
    $proof.result | Add-Member -NotePropertyName ownerExitCleanup -NotePropertyValue $true
    $proof | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $proofPath -Encoding utf8
  } else {
    & node scripts/smoke-native.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Native offline verification failed.' }
    Stop-Owned $owned
    $deadline = (Get-Date).AddSeconds(10)
    while (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
      if ((Get-Date) -ge $deadline) { throw 'Previous native CDP listener survived exit.' }
      Start-Sleep -Milliseconds 100
    }
    $owned = Start-Process -FilePath $executable -WorkingDirectory $workingDirectory -WindowStyle Hidden -PassThru
    Wait-NativeCdp $owned
    $checks += Assert-NativeProfile $owned
    [Environment]::SetEnvironmentVariable('SGS_NATIVE_PID', [string]$owned.Id, 'Process')
    & node scripts/smoke-native.mjs --restart
    if ($LASTEXITCODE -ne 0) { throw 'Native process restart verification failed.' }
  }
  $scope = if ($Network) { 'network' } else { 'offline' }
  [ordered]@{ capturedAt=(Get-Date).ToUniversalTime().ToString('o'); buildKind=$BuildKind; isolated=$true; profiles=$profiles; checks=$checks } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $verifyRoot ".artifacts/validation/native-source-profiles-$scope-$BuildKind.json") -Encoding utf8
} finally {
  Stop-Owned $owned
  Stop-Owned $peer
  foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
  # 保留本次隔离目录供诊断，不遍历或删除任何历史验收目录。
  Pop-Location
}
