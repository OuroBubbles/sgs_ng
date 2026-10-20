# 08 · 开发工具与工作约定

日期：2026-10-16。这里记录本项目实际使用的工具与经验，不把其他同名项目的验证结果迁入本仓库。

## 本地工具

本机未开启管理员会话，因此采用项目内工具目录 `.tools/`。Rust、Cargo、编译器、下载缓存和 Gradle 缓存均不进入源码或格式检查范围。

| 工具         | 本轮配置                                                |
| ------------ | ------------------------------------------------------- |
| Rust / Cargo | 1.99.1，Windows MSVC host，另安装 Android targets       |
| MSVC         | 14.44.35207，x64                                        |
| Windows SDK  | 10.0.26100.0                                            |
| Android JDK  | 已有 JAVA_HOME 下的 Temurin 17.0.20.1                   |
| Android SDK  | 已有 ANDROID_HOME；本轮补齐 Platform 36、Build-Tools 36 |
| Android NDK  | 27.2.12479018                                           |
| JS 工具      | package.json 与 pnpm-lock.yaml 固定版本                 |
| Rust 依赖    | src-tauri/Cargo.lock 固定本轮实际解析版本               |

运行原生命令前由 [toolchain.ps1](../scripts/toolchain.ps1) 设置当前进程的 PATH、INCLUDE、LIB、SDK 和 NDK 路径，不修改用户或系统 PATH。普通 Node 终端没有发现 cargo，不再等于本项目没有 Rust。

```powershell
pwsh -NoProfile -File scripts/bootstrap-native.ps1
pnpm platform:check
pnpm desktop:debug
pnpm desktop:build
pnpm android:init
```

bootstrap 默认安装 Rust 与便携 MSVC；Android 包准备使用 `-Components Android`，并要求已有 JAVA_HOME/ANDROID_HOME。MSVC 提取脚本固定到 mmozeiko gist 修订 `49b58850aa5e5c1e65f090d4651ee76607883e11`，工具包从 Microsoft 官方 manifest 下载并校验。脚本保留在忽略的工具目录，不作为项目运行依赖。[工具作者说明](https://gist.github.com/mmozeiko/7f3162ec2988e81e56d5c4e22cde9977)、[Tauri 环境要求](https://v2.tauri.app/start/prerequisites/)

## Android 的两个已知环境问题

SDK Manager 的 Java 下载器本轮在 Build-Tools ZIP 上长时间停滞，curl 可以正常获取同一官方文件。因此提供 [install-android-archives.py](../scripts/install-android-archives.py)：仅提取两个具名包，按 Google repository2-3.xml 中的 SHA-1 校验，不删除 SDK 目录。

```powershell
curl.exe --fail --location https://dl.google.com/android/repository/build-tools_r36_windows.zip --output .tools/downloads/build-tools_r36_windows.zip
curl.exe --fail --location https://dl.google.com/android/repository/platform-36_r02.zip --output .tools/downloads/platform-36_r02.zip
python scripts/install-android-archives.py
```

CLI 2.12.3 生成的 Android 模板默认选择 API 37；当前验收基线固定为已安装的 API 36，通过 [configure-android.mjs](../scripts/configure-android.mjs) 重放这项配置。不能只修改被忽略的生成文件而不留下生成步骤。

非管理员 Windows 会话不能创建 JNI 库符号链接。本轮 CLI 已成功编译 ARM64 `.so`，随后在 symlink 步骤退出。提供 [android-package.ps1](../scripts/android-package.ps1)：只对这个已识别错误使用普通文件复制，再跳过已经完成的 Rust Gradle task。

```powershell
pwsh -NoProfile -File scripts/android-package.ps1
# 仅在已确认库是本次源码编译产物时，才能显式跳过 Rust 编译：
pwsh -NoProfile -File scripts/android-package.ps1 -UseCompiledLibrary
```

这个回退不改变正式 CLI、不改 Windows Developer Mode，也不掩盖其他编译错误。本轮已成功生成 ARM64 Debug APK；`aapt dump badging` 和 `apksigner verify --verbose` 分别验证安装元数据与签名。无连接真机，现有 AVD 缺少系统镜像，尚不能证明 Android 启动与动画正常。

`pnpm android:build` 已接入这条完整路径，当前产物为 ARM64 Debug APK；发布签名包另行处理。符号链接回退路径默认剥离打包副本的 native 调试符号，完整原库仍在 Cargo target；需要保留包内 native 符号时加 `-KeepNativeSymbols`。

本轮打包副本从约 129.2 MB 降到 13.8 MB。Gradle 增量 ZIP 替换后可能留下旧数据空洞，脚本会移除具名的生成 APK 再重新打包；最终包约 21.0 MB。仅检查 ZIP 内库大小不足以证明实际 APK 已缩小。

## Windows 运行验证

原生 `tauri build` 成功后还要验证 WebView。使用 [验证启动器](../scripts/verify-windows.ps1)：

```sh
pnpm desktop:verify
pnpm desktop:verify -BuildKind debug
```

启动器要求对应 exe 已构建，确认 CDP 端口空闲，以 Hidden 启动本次程序，等待端点就绪后运行 [原生场景](../scripts/smoke-native.mjs)。验收使用独立 WebView2 数据目录，核对实际子进程的 user-data-dir 后才操作内容库；随后关闭首个进程，用同一测试目录启动第二个进程，验证内容恢复和真实技能。最后关闭自己拥有且路径匹配的进程，清理测试目录并恢复临时环境变量，见 [48](48-content-persistence.md)。Release 使用 9224，Debug 使用 9223；不会复用旧端点作为新构建证据。

当前脚本连接实际 `tauri.localhost` 页面，分别以四人种子 255 验证丈八安装/连弩替换，68 验证乐不思蜀判定/跳阶段，102 验证八卦发动/红判供闪，91 验证借刀准备和交武器；再验证贯石斧、青龙、方天和麒麟弓；重新加载后以两人种子 42 通过正式决策到身份胜负，最后检查 8 个 Spine 实例。脚本会放弃反制机会，成功使用无懈、五谷与青釭剑破盾另有浏览器场景。截图与 exe SHA-256 记录写到 `.artifacts/ui/native-smoke-<build>.json`。不要直接对正常应用数据目录运行该脚本；使用上述启动器，完成独立目录及进程归属检查。

本批 Debug/Release 均已通过。旧 `.artifacts/p0/native-smoke.json` 是历史记录；当前结果不代替 Android 实机检查。浏览器后台模拟也不能当作 Android 系统前后台证明。

## 迭代方法

1. 先看 STATUS 和当前契约，再针对一个真实机制或交互缺陷修改。
2. 参考 noname 时按功能定位源码片段，不整页输出巨大脚本或导入其对象架构。
3. 世界状态、规则草案、UI 局部选择和已提交记录各有所有者。
4. 纯布局与状态转换用小测试检查边界；行为与 UI 测试检查用户可观察后果。
5. 浏览器验证使用生产构建和 Tauri 的实际 CSP，检查 console/pageerror 并审阅截图。
6. 原生构建与前端测试分开报告；Debug、Release、APK 和真机运行分别记录。

已经遇到并修复的经验：Pixi 需安装无动态求值适配以通过生产 CSP；手写 CSS 和 Canvas 两套坐标会漂移；隐藏诊断文字后，测试应观察渲染状态与 canvas，而不是要求那行文字可见；原生编译成功不能替代壳内资源与 Spine 运行验证。

后续已实现首批 Flow、Window、提交等机制与规则骨架，见 [内核实施](10-kernel.md)；完整 SDK 与完整对局仍待继续。当前交互改进应让后续规则能接入，而不能把演示夹具扩展成事实上的内核。

## 规则迭代的证据

`pnpm check` 包含类型、lint、本地文档链接、单元/行为测试和前端构建；格式另跑 `pnpm format:check`。`pnpm docs:check` 只验证 README 与 docs 中本地链接的目标存在，不检查远程链接、锚点或设计声明是否已实现。

每批先执行受影响的规则场景，再完整检查；规则源码没有接入 UI 时不重复导出原生安装包，也不沿用 P0 平台证据宣称新规则已通过双端。刷新规则报告可运行：

```sh
pnpm test:core --reporter=json --outputFile=.artifacts/validation/scenarios.json
```

Vitest JSON 报告可能全在一行，不应直接输出整行。读取 numTotalTests、numPassedTests、numFailedTests 和 success 字段即可核对计数，再针对失败项查看详情。

正常胜负用 `finishGame` 与 `room.finish` 收束，调试停止用 `room.abort`；错误路径保留已提交状态。这三类出口不能为了“跑完测试”混为同一种结束。生命与身份场景中的嵌套死亡、处理材料和事实重建是后续扩展的回归基线。

## 复现练习牌组场景

[练习初始化测试](../tests/scenarios/practice.test.ts) 检查规则目录与牌面目录一致，并遍历种子 1–32，确认每种练习牌能进入首个出牌角色的手牌。需要定位真实 UI 场景时可输出夹具；只有开启日志时才最多搜索至种子 8192，找到全部具名场景即停止，并将该工具模式的超时设为 120 秒，另列常用组合场景，常规测试仍为 1–32：

```powershell
$env:SGS_FIXTURE_LOG = '1'
pnpm exec vitest run tests/scenarios/practice.test.ts --reporter=verbose
Remove-Item Env:SGS_FIXTURE_LOG
```

当前四人局、选择“机制练习（288 张）”的可复现场景；标准＋EX 的相同种子不会得到相同起手：

| 种子 | 开始角色 | 场景                                                     |
| ---- | -------- | -------------------------------------------------------- |
| 19   | 丙席     | 普通杀、选择反馈、热座基础                               |
| 4    | 甲席     | 南蛮与无懈反制                                           |
| 18   | 甲席     | 万箭                                                     |
| 18   | 甲席     | 五谷公开牌池                                             |
| 2    | 甲席     | 顺手暗选                                                 |
| 255  | 甲席     | 丈八与连弩替换                                           |
| 255  | 甲席     | 丈八转换                                                 |
| 70   | 甲席     | 乐不思蜀交给乙席，判定 ♦Q 大宛后跳过出牌                |
| 9    | 丁席     | 闪电下一回合判定 ♦K 紫骍后传递                          |
| 366  | 甲席     | 安装八卦，乙杀甲可得到 ♦2 寒冰剑红判供闪                |
| 2    | 甲席     | 安装仁王盾，乙可装备青釭并用黑杀攻击甲                   |
| 173  | 甲席     | 甲装备连弩，乙使用借刀；可测试准备取消、交武器或甲使用杀 |
| 93   | 丙席     | 贯石斧用杀，丁打闪，丙可支付两张其他牌突破               |
| 498  | 丁席     | 青龙与两张杀，甲可闪第一张，再由丁追加用杀               |
| 14   | 乙席     | 先安装其余装备，最后装方天；仅剩一张杀可选甲、丙、丁     |
| 120  | 乙席     | 乙装绝影，丙可装备麒麟弓，用杀并弃置该坐骑               |
| 3    | 乙席     | 雌雄双股剑对丙用杀，选择弃手牌、让乙摸牌或不发动         |
| 36   | 丙席     | 寒冰剑对丁用杀，防止伤害后连续两次暗选弃牌               |

浏览器场景操作真实控件，不直接修改 World。机制牌组是 288 张测试配比，不能据此推断标准包分布。默认开局改用标准＋EX 的 108 张实体牌（见 [23](23-swords-standard-deck.md)）；浏览器两人胜负场景使用标准牌组种子 27，原生两人胜负场景使用标准牌组种子 42。

`pnpm build`、Windows/Android 构建都会重写 `dist`；**不能在浏览器验证使用该目录时同时构建**。本批曾因此捕获首页 404，而不是规则错误。先完成构建，再运行浏览器场景；已嵌入资源的原生 exe 验证可与浏览器场景独立运行。

判定日志按牌面显示 A/J/Q/K，夹具的原始 rank 为 1/11/12/13；例如 rank 11 在 UI 中显示 J。断言应检查实际展示契约。

## 打包已验证的 Windows 程序

```sh
pnpm desktop:package
```

[打包脚本](../scripts/package-windows.ps1) 只使用当前 Release。它先比较原生记录中的路径、exe/演示模块 SHA-256 与错误结果，并要求匹配的真实进程重启与独立数据目录证明，再归档 exe、运行说明、Spine 许可和 harbor.sgs.mjs；随后读取真正的 ZIP 成员，核对精确成员及两份文件字节哈希，最后写入清单。脚本不构建，也不补造原生验证记录；exe 或模块更新后必须重新运行原生检查才能打包。本地模块工具见 [47](47-local-content-modules.md)，持久安装与验证契约见 [48](48-content-persistence.md)。

练习牌组允许同名重复牌。检查获得/弃置时应核对前后增量、对应装备离场和公开事实，不能假设接收者原先没有同名牌。借刀夹具统一核对交出武器的离场及接收者对应牌数量加一。

## 主持侧探针与界面回归

原始 `Room.decisions` 接收主持侧回复，例如出牌的 `{ choice: CardChoice, targets }`；界面的 `{ offer, cards, targets }` 草稿需要先经 `LocalSession` 转换，不能直接交给原始校验器。种子探针与界面驱动如果采取不同的弃牌、反制或响应策略，会得到不同的合法后续手牌；最终界面断言应依据当前可见实体与实际规则结果。

牌名不代表唯一实体；同名牌要明确选择实体 ID 或第一张合法材料。比较事件先后应读取日志事实编号，不能把界面的倒序排列当作发生顺序。支付/改判等组合事实的领域声明位于 `data.detail.declaration`，不要把它与普通操作事实的直接 detail 混用。

自然牌局的当前回合行动序复现见 [41](41-action-order.md)；临时种子探针用于寻找输入，不作为正式运行或分发包的验收证据。

自动推进的结算不一定停在断言想观察的瞬间。例如最后一次遗计保留余牌后，AI 可以结束回合，随后甲席正常摸两张；此时手牌总数不是“遗计前 + 4”。应在两次私有池中保存可见实体 ID，核对四张牌真实进入本人手牌、两次保留事实和独立发动记录，而不是延长超时、暂停运行时或断言一个短暂总数。最后一次发动前仍有人的必选决策阻挡时，可以精确检查第一次保留的增量。
