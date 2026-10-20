# 01 · 语言与技术选型

日期：2026-10-16。状态：本轮设计决策；平台可行性需要 P0 实机验证。

## 决策依据

项目最难的部分是大量规则的演化，而不是每帧的大规模计算。选型优先级为：复杂技能表达与可维护性、开发反馈速度、桌面与安卓交付、Spine 与界面表现。暂不为联机、智能决策、沙箱或兼容旧包付出架构成本。

**主语言选 TypeScript，运行于 JavaScript 环境。** 规则核心不依赖浏览器，可在 Node 中测试；客户端在 WebView 中运行同一份代码。Node 是开发和测试环境，不打包进移动端。

TypeScript 的联合类型、泛型和类型推导适合表达“不同结果对应不同字段”“不同触发时点有不同上下文”。复杂技能使用函数、闭包、循环和 `async/await`，无需解释器或流程图编译器。类型系统帮助作者，但不替代运行时最终合法性检查。[TypeScript 官方说明](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)

## 候选比较

以下为针对本项目的工程判断，没有以虚构评分或跑分代替比较。

| 路线                            | 优势                                                            | 本项目需要承担的成本                                                                 | 决策           |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------- |
| TypeScript + PixiJS + Tauri     | 技能与客户端同语言；类型表达强；无界面测试方便；Web UI 工具丰富 | Android WebView 差异；自己组织战场布局和动画资源管理；应用壳仍有 Rust/Android 工具链 | 首选           |
| Godot + GDScript                | 场景、2D、动画和跨端导出集成；脚本易上手                        | 丰富的泛型/联合类型接口不如 TS 自然；测试与内容工具围绕 Godot；运行流程仍需自行设计  | 最有力备选     |
| Godot + C#                      | .NET 类型系统与测试生态；可分离纯 C# 核心                       | 移动导出与 Spine C# 接入需要更仔细核验；创作包编译分发比 TS 繁重                     | 不作为当前主线 |
| Unity + C#                      | 原生游戏工具与 Spine 生态成熟                                   | 为卡牌规则项目承担较大的编辑器和内容编译流程；不直接改善技能作者体验                 | 不优先         |
| C++/Rust 核心 + Lua/JS 技能     | 原生控制力强，脚本自由                                          | 双语言接口、数据映射、调试和构建负担；当前无核心性能瓶颈证据                         | 暂不采用       |
| Electron 桌面 + 独立 Android 壳 | 桌面浏览器环境可控                                              | 两套壳与生命周期适配；Electron 本身不能解决 Android 交付                             | 不作为第一选择 |

Godot 并非“不支持 Spine”：官方已有 GDExtension 和引擎模块两条接入路线，包含 Android；GDExtension 当前文档说明没有专用 C# bindings。Godot C# 文档仍将移动支持标注为 experimental，具体组合应以构建验证为准。[Spine Godot](https://esotericsoftware.com/spine-godot)、[Godot C#](https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/c_sharp_basics.html)

GDScript 已支持 `await`，不能把“能否写异步技能”当作 TS 独有优势。本次取舍主要来自类型接口、独立测试、内容工具与 UI 迭代的整体便利性。[GDScript 官方说明](https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html)

## 客户端技术组合

| 技术                              | 唯一职责                                                          |
| --------------------------------- | ----------------------------------------------------------------- |
| PixiJS 8                          | GPU 战场绘制、卡牌动画、目标指示、粒子与 Spine 容器               |
| `@esotericsoftware/spine-pixi-v8` | 官方骨骼运行时；禁止自行维护多代 Spine 兼容层                     |
| Svelte 5 + CSS                    | 菜单、说明、输入、选择面板、设置和开发工具                        |
| Tauri 2                           | 安装包、窗口、文件选择、存储位置、前后台通知等平台能力            |
| Vite + pnpm                       | 开发构建、依赖锁定；先用单一应用与源代码目录，不急拆 workspace 包 |

Svelte 只渲染投影视图与本地交互状态，不用响应式代理包裹权威游戏状态。选择 Svelte 是减少界面样板代码的偏好，不声称它经实测快于其他框架；不用 SvelteKit/SSR。[Svelte 官方介绍](https://svelte.dev/docs/svelte/overview)

Tauri 支持桌面与移动目标，但 Android 使用设备提供的 WebView，不能据此推断所有设备的 GPU 行为一致。核心与技能都留在 TS；不将每次规则操作跨 IPC 送给 Rust。[Tauri](https://v2.tauri.app/start/)、[WebView 版本](https://v2.tauri.app/reference/webview-versions/)

渲染首发以 WebGL 路线为基线，检测所需能力；WebGPU 暂不作为必需条件。PixiJS 文档目前仍推荐生产环境优先 WebGL。[PixiJS Renderers](https://pixijs.com/8.x/guides/components/renderers)

## Spine 资产策略

1. 先选定一组导出器与运行时版本，骨骼文件的 major/minor 必须匹配 runtime；在资源 manifest 记录导出版本。不要简单把“最新版”写进所有依赖。
2. 一个资产包包括骨骼、atlas、贴图与动画命名信息；优先本地打包加载，不依赖运行时 CDN。
3. `idle / enter / skill / hit / exit` 是表现约定，可以映射到资产自己的动画名；缺动画时使用静态立绘或普通过渡。
4. 资源按战场需要加载，离场释放；暂停不可见实例，限制高 DPR 贴图与同屏特效。规则不引用 Spine 对象或等待某条骨骼轨道完成。
5. 没有兼容需求，因此不支持参考项目中的多代运行时。旧素材若必须使用，另行评估转换可行性。

版本匹配和官方 Pixi runtime 能力见 [Spine 官方文档](https://esotericsoftware.com/spine-pixi)。P0 已将浏览器验证组合锁入 `pnpm-lock.yaml`：PixiJS 8.22.0 与 spine-pixi-v8 4.2.120，样本由 Spine 4.2 导出。原生双端尚未验收，不能把该组合当作真机兼容结论。

## 必须尽早消除的不确定性

默认首发桌面验收为 Windows，Android 为第二个必验目标；macOS/Linux 保持结构可移植，但本轮不宣称支持完成。

P0 使用同一客户端构建产出 Windows 应用与 Android APK，在真机验证：离线启动、中文文本、触控选牌、横屏安全区、Spine 透明混合、前后台恢复、资源释放。以 8 个可见骨骼实例作为初始压力场景，记录机型、系统、WebView、资产复杂度、帧时间和内存；它是测试负载，不是游戏功能硬限制。

暂定体验目标：选定中端 Android 真机上常规对局接近 60 fps，持续测试记录 p95 帧时间；低画质允许约 30 fps，操作反馈目标 100 ms 内。具体验收阈值随 P0 设备基线冻结，不作当前性能承诺。

若 Tauri 生命周期/资源路径阻碍交付，先定位壳层问题；若 WebView 渲染无法满足目标，重新评估 Godot + GDScript。后一选择将需要重写 TS 规则语言，不能宣称“替换渲染器即可迁移到 Godot”，所以 P0 必须早于大规模内容开发。
