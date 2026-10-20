param([switch]$UseCompiledLibrary, [switch]$KeepNativeSymbols)

. (Join-Path $PSScriptRoot 'toolchain.ps1')
Set-Location -LiteralPath $projectRoot
$env:GRADLE_USER_HOME = Join-Path $toolRoot 'gradle'

if (-not $UseCompiledLibrary) {
  & pnpm exec tauri android build --debug --apk --target aarch64 2>&1 | Tee-Object -FilePath .artifacts\toolchain\android-build.log
  if ($LASTEXITCODE -eq 0) { exit 0 }
  $buildLog = Get-Content -LiteralPath .artifacts\toolchain\android-build.log -Raw
  if ($buildLog -notmatch 'Creation symbolic link is not allowed') { throw 'Android compilation failed before the known symlink boundary.' }
}

# Windows 非管理员会话不能创建 symlink；Gradle 的 JNI 打包同样接受普通文件。
$library = Join-Path $projectRoot 'src-tauri\target\aarch64-linux-android\debug\libsgs_ng_lib.so'
$jni = Join-Path $projectRoot 'src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a'
if (-not (Test-Path -LiteralPath $library)) { throw 'Compile the ARM64 library first.' }
if (-not $jni.StartsWith($projectRoot + '\')) { throw 'Unexpected JNI target.' }
New-Item -ItemType Directory -Path $jni -Force | Out-Null
Copy-Item -LiteralPath $library -Destination (Join-Path $jni 'libsgs_ng_lib.so') -Force
if (-not $KeepNativeSymbols) {
  # 原始库保留在 Cargo target 中；只移除打包副本的调试符号，避免 Debug APK 膨胀。
  $strip = Join-Path $env:NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-strip.exe'
  & $strip --strip-debug --strip-unneeded (Join-Path $jni 'libsgs_ng_lib.so')
  if ($LASTEXITCODE -ne 0) { throw 'Stripping the packaged library failed.' }
}
& node scripts/configure-android.mjs
if ($LASTEXITCODE -ne 0) { throw 'Android configuration failed.' }

# 增量 ZIP 替换较小的库后可能留下空洞；重新生成具名产物以获得真实包体积。
$apk = Join-Path $projectRoot 'src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk'
if (Test-Path -LiteralPath $apk) { Remove-Item -LiteralPath $apk }

Push-Location -LiteralPath (Join-Path $projectRoot 'src-tauri\gen\android')
try {
  & .\gradlew.bat :app:assembleArm64Debug -x rustBuildArm64Debug --console=plain --info --no-daemon '-Dorg.gradle.internal.http.connectionTimeout=15000' '-Dorg.gradle.internal.http.socketTimeout=15000' '-Djava.net.preferIPv4Stack=true' '-Dhttps.protocols=TLSv1.2'
  if ($LASTEXITCODE -ne 0) { throw 'Gradle APK packaging failed.' }
} finally { Pop-Location }
