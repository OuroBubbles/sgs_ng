$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = Join-Path $projectRoot '.tools'

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

if ($env:ANDROID_HOME) {
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  $env:PATH = "$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
  $ndkRoot = Join-Path $env:ANDROID_HOME 'ndk'
  if (Test-Path -LiteralPath $ndkRoot) {
    $ndk = Get-ChildItem -LiteralPath $ndkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if ($ndk) { $env:NDK_HOME = $ndk.FullName }
  }
}
