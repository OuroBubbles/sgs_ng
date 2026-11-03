# 05 · 内容开发入口

本文使用当前 [SDK](../src/sdk/index.ts)，不再保留不能直接执行的早期示意接口。系统能力与未验收边界以 [STATUS](STATUS.md) 为准；流程、时点和故障的完整契约见 [04](04-resolution.md)。

## 日常开发：直接组合普通定义

当前以个人开发、AI 辅助为主。直接修改 [标准内容](../src/content/standard/index.ts) 或 [机制演武](../src/content/workshop/index.ts)，导出普通 `ContentDefinition` 对象。卡牌、技能、武将、牌堆与展示声明可以来自任意普通 import；没有包清单、内容版本、依赖登记或 ID 前缀要求。

用 [createContent](../src/content/catalog.ts) 将一份或多份定义组合为本局目录，例如 `createContent(standard, practice)`。`skills` 始终是列表，静态对象和普通工厂可并列，例如 `skills: [wusheng, guicai]`；工厂接收本局 CardBook，可返回一个或一组技能，分支、循环与普通函数组合保持可用。条目按组合后的列表顺序逐项登记，工厂可读取前面静态声明或工厂返回的技能；有依赖时将被依赖项放在前面，合并或拆分 ContentDefinition 不改变这个顺序。组合时固定卡牌和静态技能的声明快照，之后修改原对象不影响对局；工厂拿到该局实际使用的 CardBook，Window、Query 和普通闭包保留对象身份。默认对局直接装配标准源码；`RoleMatch` 统一通过 content 传入普通定义或已有目录，例如 `content: { cards, skills, generals }`，二者共用同一装配实现。标准内容现有 `standard:` ID 是内容命名习惯，普通装配不强制该格式。

持续生效的独立效果放在同一 `ContentDefinition.effects` 列表，由装配入口每局登记；技能工厂只需返回技能。[裸衣](../src/content/standard/wei.ts) 的技能与独立效果在 [标准入口](../src/content/standard/index.ts) 分别声明，不再依赖调用技能工厂的登记副作用。局内创建效果仍用普通 `book.effects.prepare/add`，来源技能失去后是否保留由规则决定。

用 [createOfflineMatch](../src/app/offline/practice.ts) 运行普通场景时，直接提供 `{ seed, preset, lineup, content }`；阵容长度决定人数。无固定阵容的练习局使用 `{ count, seed, preset }`，count 与 lineup 在类型上互斥；无参数仍是四席标准局。源码按常规相对路径导入 SDK，不再保留仅类型检查可见的特殊别名。

content 可直接传普通 ContentDefinition 或已有目录；preset 交给 [RoleMatch](../src/app/offline/role-match.ts) 从同一内容装配中生成牌表和取得名称。直接建局时，deck 可写目录牌组 ID，例如 `deck: 'play'`，也可提供自行生成的实体牌数组。实体牌先固定快照，再用同一份数据验证定义与建立初始状态，不冻结调用者的原对象；deckName 仍可显式覆盖显示名称。

技能直接写普通对象，用 `satisfies SkillDefinition` 获得类型提示，只声明实际能力，空的 `triggers` 列表不是必填。标准内容、机制演武与示例均采用此写法，转换配方也直接写在 `viewAs` 列表中。`triggers: [on(window, …)]` 与独立效果的触发列表同名；`ContentDefinition.effects` 只登记独立持续效果。createContent / SkillBook 与装备装配负责原有校验、声明快照及方法绑定；defineSkill / viewAs 仍可用于主动提前规范化，无需逐项包装内容声明。

独立效果同样直接写普通对象，用 `satisfies EffectDefinition<Data>` 保留数据和句柄的类型提示。createContent / EffectBook 固定声明并绑定原接收者；defineEffect 用于主动提前规范化，内置裸衣与[守约示例](../examples/effects/covenant.ts)均由装配入口完成这一职责。

active 与 viewAs 的 label 可省略，菜单使用当前技能实例的 name；需要区分同一技能的多个能力时再声明，例如龙胆的杀与闪。发布给 UI / AI 的菜单仍始终包含完整名称。

卡牌、技能、转换配方、独立效果与武将按声明字段各读取一次，校验与保存使用同一份快照；目录再用该快照检查重复并建立 ID 索引。时点组与技能能力列表也先固定再校验，普通对象与原型 getter 使用相同路径。方法入口固定并绑定原接收者，作者对象仍可供其方法读取，不会被冻结。演武与示例的武将直接使用外层 `satisfies ContentDefinition` 提供的类型提示；单独声明列表时可用 `as const satisfies readonly GeneralDefinition[]`。defineGeneral 仍可用于主动提前规范化单项声明。

on 与 effectOn 可省略局部 id，默认使用时点的 id；同一技能或独立效果内默认名冲突时，再显式区分处理器。底层自定义 bind 声明仍提供明确 ID。

局部 ID 冲突时，报错指出技能 ID、能力种类与重复的 ID；缺失局部 ID 由对应声明入口拒绝。触发、转换与主动能力各自检查局部 ID，跨种类可以同名。批量登记失败时整批不生效，修正后可重新登记。

主动技能的 `available` / `selection` 使用 `(ctx, { self, phase, book })`；执行使用 `(ctx, { self, phase, book, choice, selection })`，按需解构字段，不再填充位置占位参数。`available` 可省略，只表达次数等额外条件；引擎通过 selection 检查材料、目标与复杂约束是否存在完成路径，不用再手写同一遍候选检查。苦肉可只声明 run，仁德可只声明 selection 与 run；阶段和来源资格仍由引擎检查。selection 是本次执行重查使用的模型，可在支付的 legal 中调用 selection.validate(choice)，无需再建一次相同模型；候选仍实时读取。触发回调继续使用下文的窗口载荷接口。

零材料转换可整组省略 materials / count，由执行侧补齐空候选与零张数；需要材料时两者必须同时声明，类型检查与运行入口均拒绝半组配置。固定转换直接声明 `make: { name: 'standard:slash' }`，可能牌名从牌面取得，无需再写 `names` 或常量返回函数；装配时固定牌面快照。动态转换仍显式提供 `names` 与 `make` 函数，后者可按参数返回不同牌面或 null。`names` / `materials` / `count` / `available` 的函数使用 `(ctx, { self, book, purpose })`；`make` 函数还可取 `materials` 和 `parameters`，如 `make: (_ctx, { parameters }) => ...`。`purpose` 明确区分使用与打出，预览和最终构牌共用同一用途。可选的 `use` 使用 `(ctx, { self, book, purpose, intent })`，直接返回 `UseResult` 或其 Promise，purpose 固定为 use；管线等待完整结果，[激将](../src/content/standard/benevolence.ts) 继续用普通异步供牌完成真实用牌，不增加询问层级。

查询修正使用 `modify(query, (ctx, { input, self }) => value)`，按需读取查询数据与技能来源；共享函数可标注 `ModifyInput<T>`。贡献的组合与底层自定义协议见 [装备与查询](18-equipment-queries.md#小而可组合的纯查询)。

卡牌 use 的回调沿用相同约定，例如 `target(ctx, { request, target, book })` 与 `resolve(ctx, { effect, book })`；整牌 execute 取得 use / book / resolveTargets，可继续用普通控制流编排目标与共享资源。具体输入及查询 / 后效区别见 [语义牌与用牌](13-card-use.md#一次用牌)。

## 一个完整技能

[研习示例](../examples/content/study.ts) 是可直接 import 的完整普通源码：使用锦囊时可询问摸牌。它通过工厂取得本局 CardBook，不使用清单、版本或名称前缀。可以修改该文件，或在自己的普通文件中定义技能。

在 [本地装配](../src/app/offline/practice.ts) 中显式组合定义，例如 `createContent(standard, study)`，再执行 `pnpm typecheck` 与 `pnpm check`。不扫描目录、不自动安装，也不要求自建牌堆、模式或 UI。[真实场景](../tests/scenarios/content-examples.test.ts) 直接 import 示例，验证取消、宣告、来源失效后的后效与事实重建。

未来扩展只保留 [内容组合接口](39-source-packages.md)，没有独立包格式或专用构建命令。普通跨文件合作使用常规 import，见渡口与画阁示例。

## ctx、self 与普通函数

`on` 的 `when/run` 接受 `(ctx, { payload, self, occurrence })`，按需解构，例如 `run(ctx, { self })`。`times/retain` 只依赖载荷与来源，接受 `(ctx, { payload, self })`。独立函数或类方法可标注 `SkillTriggerInput<T>` / `SkillTriggerOccurrenceInput<T>`。`self.owner` 是技能拥有者，`self.id` 是本次技能实例，`self.skill` 是定义 ID；`ctx` 携带本次结算的状态读取、原因、历史和作用域。没有 `ctx.owner`、`ctx.draw` 或隐藏的全局“当前事件”。

规则操作直接调用 `await draw(ctx, input)`、`await damage(ctx, input)` 等普通函数。分支、循环和局部变量由 TypeScript 表达；父流程等待所有嵌套后效结束才恢复。不要并行写同一局；直接 await 或返回子操作的 Promise。

临时处理区使用 `withProcessing(ctx, materials, body, cleanup?)`：直接编写主体，默认只弃置结尾仍在该区的余牌；特殊目的区域或善后函数放在最后。body 可返回领域值，自定义善后可根据 resolved/aborted 处理余牌，不要求把技能改写成生命周期配置。

只有一步时可直接写 `run: (ctx) => draw(ctx, input)`；技能、卡牌与领域后效的执行回调会等待返回的操作，忽略其结果。需要按 `paid/unavailable` 等结果分支时仍用普通 `await`；返回值本身不改变取消或中止语义。

`ctx.flow(...)` 返回领域值，中止默认向外传播。只有确实允许局部中止并继续的边界才使用 `ctx.attempt(...)`；故障和整局关闭不能因此恢复。无需给每个技能包一层 attempt，或逐层检查 aborted。

## 选哪种能力入口

| 需求                         | 当前入口                                                    | 可运行源码                                                                             |
| ---------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 在时点参与结算               | `on`；`when` 为纯查询，`run` 可等待                         | [集智等](../src/content/standard/tacticians.ts)                                        |
| 出牌阶段主动发动             | `active` 中的 `available` / `selection` / `run`             | [制衡](../src/content/standard/wu.ts)                                                  |
| 将材料解释为另一张牌         | `viewAs`；用牌与响应规则继续由 CardBook 处理                | [武圣](../src/content/standard/wusheng.ts)、[龙胆](../src/content/standard/martial.ts) |
| 修正牌面、距离或限制         | `modify` + 具名 `cardQueries`；自定义组合可用 `defineQuery` | [谦逊](../src/content/standard/wu.ts)                                                  |
| 创建失去技能后仍可存在的效果 | `EffectDefinition` / `EffectBook`，实例数据存 World         | [裸衣](../src/content/standard/wei.ts)                                                 |
| 定义新的规则时点             | `defineWindow<T>` + `ctx.window`，跨包直接共享对象          | [渡口](../examples/content/harbor/index.ts)                                            |

一个技能可以组合这些入口，也可直接编排公开规则函数；没有要求复杂技能翻译成配置 DSL。新 helper 应来自真实重复的语义，而不是为隐藏一个循环建立通用框架。

## 选择、费用与继续条件

稳定 ID / 可读选项使用 `chooseOne`；材料与目标的联合选择使用 `JointSelection`；有序分组使用 `ArrangementSelection`。模型提供动态候选、前缀检查、最终验证和预览，UI 消费同一决策，不重写合法性。复杂约束用普通 `canComplete` 判断合法完成路径、`complete` 检查最终组合；需要额外前缀约束时再提供 `partial`，无需空函数占位。不能靠无界穷举或只检查最终组合。三个入口均读取选项的 id / label 后形成快照，支持原型 getter，不冻结原对象。

JointSelection 的 cards / targets 候选函数可直接返回稳定 ID 数组，需要自定义文字时返回 `{ id, label }`，两种条目可以混用；字符串的标签就是 ID。索引与预览使用同一次读取的字段值。预览仍输出完整候选，不改变回复形状。JointSelection 中不用的维度可整组省略：只选牌提供 cards / cardCount，只选目标提供 targets / targetCount；候选与数量必须一起声明。构造时统一补齐空维度，动态候选仍在预览和提交时重新读取；结果始终保留 cards / targets 两个数组，不让技能处理多种返回形状。

所有数量范围共用同一约束：min 为非负安全整数，max 为不小于 min 的安全整数或 `all`。联合选择、静态分组、牌的静态目标数量和转换的静态材料数量在对应声明规范化时检查；分组函数和转换函数返回的动态范围在每次查询时检查，错误指出对应牌或配方，不等到玩家提交后才暴露。

`selection.available()` 只查询空前缀能否继续，不生成候选投影，也不要求已选齐；复杂可完成性仍由声明中的普通函数决定。主动技能的候选、预览与最终验证共用这一入口。实际提交还会验证选中的具体牌与有序目标，支付继续独立重查次数及费用。

`invoke` 负责自愿发动的询问、来源资格和零费用宣告。需要自己组织支付或询问已宣告效果是否继续时，使用 `askInvoke(ctx, self, prompt, available?)`；它返回是否接受，资格由 available 表达，支付与后效继续使用普通代码。裸衣将独立效果与发动同次提交，克己将跳过标记与发动同次提交；洛神的继续询问沿用已宣告循环自己的继续条件。

技能支付只传 skill，付款人来自其 owner，如 `pay(ctx, { skill: self, reason: self.skill, limit })`；普通支付显式传 actor，两种来源互斥。reason 始终由调用者声明。零材料支付可省略 cards 和 to；声明材料时两者必须一起提供，弃置费用可用 `payDiscard` 固定目的区。支付入口重新检查角色、来源、次数与材料，返回 `paid/unavailable`。费用与次数提交后，移牌及支付后效完整结束才返回，取消后效不自动退款。不要按 UI 点击计次。

需要在费用确定时同步修改待决草案，可使用 `PaymentIntent`。它的 `available` 是纯查询，`committed` 必须同步，先于支付后效；异步宣告属于代码故障。普通技能通常无需直接使用此入口，实际例子见 [伤害转移](../src/content/workshop/defense.ts)。

“后续还需要什么条件”由技能文本决定。来源在发动前必须有效；已经宣告的效果不因为来源消失而统一回滚，也不应在每个 await 后机械添加 `self.effective(...)`。确实要求目标仍存活、当前阶段未结束或仍持有技能时，用动态候选及 `available` 表达，并由实际操作最终校验。区分草案、按发动时固定的来源与已经提交的结果。

直接调用 `draw` / `recover` 即复用规则操作对受益者存活与终局的重查；技能只表达是否接受发动、支付是否成功、材料/目标选择和文本特有的继续条件。多目标后效仍逐个 await，每个目标在实际操作时独立校验。

## 状态、只读值与生存期

局内计数和标记用 `defineState` / `readState` / `setState`，不要放在共享定义或模块级可变变量中。`stateChange` 可与费用组成同一提交。`UsageLimit` 的 source 由规则选择：按技能定义计数可防止同阶段重新授予重置，按实例计数则区分每次获得。

阶段、回合等使用有身份的 `Lifetime`，嵌套阶段和额外回合各自独立。普通 Flow 不自动变成回合生存期。独立效果使用自己的到期条件，失去创建它的技能不代表效果一律消失；具体契约见 [独立效果](56-independent-effects.md)。

World、事实和接纳后的决策值在类型与运行时均只读；需要本地修改数组时先复制。领域草案通过其公开方法修改，封口后不能继续改写。`ctx.query` 与所有合法性查询不能写状态、取随机数或 await；违规异步规则查询立即冻结本局。

状态初值、状态写入和效果新增 / 更新先固定普通数据快照，再把这份快照交给 accepts；校验与保存不会各读一次原值。有 Context 的状态写入与效果操作在纯查询内复制，数据 getter 不能借复制写入规则状态。效果记录作为整份图复制，origin 与 data 的共享引用保持。

具名 Query 的开始值、贡献与合并函数、来源资格、retain、状态与独立效果的数据校验器、独立效果行为工厂及自定义触发绑定都必须同步。主动技能的 `available` / `selection`、用牌的 `UseRules.selection`、转换的候选/资格/数量/构牌函数，以及选择模型的候选与约束也遵循此约定；用牌目标和响应资格的最终重查仍是纯查询。

规则层在组合前逐项检查其直接调用的回调，避免 Promise 被布尔运算、数组或行为对象访问隐藏。执行侧查询违规时立即冻结；本地投影、预览或回复出错则由主持侧停止本局并显示错误。普通内容继续直接使用现有入口，无需自行包裹守卫；异步后效仍放在 run / onEnd 中。作者函数内部的普通表达式仍由作者负责，类型检查不能省略。

## 扩展与验证的边界

普通文件可以导出函数、Window 和 Query，由相对 import 共享同一实例；资源使用静态 import 或调用者提供的 URL。见 [跨文件协作](39-source-packages.md#跨模块代码共享) 与 [资源](39-source-packages.md#资源与所有权)。不在挂起技能中途热换定义，也不引入签名或沙箱体系。

当前客户端支持已登记的选择形态。自定义 `ctx.ask` 类型能在规则层运行，不代表 UI 和基础 AI 已自动具备该交互；不支持的必选决策会中止基础 AI 对局。先复用现有选择模型，确有新交互需求时再补完整执行、投影和客户端路径。

改动后先运行 `pnpm typecheck`、`pnpm lint` 与对应领域场景；交付前运行 `pnpm check`，界面改动另跑 `pnpm test:ui`。检查领域结果、取消/失效与嵌套路径，不为每个实现细节追加测试。轨迹从 `ctx.history` 的事实和原因链读取，随机数使用 `ctx.randomInt`；不依赖真实时间、动画或 `Math.random` 决定规则。
