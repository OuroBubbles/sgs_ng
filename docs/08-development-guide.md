# 08 · 开发工具与工作约定

项目位于 `C:/workspace/sgs-ng`。遵守上级 [WORKSPACE](../../WORKSPACE.md)，先复用已有工具，项目依赖与产物留在项目内；环境配置只作用于当前进程及子进程。当前任务、交付摘要和平台覆盖只维护在 [STATUS](STATUS.md)，本页只说明可执行入口，不累积历史批次。

## 日常开发与检查

Node 24、pnpm 11.25.0；版本与依赖以 [package.json](../package.json)、[pnpm-lock.yaml](../pnpm-lock.yaml) 为准。

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test:ui
pnpm format:check
```

`pnpm check` 包含类型、lint、本地文档链接、单元/行为测试、标准条件审计与生产构建。先运行受影响场景，收尾完整检查；网页渲染、交互或前端资源改变时另跑 `pnpm test:ui`。规则和界面使用同一合法性入口，不以放宽超时、跳过或减少条件换通过。

[牌场景夹具](../tests/fixtures/cards.ts) 用 cardSeed 生成初始数据，cardGame 才创建规则对局。固定标准牌声明在模块内复用，每局目录、装备能力与状态独立；自定义声明仍按本次输入规范化。测试需要自有目录或 World 时直接使用 cardSeed，避免先创建不用的对局。

浏览器场景使用生产构建和原生 CSP，核对 console/pageerror 与实际渲染。`pnpm build` 和原生构建都会重写 `dist`，不得与使用它的浏览器验收同时执行；重型检查与图形验收串行运行。

联机三种构建入口共用 `scripts/network-build.mjs` 注入源码/资源摘要，不能手工指定或沿用旧值。修改源码后重新构建双方；开发服务器的摘要在启动时固定，热更新只用于本机界面调试，联机前须重启开发服务器并重建主持端。生产验收使用冻结输入的页面与主持端，不把 HMR 后的页面当作交付证明。

`pnpm docs:check` 只核对 README 与 docs 中本地链接目标，不验证远程链接、锚点或设计是否实现。Vitest JSON 可能全在一行，先读取计数和失败项，不直接输出整份报告。规则侧报告可用 `pnpm test:core` 刷新。

## Windows 工具与构建

原生命令使用 Windows 自带的 Windows PowerShell 5.1（`powershell.exe`）。入口的 `-ExecutionPolicy Bypass` 仅作用于本次脚本进程，不修改系统或用户策略。仓库 `.ps1` 保存为 UTF-8 BOM，编辑器约定见 [.editorconfig](../.editorconfig)；原生输出、JSON 读取使用 UTF-8，避免中文脚本或交付说明被默认代码页误读，依据见 [Microsoft 编码说明](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_Character_Encoding)。

本机工具默认复用 `C:/workspace/shared/tools/native-windows`，结构为 `cargo/`、`rustup/`、`msvc/`；可由进程变量 `SGS_NATIVE_TOOLS_ROOT` 指向另一套布局。项目 Rust 版本以 [rust-toolchain.toml](../rust-toolchain.toml) 为准，依赖由 `src-tauri/Cargo.lock` 固定。

[native.ps1](../scripts/native.ps1) 在执行构建前加载 [toolchain.ps1](../scripts/toolchain.ps1)，设置子进程的编译器、SDK、Cargo 与 Rustup 路径。普通终端没有找到 cargo 不代表缺少安装；确认缺失后才使用 [bootstrap-native.ps1](../scripts/bootstrap-native.ps1)，安装共享工具时须避开其他使用者。

```powershell
pnpm platform:check
# 仅在确认缺少工具时安装；默认准备 Rust 与 MSVC。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-native.ps1
# 调试构建可选；正式交付使用 Release。
pnpm desktop:debug
pnpm desktop:build
```

`platform:check` 检查工具存在性与版本命令，缺失或版本命令失败时退出码非零；构建与实际运行仍分别验收。SDK 未配置时不把当前目录中的同名文件夹当作 SDK。

Windows 专用 [配置](../src-tauri/tauri.windows.conf.json) 在构建页面后执行 `pnpm host:build`，将当前 Node 24、独立主持脚本及 Node/ws 许可作为 `host/` [资源](https://v2.tauri.app/develop/resources/) 随包交付；Android 不含这些 Windows 文件。`native.ps1` 也将同样字节放到 `target/release/host` 或 `target/debug/host`，供不生成安装包的 exe 直接运行。界面通过 [Tauri 命令](https://v2.tauri.app/develop/calling-rust/) 创建和关闭自有子进程，规则仍使用现有 Node 主持端；不用额外安装运行时或 shell 插件。

独立开发主持端用 SGS_PRACTICE=1 选择机制演武；自定义内容在普通入口中调用 createRoomOptions(setup, content) 注入。桌面入口仅通过 stdin 首行传 RoomSetup，不传源码、包图或二进制模块。stdin 后续 EOF 负责回收主持子进程，加入者不执行规则源码。

## Windows 运行验证

```powershell
pnpm desktop:verify
# 若要验证已构建的 Debug：
pnpm desktop:verify -BuildKind debug
# 验证客户端创建房间、另一端加入和整局：
pnpm desktop:network
```

[验证启动器](../scripts/verify-windows.ps1) 要求对应 exe 已存在、CDP 端口空闲；以隐藏窗口启动自己拥有的程序，不复用旧端点。Release 使用 9224，Debug 使用 9223；双客户端的第二端分别为 9226 / 9225，主持端使用 0 自动分配可用端口。

默认验证 target 下的构建；传入 `-ExecutablePath` 可验证 ZIP 解压后的同一程序。工作目录固定为 exe 所在目录，隔离证明记录实际进程路径，用于核对便携包内的主持端和资源；两种入口复用同一组场景。

验收先核对实际 WebView2 的 user-data-dir，再操作本次独立目录。[原生场景](../scripts/smoke-native.mjs) 验证无安装的启动、内置源码选择、暂停、AI 胜负和战场释放；协调器关闭进程后启动同一 exe，检查新进程仍从标准源码开始。网络模式使用两个真实原生客户端，验证演武房间、端口冲突、请求重连、两局复用、房间重建及创建者退出后子进程回收。退出时仅关闭本次创建且路径匹配的进程，恢复临时环境；本次独立目录保留供诊断，不遍历历史目录。

当前证明位于 .artifacts/validation 的 native-source-smoke、native-source-restart、native-source-network 及 native-source-profiles 文件，按 debug/release 区分；均须对应当前 exe。网络重连检查是页面重载后的同一请求，不宣称网络客户端跨进程恢复或跨机器互通。

联机模式从实际界面创建演武两席房间，由另一原生客户端尝试占用同一端口，核对友好拒绝且原主持进程不变，然后加入该房间。真实请求挂起时刷新持有请求的页面，返回原房间并核对同一请求和主持 PID；双方托管完成两局，再关闭并重建房间。协调器终止创建者后核对实际子进程与端口均已退出。源码摘要与三份主持资源 SHA-256 写入证明；不同协议/构建拒绝、资源原始字节及更多席位由既有规则与浏览器场景覆盖，不转记为当前原生场景已执行的步骤。

## 打包已验证的 Windows 程序

```sh
pnpm desktop:package
```

[打包脚本](../scripts/package-windows.ps1) 不构建或生成运行证明。它核对当前 Release、离线/重启/双客户端原生证明与随包主持资源，再将 exe、host 下的 Node/脚本/许可及美术许可归档。解压成员逐字节核对后写入 source-candidate-manifest.json；输出 source-candidate ZIP，不覆盖旧已验收基线。未验证的构建不能进入候选包。

## Android 工具与构建

共享根目录为 `C:/workspace/shared/tools/android`，默认使用其中的 `jdk/`（JDK 21）、`sdk/`、`gradle/`；`SGS_ANDROID_TOOLS_ROOT` 可切换布局，显式 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME` 优先。Android 用户状态默认留在项目 `.artifacts/android-user`。不移动已有私钥、签名、用户设置或其他项目状态。

```powershell
. scripts/toolchain.ps1
sdkmanager.bat --list_installed
# 仅在确实缺少 Android 工具或 Rust ARM64 target 时执行：
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-native.ps1 -Components Android
# 仅在尚未初始化生成项目时执行：
pnpm android:init
pnpm android:build
```

[android-package.ps1](../scripts/android-package.ps1) 固定生成 ARM64 Debug APK。正常 CLI 完成和已识别的符号链接权限错误都进入同一 JNI 打包步骤：复制原库、剥离打包副本并重打包，保留 Cargo 原库调试信息。其他编译错误直接失败，不改系统开发者设置。`-KeepNativeSymbols` 保留包内符号；`-UseCompiledLibrary` 只用于已证明属于当前源码的库，不能用来掩盖源码与旧库不一致。

[configure-android.mjs](../scripts/configure-android.mjs) 重放 API 36、单次 Gradle 进程、进程内 Kotlin 编译和 Activity 复制配置；不只修改被忽略的 `gen/android`。原生适配源码是 [MainActivity.kt](../src-tauri/android/MainActivity.kt)，处理系统栏/刘海 inset 及导航模式资源变化。设备触摸坐标须加上实际 WebView 原点；不能假设是屏幕 `(0, 0)`。Tauri 参数不会自动成为 Gradle 参数，包入口负责各自参数。

构建后核对签名、Manifest、ELF LOAD 对齐与 `zipalign -c -P 16 -v 4`，不只检查链接参数。模拟器的 ARM64 转译与 4 KB 页运行不能证明真机或 16 KB 设备可用；已验平台和对应 APK 摘要见 STATUS。当前 AVD 使用项目 `.artifacts/android-user/avd/`，通过进程变量 `ANDROID_AVD_HOME` 选择，不重用旧项目的 AVD 状态。

## Android 运行与已知工具问题

WebView 验收使用 ADB 转发其 `webview_devtools_remote_<pid>`，再通过现有 Playwright/CDP 读取与操作。连接保留真实焦点/可见性行为；后台用定时轮询，不等待被暂停的动画帧。系统前后台、对局中的旋转/导航模式切换须核对原页面、草稿、待决请求和日志；浏览器模拟后台不能代替系统切换。

[MainActivity](../src-tauri/android/MainActivity.kt) 通过生命周期内的返回回调向 WebView 分发可取消的 `dialog.cancel`，否则点击可见、可操作的 `data-back-action` 按钮；无人处理时将任务移至后台。界面负责声明返回语义，原生壳不读取房间、World 或 Decision。新增弹窗须通过既有取消处理收束，新增页面须明确其返回按钮。

客户端内容导入和数据库恢复已移除，旧系统选择器探针不再是现行功能验收。程序重启、前后台保持和连接恢复仍须核对实际进程与请求，同页 reload 不能代替程序重启。临时设备探针和截图留在忽略产物中，不建立第二套常规框架。

遇到系统无响应时，记录当前 `boot_id`、uptime、应用启动时刻及 ANR 的进程/服务/时间，只将本次启动后的 DropBox 项作为新增故障。观察窗口应覆盖已有故障出现的时刻；层级不可读、统计文件拒读与确实出现 ANR 分开记录，采集缺口不算通过。调度与系统负载的判断参考 [Android ANR 诊断](https://developer.android.com/topic/performance/anrs/diagnose-and-fix-anrs)，没有现场复现时保留未确认结论。

图形诊断同时记录启动参数与 SurfaceFlinger 的实际 GLES/renderer。旧归档探针使用的 `swiftshader_indirect` 已自 Emulator 36.4.9 起[弃用](https://developer.android.com/studio/run/emulator-acceleration)；参数替换与性能效果须单独验证，不能据此直接宣称已修复 ANR。

已知工具警告：MSVC 链接器可报告创建 import library；命令行工具 19 可对较新 SDK XML 报版本警告。先看退出码和实际产物，不据警告宣称构建失败。SDK 下载器确实停滞且缺少具名组件时，才使用 [install-android-archives.py](../scripts/install-android-archives.py)：它读取共享 downloads 下的固定官方 ZIP，校验 SHA-1 后提取两个具名包。已装组件不重复下载或重装。

## 复现练习牌组场景

[练习初始化测试](../tests/scenarios/practice.test.ts) 常规遍历种子 1–32；开启具名夹具日志时才扩大搜索，找到全部目标即停止。需要复现输入时执行：

```powershell
$env:SGS_FIXTURE_LOG = '1'
pnpm exec vitest run tests/scenarios/practice.test.ts --reporter=verbose
Remove-Item Env:SGS_FIXTURE_LOG
```

机制练习使用 288 张测试配比，标准＋EX 为 108 张；相同种子不意味着相同起手。以当前工具输出和场景源码为准，不另维护一张会过期的种子表。临时探针只寻找输入，不能作为交付验收。

## 主持侧探针与界面回归

- 原始 `Room.decisions` 接收领域回复；界面 `{ offer, cards, targets }` 草稿须经 `LocalSession` 解释。不同弃牌/反制策略会产生不同的合法后续手牌，不能把探针结果当作 UI 必然状态。
- 同名牌不代表同一实体；获得、弃置和装备替换核对实体 ID、前后增量与公开事实。自动推进后手牌总数可能已受下一次摸牌影响，不用暂停运行时或延长超时固定短暂总数。
- 事实顺序读取单调编号，不用日志的倒序显示推断。支付/改判等组合事实的声明位于 `data.detail.declaration`，与普通操作的直接 detail 区分；牌面 A/J/Q/K 对应原始 rank 1/11/12/13。
- 正常胜负用 `finishGame` / `room.finish`，调试停止用 `room.abort`；错误保留已提交状态。这些出口不能为跑完测试而互换。来源、临时材料、嵌套死亡和事实重建按领域契约验收。

参考项目保持只读，按 [02](02-reference-analysis.md) 的具体证据定位片段。作者入口见 [05](05-authoring.md)，规则语义见 [04](04-resolution.md)；历史专题不自动成为下一步任务。
