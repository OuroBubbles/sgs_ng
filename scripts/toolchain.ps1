$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = if ($env:SGS_NATIVE_TOOLS_ROOT) {
  [IO.Path]::GetFullPath($env:SGS_NATIVE_TOOLS_ROOT)
} else {
  Join-Path (Split-Path -Parent $projectRoot) 'shared\tools\native-windows'
}
$androidToolRoot = if ($env:SGS_ANDROID_TOOLS_ROOT) {
  [IO.Path]::GetFullPath($env:SGS_ANDROID_TOOLS_ROOT)
} else {
  Join-Path (Split-Path -Parent $projectRoot) 'shared\tools\android'
}

# 环境只作用于当前 PowerShell 及子进程，不修改用户或系统 PATH。
if (Test-Path -LiteralPath (Join-Path $toolRoot 'cargo\bin\cargo.exe')) {
  $env:CARGO_HOME = Join-Path $toolRoot 'cargo'
  $env:RUSTUP_HOME = Join-Path $toolRoot 'rustup'
  $env:PATH = "$env:CARGO_HOME\bin;$env:PATH"
}

$msvcRoot = Join-Path $toolRoot 'msvc'
if (Test-Path -LiteralPath $msvcRoot) {
  $compiler = Get-ChildItem -LiteralPath (Join-Path $msvcRoot 'VC\Tools\MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
  $sdk = Get-ChildItem -LiteralPath (Join-Path $msvcRoot 'Windows Kits\10\Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if ($compiler -and $sdk) {
    $sdkRoot = Join-Path $msvcRoot 'Windows Kits\10'
    $env:VCToolsInstallDir = $compiler.FullName + '\'
    $env:VCToolsVersion = $compiler.Name
    $env:VCINSTALLDIR = Join-Path $msvcRoot 'VC\'
    $env:WindowsSdkDir = $sdkRoot + '\'
    $env:WindowsSDKVersion = $sdk.Name + '\'
    $env:VSCMD_ARG_HOST_ARCH = 'x64'
    $env:VSCMD_ARG_TGT_ARCH = 'x64'
    $env:PATH = "$($compiler.FullName)\bin\Hostx64\x64;$sdkRoot\bin\$($sdk.Name)\x64;$env:PATH"
    $env:INCLUDE = "$($compiler.FullName)\include;$($sdk.FullName)\ucrt;$($sdk.FullName)\shared;$($sdk.FullName)\um;$($sdk.FullName)\winrt;$($sdk.FullName)\cppwinrt"
    $env:LIB = "$($compiler.FullName)\lib\x64;$sdkRoot\Lib\$($sdk.Name)\ucrt\x64;$sdkRoot\Lib\$($sdk.Name)\um\x64"
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = Join-Path $compiler.FullName 'bin\Hostx64\x64\link.exe'
  }
}

if (!$env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $androidToolRoot 'jdk\bin\java.exe'))) {
  $env:JAVA_HOME = Join-Path $androidToolRoot 'jdk'
}
if (!$env:ANDROID_HOME -and (Test-Path -LiteralPath (Join-Path $androidToolRoot 'sdk\cmdline-tools\latest\bin\sdkmanager.bat'))) {
  $env:ANDROID_HOME = Join-Path $androidToolRoot 'sdk'
}
if ($env:JAVA_HOME) { $env:PATH = "$env:JAVA_HOME\bin;$env:PATH" }
if ($env:ANDROID_HOME) {
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  $env:PATH = "$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
  if (!$env:ANDROID_USER_HOME) { $env:ANDROID_USER_HOME = Join-Path $projectRoot '.artifacts\android-user' }
  if (!$env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $androidToolRoot 'gradle' }
  $ndkRoot = Join-Path $env:ANDROID_HOME 'ndk'
  if (!$env:NDK_HOME -and (Test-Path -LiteralPath $ndkRoot)) {
    $ndk = Get-ChildItem -LiteralPath $ndkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if ($ndk) { $env:NDK_HOME = $ndk.FullName }
  }
}
