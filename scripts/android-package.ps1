param([switch]$UseCompiledLibrary, [switch]$KeepNativeSymbols)

. (Join-Path $PSScriptRoot 'toolchain.ps1')
Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Path .artifacts\toolchain -Force | Out-Null
& node scripts/configure-android.mjs
if ($LASTEXITCODE -ne 0) { throw 'Android configuration failed.' }

if (-not $UseCompiledLibrary) {
  # 在原生命令层合并输出，保留退出码；PowerShell 不把工具的普通 stderr 变成终止错误。
  & (Join-Path $env:SystemRoot 'System32\cmd.exe') /d /s /c 'pnpm exec tauri android build --debug --apk --target aarch64 --split-per-abi 2>&1' | Tee-Object -Variable androidBuildOutput
  $androidBuildExit = $LASTEXITCODE
  $androidBuildOutput | Set-Content -LiteralPath .artifacts\toolchain\android-build.log -Encoding utf8
  if ($androidBuildExit -ne 0) {
    $buildLog = Get-Content -LiteralPath .artifacts\toolchain\android-build.log -Encoding utf8 -Raw
    if ($buildLog -notmatch 'Creation symbolic link is not allowed') { throw 'Android compilation failed before the known symlink boundary.' }
  }
}

# 两条 CLI 路径统一打包普通 JNI 副本；不修改指向 Cargo 原库的链接目标。
$library = Join-Path $projectRoot 'src-tauri\target\aarch64-linux-android\debug\libsgs_ng_lib.so'
$jni = Join-Path $projectRoot 'src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a'
if (-not (Test-Path -LiteralPath $library)) { throw 'Compile the ARM64 library first.' }
if (-not $jni.StartsWith($projectRoot + '\')) { throw 'Unexpected JNI target.' }
New-Item -ItemType Directory -Path $jni -Force | Out-Null
$packagedLibrary = Join-Path $jni 'libsgs_ng_lib.so'
if (Test-Path -LiteralPath $packagedLibrary) {
  if ((Get-Item -LiteralPath $packagedLibrary -Force).PSIsContainer) { throw 'JNI library must be a file.' }
  Remove-Item -LiteralPath $packagedLibrary -Force
}
Copy-Item -LiteralPath $library -Destination $packagedLibrary
if (-not $KeepNativeSymbols) {
  # 原始库保留在 Cargo target 中；只移除打包副本的调试符号，避免 Debug APK 膨胀。
  $strip = Join-Path $env:NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-strip.exe'
  & $strip --strip-debug --strip-unneeded $packagedLibrary
  if ($LASTEXITCODE -ne 0) { throw 'Stripping the packaged library failed.' }
}

# 增量 ZIP 替换较小的库后可能留下空洞；重新生成具名产物以获得真实包体积。
$apk = Join-Path $projectRoot 'src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk'
if (Test-Path -LiteralPath $apk) { Remove-Item -LiteralPath $apk }

Push-Location -LiteralPath (Join-Path $projectRoot 'src-tauri\gen\android')
try {
  & .\gradlew.bat :app:assembleArm64Debug -x rustBuildArm64Debug --console=plain --info --no-daemon '-Pkotlin.compiler.execution.strategy=in-process' '-Dorg.gradle.internal.http.connectionTimeout=15000' '-Dorg.gradle.internal.http.socketTimeout=15000' '-Djava.net.preferIPv4Stack=true' '-Dhttps.protocols=TLSv1.2'
  if ($LASTEXITCODE -ne 0) { throw 'Gradle APK packaging failed.' }
} finally { Pop-Location }
