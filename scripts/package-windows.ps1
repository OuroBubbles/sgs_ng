# 只归档实际验证过的当前 Release。旧项目的已验基线 ZIP 不覆盖。
$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$releaseExe = Join-Path $packageRoot 'src-tauri/target/release/sgs-ng.exe'
$proofRoot = Join-Path $packageRoot '.artifacts/validation'
$offline = Get-Content -LiteralPath (Join-Path $proofRoot 'native-source-smoke-release.json') -Raw -Encoding utf8 | ConvertFrom-Json
$restart = Get-Content -LiteralPath (Join-Path $proofRoot 'native-source-restart-release.json') -Raw -Encoding utf8 | ConvertFrom-Json
$network = Get-Content -LiteralPath (Join-Path $proofRoot 'native-source-network-release.json') -Raw -Encoding utf8 | ConvertFrom-Json
$offlineProfiles = Get-Content -LiteralPath (Join-Path $proofRoot 'native-source-profiles-offline-release.json') -Raw -Encoding utf8 | ConvertFrom-Json
$networkProfiles = Get-Content -LiteralPath (Join-Path $proofRoot 'native-source-profiles-network-release.json') -Raw -Encoding utf8 | ConvertFrom-Json
$releaseHash = (Get-FileHash -LiteralPath $releaseExe -Algorithm SHA256).Hash.ToLowerInvariant()
foreach ($proof in @($offline, $restart, $network)) {
  if ($proof.format -ne 'sgs-native/2' -or $proof.buildKind -ne 'release' -or $proof.executableSha256 -ne $releaseHash -or $proof.consoleErrors.Count -ne 0) { throw 'Current release has no matching successful native proof.' }
}
if (!$offline.result.aiVictory -or !$offline.result.pauseRetainsHand -or !$offline.result.rendererReleased -or !$restart.result.aiVictory -or
    $restart.initialProcessId -ne $offline.processId -or $restart.processId -eq $offline.processId -or $restart.verificationProfile -ne $offline.verificationProfile) { throw 'Native offline or process restart proof is incomplete.' }
if (!$offlineProfiles.isolated -or $offlineProfiles.checks.Count -ne 2 -or
    $offlineProfiles.checks[0].processId -ne $offline.processId -or $offlineProfiles.checks[1].processId -ne $restart.processId -or
    !$networkProfiles.isolated -or $networkProfiles.checks.Count -ne 2 -or $networkProfiles.checks[0].processId -ne $network.processId) { throw 'Native process profile evidence is missing.' }
Push-Location -LiteralPath $packageRoot
try {
  $expectedBuild = & node --input-type=module -e "import {networkBuild} from './scripts/network-build.mjs'; console.log(networkBuild());"
  if ($LASTEXITCODE -ne 0 -or $network.result.build -ne $expectedBuild -or !$network.result.configuration -or !$network.result.portConflictRejected -or
      !$network.result.reloadRetainsRequest -or !$network.result.sameHostAcrossRounds -or $network.result.rounds -ne 2 -or !$network.result.recreated -or !$network.result.ownerExitCleanup) { throw 'Current room configuration, reconnection or host lifecycle proof is incomplete.' }
  $files = [ordered]@{ 'sgs-ng.exe'=$releaseExe; 'FreeKill-LICENSE.txt'=(Join-Path $packageRoot 'src/assets/freekill/SOURCE-LICENSE.txt'); 'Spine-LICENSE.txt'=(Join-Path $packageRoot 'public/spine/LICENSE') }
  foreach ($name in @('node.exe', 'main.mjs', 'LICENSE.txt')) {
    $file = Join-Path $packageRoot "src-tauri/target/release/host/$name"
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $network.hostFiles.$name) { throw "Hosted runtime differs from its native proof: $name" }
    $files["host/$name"] = $file
  }
  $buildRoot = Join-Path $packageRoot '.artifacts/builds'
  New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
  $version = (Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw | ConvertFrom-Json).version
  $archive = Join-Path $buildRoot "sgs-ng-$version-windows-x64-source-candidate.zip"
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $stream = [IO.File]::Open($archive, [IO.FileMode]::Create)
  $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
  try {
    # 显式使用 ZIP 标准路径，避免 Compress-Archive 在 Windows 写入反斜杠。
    foreach ($name in $files.Keys) {
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $files[$name], $name) | Out-Null
    }
  } finally { $zip.Dispose(); $stream.Dispose() }
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  $members = @()
  try {
    foreach ($name in $files.Keys) {
      $entry = $zip.GetEntry($name)
      if (!$entry) { throw "Archive entry is missing: $name" }
      $stream = $entry.Open()
      try { $actual = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash } finally { $stream.Dispose() }
      if ($actual -ne (Get-FileHash -LiteralPath $files[$name] -Algorithm SHA256).Hash) { throw "Archive bytes differ: $name" }
      $members += [ordered]@{ path=$name; bytes=$entry.Length; sha256=$actual.ToLowerInvariant() }
    }
    if (@($zip.Entries | Where-Object { !$_.FullName.EndsWith('/') }).Count -ne $files.Count) { throw 'Archive has unexpected files.' }
  } finally { $zip.Dispose() }
  [ordered]@{ capturedAt=(Get-Date).ToUniversalTime().ToString('o'); networkBuild=$expectedBuild; archive=$archive; sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant(); members=$members; nativeProofs=@('native-source-smoke-release.json','native-source-restart-release.json','native-source-network-release.json') } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $buildRoot 'source-candidate-manifest.json') -Encoding utf8
  Write-Output $archive
} finally { Pop-Location }
