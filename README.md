# sgs_ng

一个从零设计的三国杀项目。目标是用清晰、可组合的语义承载复杂规则，让内容作者能够自然地写出复杂技能，同时实现精致的桌面与安卓体验。

当前阶段：**默认由你控制甲席，其余角色以基础 AI 自动行动。** 已有六阶段、用牌/响应/转换、主动技能、濒死/救援/死亡与身份胜负；默认使用标准＋EX 的 108 张实体牌、32 种牌，可选关羽、黄盖、孙尚香、赵云、张飞、甘宁、夏侯惇、许褚、甄姬、司马懿、郭嘉、曹操、张辽、刘备、华佗、孙权、吕蒙、陆逊、黄月英、吕布、大乔、马超、周瑜、貂蝉、诸葛亮，共二十五名。标准包系统语义审计与完整离线三国杀验收仍待完成；Android 构建等桌面版完成之后开展，已有安装包仍为 P0。

## 本地运行

需要 Node.js 24 和 pnpm 11.25.0。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:1420`，选择席位、牌组与种子，开始单机对局。AI 武将可保留默认预设或统一指定。你固定控制甲席，其他角色自动行动；暂停或切到后台会藏牌并等待明确继续。按 1–9 选牌、Enter 确认、Esc 清除草稿。“手动演练（内容调试）”可切回多席手动控制；顶部“动画验证”可检查 1／8 个 Spine 实例与采样。基础 AI 的能力和边界见 [26](docs/26-basic-ai.md)。

```sh
pnpm check
pnpm test:core
pnpm exec playwright install chromium
pnpm test:ui
pnpm platform:check
```

`pnpm build` 产出 `dist/`；`pnpm desktop:build` 与 `pnpm android:init` / `pnpm android:build` 使用 Tauri。原生命令需要额外的 Rust、MSVC 或 Android SDK/NDK，详见 [P0 实施记录](docs/07-p0.md)。

作者源码包已接入。新增 `src/content/<packageId>/index.ts` 并默认导出 `definePackage(...)`，重新构建后可在开局选择；示例“作者演武”提供新牌、技能、跨包武将与独立牌堆。实际 API、依赖/版本和验收边界见 [39 · 普通源码内容包](docs/39-source-packages.md)。

也可用 `pnpm content:build <entry.ts> <output.sgs.mjs>` 单独构建内容，从开局页“导入内容包”载入，无需重新构建主程序。可运行源码见 [渡口示例](examples/content/harbor/index.ts)，加载与依赖见 [47](docs/47-local-content-modules.md)，持久保存与启动恢复见 [48](docs/48-content-persistence.md)。Windows 包附带 `harbor.sgs.mjs`。

内容模块及启用状态会持久保存并在重启后恢复。事务失败保留旧目录，多窗口修改检查版本，错误记录可明确重载或清空；实现与实际原生重启验证见 [48](docs/48-content-persistence.md)。

当前标准与演武内容为 0.1.20。[牌堆提交边界](docs/49-deck-boundaries.md) 已修正洗牌后效失效时继续摸牌的问题；[当前牌面与快照](docs/50-card-faces.md) 已统一红颜式过滤、转换材料、判定、UI 与基础 AI。[窗口显式加入](docs/51-window-admission.md) 允许新获得的技能参与本次尚未结束的时点，保持已有候选身份和固定顺序。启用作者演武可选择问道客，体验首次 AI 伤害后学习余响并立即选择发动；也可选择绯衣客及 40 张牌面演练。[生命待决边界](docs/52-life-boundaries.md) 已修正回复/死亡失效后继续执行候选的问题，并保留已提交事实与材料善后。[标准目录与活动归属](docs/53-standard-semantics.md) 已建立 25 将/40 技能/32 牌的核对入口，并修正克己对嵌套回合和阶段边界的误计。可运行 `pnpm audit:standard` 生成本地参考文本与源码哈希清单；它不替代行为验收。[具名响应禁令](docs/54-named-response-blocks.md) 已让铁骑仅禁止闪，普通/委托供牌先过滤名称，并在唯一供牌完成后收束其他候选。[响应中的使用与打出](docs/55-response-purpose.md) 已区分抵消杀时使用闪与万箭要求打出闪；护驾队友先打出，再由主公使用，材料在处理区内交接。完整离线版仍需继续标准内容语义审计。

[独立效果](docs/56-independent-effects.md) 已支持普通数据实例、全局/角色归属、查询、触发、更新和生存期结束后效。裸衣使用同一套规则库，另有 [跨回合守约源码](examples/effects/covenant.ts) 与真实外部模块验证，来源技能失去或宣告者死亡不必撤销已宣告的效果。

[判定待决窗口](docs/58-judgment-pending-windows.md) 已修复翻牌/改判中死亡或终局后继续执行旧候选的问题；保留已提交交换与封口后的真实结果，不要求扩展为每个后效重复保护整个判定域。

[反制持续资格](docs/60-counter-pending-windows.md) 已修复机会失效后继续执行开窗候选、嵌套返回后误记结果的问题；已实际使用的无懈仍保留用牌身份和材料事实，公共完成后效不倒改封口结果。

[目标与效果启动持续资格](docs/61-target-pending-windows.md) 已补齐同窗内取消、移除、转移、死亡和禁止后的候选收束；真实流离的新身份仍补齐四层，仁王盾/无懈取消后保留公共完成事实。各牌 canResolve 只用于实际效果，不提前过滤目标声明。

[嵌套反制与牌体资格](docs/62-counter-effect-eligibility.md) 共用 effectStarting 的 available 纯函数：目标治满、失去最后一张牌或被禁止后，反制链不再多询问或消耗无懈；延时后续生效使用本次 resolver，已提交用牌和封口结论保留。

[标准条件清单](docs/65-standard-card-review.md) 已登记 40 个技能和 32 种牌，共 172 条条件、480 条去重通过断言。完整测试后可运行 `pnpm audit:standard:behavior --complete`，`pnpm check` 也要求完整目录登记。常规检查不读取参考项目，目录完整仍不等于所有分支或完整离线产品验收。

[独立资源包](docs/66-content-resource-bundles.md) 支持普通 TS/图片 import 构建 `.sgs` ZIP，原始资源与源码分开、同次保存和恢复；失败/卸载释放本次 Blob URL。`pnpm content:bundle` 构建渡口和画阁示例。媒体内部相对依赖、作者 Spine 播放和跨模块代码 API 仍待继续。

[受限分组与角色分配](docs/59-constrained-assignment.md) 复用排序模型，支持动态组、角色额度、逐牌接收条件及合法初始方案。演武新增筹策客/分筹，一次确认批量移牌，私有面板可暂停，基础 AI 可完成；默认标准仍为 25 将，启用演武后共 30 将。

[武将立绘与作者图片](docs/57-portraits-content-images.md) 已接入二十五名标准武将的本地参考图。作者以普通图片 import 和 `generalViews` 提供资源，外部构建将图片内联，随模块持久保存；坏图回退轮廓，图片不进入规则状态和基础 AI。当前标准/演武为 `0.1.20`，渡口为 `0.1.1`。构建后可运行 `pnpm audit:portraits` 核对原始、复制、生产资源与外部模块内联字节。

## 技术决策

采用 **TypeScript + PixiJS 8 + 官方 Spine runtime + Svelte 5 + Tauri 2**。

- TypeScript：规则核心、技能、内容工具与测试共用一种语言。
- PixiJS：战场、卡牌、特效与 Spine 动画。
- Svelte：菜单、技能说明、选择面板、设置与调试器。
- Tauri：桌面与安卓应用壳；Rust 仅用于必要的平台接入。
- Vite、pnpm、ESLint、Prettier：构建与代码质量工具。

浏览器与 Windows Debug/Release 的真实界面至胜负和 Spine 播放已验证。当前 Windows 练习版为 `.artifacts/builds/sgs-ng-0.1.0-local-client-windows-x64.zip`，解压运行。Android ARM64 Debug APK `.artifacts/builds/android/sgs-ng-0.1.0-arm64-debug.apk` 仍为旧 P0，不能代替当前客户端验证。Android 真机验收另见 STATUS。

## 阅读顺序

| 文档                                           | 内容                            |
| -------------------------------------------- | ----------------------------- |
| [01 · 语言与技术选型](docs/01-technology.md)        | 选择理由、备选方案、跨端验证门槛              |
| [02 · 参考项目分析](docs/02-reference-analysis.md) | 本地 FreeKill / noname 的源码证据与取舍 |
| [03 · 架构与模块](docs/03-architecture.md)        | 依赖、所有权、数据流、目录和扩展边界            |
| [04 · 事件与结算契约](docs/04-resolution.md)        | 嵌套流程、时点、提交、伤害、移动与决策           |
| [05 · 内容作者接口](docs/05-authoring.md)          | 技能组合、选牌、转换牌、状态、复杂技能样例         |
| [06 · 工程与验收](docs/06-delivery.md)            | 注释、格式、测试矩阵和实施顺序               |
| [07 · P0 实施记录](docs/07-p0.md)                | 运行方法、实际模块、依赖与验证边界             |
| [10 · 内核实施](docs/10-kernel.md)               | 已实现机制、实际 API、规则反例与未实现边界       |
| [11 · 离线版路线](docs/11-offline-roadmap.md)     | 离线规则、基础 AI 演示与后续平台/托管路线       |
| [STATUS](docs/STATUS.md)                     | 已完成、未完成与验证边界                  |

实际作者接口见 [12 · 技能/选择/支付](docs/12-skills-selection-costs.md)、[13 · 用牌与响应](docs/13-card-use.md)、[14 · 阶段与摸牌](docs/14-turn-draw.md)、[15 · 生命与身份对局](docs/15-life-role-match.md)、[17 · 整牌流程、锦囊与反制](docs/17-tricks-counter.md)。客户端契约与验证见 [16 · 正式规则客户端](docs/16-local-client.md)。装备来源与查询见 [18 · 装备与纯查询](docs/18-equipment-queries.md)，判定与延时牌见 [19 · 判定与延时牌](docs/19-judgment-delayed.md)。八卦阵、青釭剑、仁王盾及可委托的供牌入口见 [20 · 响应与防具](docs/20-responses-armor.md)。宣告前附属选择与借刀见 [21 · 准备与借刀](docs/21-preparation-collateral.md)。武器与防御结果见 [22](docs/22-weapons-defense.md)。

设计原则：**小而明确的运行核心，足够丰富的规则标准库，自由的普通代码。** 不把所有技能压进配置表，不为尚未发生的需求建立通用框架。

动态技能来源的登记、卸载与后续支付边界见 [44 · Provider 生存期](docs/44-provider-lifecycle.md)。

连环传播、具名伤害属性与可组合攻击函数见 [45](docs/45-chain-damage.md)；作者演武提供缚阵/引焰及 48 张连环演练。

护盾与待决伤害转移见 [46](docs/46-shield-transfer.md)；凝障、守阵客/代受与 48 张演练通过真实 AI 攻击验证，费用先确定转移再执行支付后效。

首批真实武将、主动技能函数与统一 play-action 入口见 [27](docs/27-generals-active-skills.md)。弃置权限、龙胆/咆哮/奇袭与技能说明见 [28](docs/28-discard-martial-generals.md)。刚烈/裸衣/洛神/倾国、显式阶段摸牌与独立回合效果见 [29](docs/29-wei-judgment-effects.md)。鬼才/反馈/天妒/遗计、改判宣告与私有牌池见 [30](docs/30-strategists-private-pools.md)。奸雄/护驾/突袭、当前势力、主公技授予与阶段体替代见 [31](docs/31-commanders-phase-replacement.md)。仁德/激将/青囊/急救、供牌使用与回合外救援见 [32](docs/32-benevolence-supply-rescue.md)。制衡/救援/克己/谦逊/连营、回复草案与活动查询见 [33](docs/33-wu-recovery-history.md)。集智/奇才/无双/国色/流离、目标宣告与响应要求见 [34](docs/34-target-declarations-tacticians.md)。马术/铁骑/英姿/反间/离间/闭月、单次响应和反制限制、具名选项见 [35](docs/35-response-blocks-intrigue.md)。

双股剑、寒冰剑、性别规则、两个新增窗口及标准实体牌表见 [23 · 两件剑与标准牌组](docs/23-swords-standard-deck.md)。额外回合、重复阶段与嵌套恢复见 [24](docs/24-extra-turns.md)，按参考图调整的牌桌位置见 [25](docs/25-table-position.md)。

构建工具与排错经验见 [08 · 开发指南](docs/08-development-guide.md)，本轮参考 noname 的交互取舍见 [09 · UI 改进](docs/09-ui-iteration.md)。

`freekill/` 与 `noname/` 是本地参考材料，不属于新项目源码、构建输入或自动格式化范围。参考证据以本次读取的文件为准，不能等同于上游最新版本。

多目标四层、动态追加与来源中途离场的当前契约见 [36](docs/36-target-stages.md)。

观星的有序分组模型、私有余牌归还与空城见 [37](docs/37-arrangement-astrology.md)。

遗计/枭姬的有限触发次数、同一时点交错与实时资格契约见 [38](docs/38-window-occurrences.md)。

流程结果与领域结果分开；作者可用 `ctx.unwrap(await operation(...))` 显式延续中止。决斗、响应/改判窗口锚点与救援桃的边界审计见 [40](docs/40-flow-results-responses.md)。

模式行动序与通用内核分离：身份局优先当前回合角色，回合外使用事件主体，作者可显式覆盖；目标序列在宣告时冻结。契约与验收见 [41](docs/41-action-order.md)。

标准技能身份与伤害归属审计见 [42](docs/42-skill-identity-audit.md)：修正结姻重新授予后的次数刷新、技能变更主体与裸衣决斗归属，并逐将运行二十五种四人身份局。整局证据只证明实际运行的路径，完整标准包系统语义审计仍继续。

历史来源的普通发动/支付见 [43](docs/43-retained-effects.md)：当前所有权与本次后效资格分开，撤销/到期/埋葬快照与自定义窗口显式登记。作者演武新增遗玉与 40 张演练牌组，可以在真实界面体验装备离场后接受或拒绝摸牌。

> > > > > > > 
