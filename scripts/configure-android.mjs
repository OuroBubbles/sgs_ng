import { copyFile, readFile, writeFile } from 'node:fs/promises';

// 原生安全区适配属于源码；初始化可重建 gen/，每次构建恢复项目自己的 Activity。
await copyFile(
  new URL('../src-tauri/android/MainActivity.kt', import.meta.url),
  new URL(
    '../src-tauri/gen/android/app/src/main/java/dev/sgsng/game/MainActivity.kt',
    import.meta.url,
  ),
);

// 导航模式等资源覆盖只需更新原生布局，不能重建承载内存对局的 WebView。
const manifestFile = new URL(
  '../src-tauri/gen/android/app/src/main/AndroidManifest.xml',
  import.meta.url,
);
const manifest = await readFile(manifestFile, 'utf8');
await writeFile(
  manifestFile,
  manifest.replace(/android:configChanges="([^"]+)"/, (_attribute, value) => {
    const changes = new Set(value.split('|'));
    changes.add('assetsPaths');
    return `android:configChanges="${[...changes].join('|')}"`;
  }),
);

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

// CLI 的额外参数传给 Cargo；Gradle/Kotlin 的进程策略留在项目配置中，避免常驻子进程持有构建管道。
const propertiesFile = new URL('../src-tauri/gen/android/gradle.properties', import.meta.url);
const properties = (await readFile(propertiesFile, 'utf8'))
  .replace(/^(?:org\.gradle\.daemon|kotlin\.compiler\.execution\.strategy)=.*(?:\r?\n|$)/gm, '')
  .trimEnd();
await writeFile(
  propertiesFile,
  `${properties}\norg.gradle.daemon=false\nkotlin.compiler.execution.strategy=in-process\n`,
);
