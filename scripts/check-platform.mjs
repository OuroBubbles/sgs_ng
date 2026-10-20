import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function version(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return result.error ? null : `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

function directories(path) {
  return existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
}

const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? '';
const jdk = process.env.JAVA_HOME ?? '';
const suffix = process.platform === 'win32' ? '.exe' : '';
const adb = sdk ? join(sdk, 'platform-tools', `adb${suffix}`) : 'adb';
const java = jdk ? join(jdk, 'bin', `java${suffix}`) : 'java';
const report = {
  recordedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  rustc: version('rustc'),
  cargo: version('cargo'),
  portableMsvc: process.env.VCToolsInstallDir ?? null,
  windowsSdk: process.env.WindowsSDKVersion ?? null,
  java: version(java, ['-version']),
  androidSdk: sdk || null,
  ndkVersions: directories(join(sdk, 'ndk')),
  androidPlatforms: directories(join(sdk, 'platforms')),
  devices: version(adb, ['devices', '-l']),
};

const missing = [];
if (!report.rustc || !report.cargo) missing.push('Rust / Cargo');
if (!report.java) missing.push('JDK');
if (!report.ndkVersions.length) missing.push('Android NDK');
if (!report.androidPlatforms.length) missing.push('Android SDK Platform');

const output = {
  ...report,
  missing,
  note: '此报告仅检查工具存在性；实际构建和运行证据另行记录。',
};
mkdirSync('.artifacts/p0', { recursive: true });
writeFileSync('.artifacts/p0/platform.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
