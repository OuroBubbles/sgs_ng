import { readFile, writeFile } from 'node:fs/promises';

// CLI 的当前模板选择 API 37；本轮验证明确固定在已安装的稳定 API 36。
const gradle = new URL('../src-tauri/gen/android/app/build.gradle.kts', import.meta.url);
const source = await readFile(gradle, 'utf8');
await writeFile(
  gradle,
  source
    .replace(/compileSdk = \d+/, 'compileSdk = 36')
    .replace(/targetSdk = \d+/, 'targetSdk = 36'),
);
console.log('Android compile/target SDK pinned to 36.');
