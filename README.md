# sgs_ng

从零设计的三国杀项目：以个人开发、AI 辅助持续迭代，用简洁、可组合的规则语义承载复杂技能，追求 SoTA 的系统与玩家体验。

内置内容直接使用普通 TypeScript 定义与组合，不要求扩展包清单、版本或依赖登记。未来开放创作者扩展保留内容定义与目录注入接口；包格式、专用编译器、安装与持久内容库已移除。当前代码与平台验证见 [STATUS](docs/STATUS.md)。

**离线桌面 v0.1 已完成基线验收**：现有标准＋EX、身份模式、固定甲席＋基础 AI 和普通作者扩展。持续以具体反例审视规则内核、作者语义与承载力，不以重构成本保留问题，并定期清理过时实现与说明。技术栈为 TypeScript + PixiJS 8 + Svelte 5 + Tauri 2。阶段顺序为离线桌面/UI/AI 托管、桌面联机、Android 与双端联机；当前 Windows 客户端可直接创建和加入联机房间。策略和暂停边界见 [基础 AI](docs/26-basic-ai.md)，当前企划见 [路线](docs/11-offline-roadmap.md)，实际完成情况只在 [STATUS](docs/STATUS.md) 维护。

## 运行与验证

在 `C:/workspace/sgs-ng` 使用 Node.js 24、pnpm 11.25.0：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:1420`，从启动页选择“单机演武”，配置后开始对局。默认固定控制甲席，其他角色以基础 AI 行动；手动演练供内容调试。按 1–9 选牌、Enter 确认、Esc 清除草稿，暂停或进入后台会藏牌并等待明确继续。

联机：Windows 启动页选择“联机房间”，设置 2–8 席、玩家人数、所选内容的牌组、初始阵容和种子后创建，再将“房间地址”中的局域网地址发给其他玩家。完整解压交付包即可运行，无需另装 Node。创建者选择标准或机制演武源码目录；加入者使用主持端提供的资源与展示数据。玩家依次入席，可自行选将和取消准备，全部准备后开局，其余席位为基础 AI。终局后各自点击“准备下一局”，其他人可继续查看结果；全部准备后在原连接中开始新局。短暂断线可重连原席位，刷新后可从开局页返回原房间；不重开当前局，不重发旧答案。主动离开结束本局，有人断线时其他玩家也可明确结束。创建者关闭房间或退出程序会关闭主持端；关闭后可重新创建，并保留上次创建配置。真实跨机器验收仍待完成。开发者仍可用 `pnpm online` 启动独立主持端。见 [客户端契约](docs/16-local-client.md#联机纵切)。

```sh
pnpm typecheck
pnpm check
pnpm format:check
```

界面改动另运行 `pnpm test:ui`；首次需要 `pnpm exec playwright install chromium`。Windows 构建、实际程序验收和归档入口见 [开发指南](docs/08-development-guide.md)。Android 构建入口见同一指南，当前候选包与平台待验范围在 STATUS 维护。

## 内容开发

直接修改 [标准内容](src/content/standard/index.ts)、[机制演武](src/content/workshop/index.ts) 或其普通源码文件。导出 `ContentDefinition` 对象，再用 `createContent(...)` 组合；定义、Window、Query 与闭包共享真实对象，无需打包或注册内容版本。标准武将一将一文件，位于 [generals/](src/content/standard/generals/)（如 [孙权·制衡](src/content/standard/generals/sunquan.ts)），写法见 [开发入口](docs/05-authoring.md)。

主动技能使用 `run(ctx, { self, phase, book, choice })`，按需解构字段；支付、后效和嵌套结算仍由普通函数、分支、循环与 await 组织。新增交互类型需要补齐 UI / AI 映射。跨文件合作使用普通 import，示例直接纳入类型检查与真实结算场景。

## 阅读入口

| 需要了解          | 入口                                                   |
| ------------- | ---------------------------------------------------- |
| 当前目标与取舍       | [路线](docs/11-offline-roadmap.md)                     |
| 已实现、已验证与缺口    | [STATUS](docs/STATUS.md)                             |
| 模块职责、依赖和所有权   | [架构](docs/03-architecture.md)                        |
| 嵌套流程、时点、提交和决策 | [结算契约](docs/04-resolution.md)                        |
| 实际作者 API      | [作者入口](docs/05-authoring.md)、[SDK](src/sdk/index.ts) |
| 独立效果及其生存期     | [独立效果](docs/56-independent-effects.md)               |
| 内容组合与模块共享     | [内容组合与未来扩展](docs/39-source-packages.md)              |

编号文档中的历史批次验收、版本和后续计划不作为当前任务队列；作者先从当前 [作者入口](docs/05-authoring.md) 阅读，再按需查阅专题契约。

<<<<<<< HEAD
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

遵守上级 [工作区约定](../WORKSPACE.md)：复用已有工具，项目依赖与产物留在项目内，不为项目另建通用环境管理层。同级目录 `../freekill/`、`../noname/` 是只读参考，不属于新项目构建输入。
