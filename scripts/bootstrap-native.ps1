param(
  [ValidateSet('Rust', 'Msvc', 'Android')]
  [string[]]$Components = @('Rust', 'Msvc')
)

$ErrorActionPreference = 'Stop'
$bootstrapRoot = Split-Path -Parent $PSScriptRoot
$tools = if ($env:SGS_NATIVE_TOOLS_ROOT) {
  [IO.Path]::GetFullPath($env:SGS_NATIVE_TOOLS_ROOT)
} else {
  Join-Path (Split-Path -Parent $bootstrapRoot) 'shared\tools\native-windows'
}
$downloads = Join-Path $tools 'downloads'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null

if ($Components -contains 'Rust') {
  $installer = Join-Path $downloads 'rustup-init.exe'
  if (-not (Test-Path -LiteralPath $installer)) {
    Invoke-WebRequest 'https://win.rustup.rs/x86_64' -OutFile $installer
  }
  $env:CARGO_HOME = Join-Path $tools 'cargo'
  $env:RUSTUP_HOME = Join-Path $tools 'rustup'
  & $installer -y --no-modify-path --profile minimal --default-toolchain 1.99.1-x86_64-pc-windows-msvc
  if ($LASTEXITCODE -ne 0) { throw 'Rust installation failed.' }
}

if ($Components -contains 'Msvc') {
  # 此第三方脚本提取 Microsoft 官方包；固定版本，清理仅限已确认的工具目录。
  $revision = '49b58850aa5e5c1e65f090d4651ee76607883e11'
  $gist = Invoke-RestMethod "https://api.github.com/gists/7f3162ec2988e81e56d5c4e22cde9977/$revision"
  $script = Join-Path $downloads 'portable-msvc.py'
  Set-Content -LiteralPath $script -Value $gist.files.'portable-msvc.py'.content -Encoding utf8
  Push-Location -LiteralPath $tools
  try {
    if ((Get-Location).Path -ne $tools) { throw 'Unexpected extraction directory.' }
    $extractRoot = [IO.Path]::GetFullPath((Join-Path $tools 'msvc'))
    if (!(($extractRoot + '\').StartsWith($tools.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase))) {
      throw 'MSVC extraction must stay within the selected tools directory.'
    }
    & uv run --no-project --python 3.12 $script --vs 2022 --msvc-version 14.44 --sdk-version 26100 --target x64 --accept-license
    if ($LASTEXITCODE -ne 0) { throw 'Portable MSVC extraction failed.' }
  } finally { Pop-Location }
}

if ($Components -contains 'Android') {
  . (Join-Path $PSScriptRoot 'toolchain.ps1')
  if (-not $env:ANDROID_HOME -or -not $env:JAVA_HOME) { throw 'Install a JDK and Android command-line SDK in the shared Android tool directory, or set JAVA_HOME and ANDROID_HOME.' }
  & "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" "--sdk_root=$env:ANDROID_HOME" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.2.12479018'
  if ($LASTEXITCODE -ne 0) { throw 'Android packages installation failed.' }
  & rustup target add aarch64-linux-android
  if ($LASTEXITCODE -ne 0) { throw 'Android Rust target installation failed.' }
}

Write-Output "Native tools prepared in $tools. Run pnpm desktop:debug."
