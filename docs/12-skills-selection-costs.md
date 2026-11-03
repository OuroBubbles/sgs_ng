# 12 · 技能来源、联合选择与支付

受限分组的动态接收者、角色额度、逐项条件与失效刷新见后续 [59](59-constrained-assignment.md)，仍使用普通纯函数及既有 Decision，不另设技能 DSL。

状态：技能、选择与支付的现有契约。用牌/转换和阶段实现见 [13](13-card-use.md) / [14](14-turn-draw.md)，交付现状以 [STATUS](STATUS.md) 为准。

## 定义、实例与来源

[SkillBook](../src/rules/skills/skills.ts) 保存固定定义，局内数据全部在 World。技能是普通 SkillDefinition 对象：triggers 中的 on 描述触发，viewAs 描述转换，active 描述主动技能，具名 Query 描述查询修正。只声明实际能力，可省略空 triggers；目录登记统一校验并固定声明，defineSkill 可用于提前规范化，无需强制调用。on 的输入类型为 SkillTriggerDefinition，返回 SkillTrigger；底层绑定仍可由普通对象或方法实现。动态 Provider 同样可以返回没有触发能力的普通声明，不会产生虚构触发。

主动菜单的 `choice` 与最终主动选择共用 `instance` / `action`：`instance` 指本局技能实例，`action` 指该定义中的主动能力。将菜单 `choice` 与联合选择的 `cards` / `targets` 合并即可提交。菜单顶层的 `skill` 仍是技能定义 ID，供说明与 AI 识别；来源失效、材料、目标和阶段资格仍在提交与支付时重查。

defineSkill / viewAs 可重复调用；本入口已固定的声明原样复用，不在内容组合和每局登记时重复复制、绑定。外部浅冻结对象仍按当前输入校验与复制，原始对象不会成为缓存键；本局工厂每局执行，运行中的候选、来源与合法性仍实时查询。

装配期 `register` 可原子追加定义，第一次挂接后封口。需要牌规则的触发技能可通过显式工厂闭包取得 CardBook；转换与主动回调则直接取得本局目录。独立回合效果使用 [56](56-independent-effects.md) 的普通数据实例与闭包，裸衣不再手写专用 Provider。普通源码组合与未来接口见 [39](39-source-packages.md)。

技能入口支持普通方法：on 的 times / retain / when / run、主动的 available / selection / run、转换的 available / materials / 动态 count / names / make / use，以及底层 bind / contribution。静态装配固定声明与方法入口，保留原接收者，原型方法与私有字段不因对象复制失效；原对象不会被冻结。对象字面量、闭包与类方法使用同一套调用形式。方法内部继续读取原接收者，其可变数据与方法间调用仍由作者管理，局内状态不能存入跨局共享的定义对象。

同一角色同一技能只有一个实例，多个来源分别授予。最后一个来源移除才结束实例；之后重新获得创建新 ID，不能复活开窗快照中的旧候选。单个来源可以关闭；多个有效来源不会使技能重复触发。定义目录可跨 Room 共享，不在定义中存局内计数。

开窗时，核心通过 TriggerSource 从权威状态收集候选，不导入技能包。自定义 bind 返回的 Trigger 同样支持原型字段与方法；目录补充标签时固定声明字段、原方法及接收者，不冻结作者对象。候选保留实例 ID，执行前重查授予和失效；新获得技能从下一窗口开始。常规效果检查角色存活；死亡后效果显式声明 allowDead，该声明不绕过技能所有权。

触发的 when/run 使用 `(ctx, { payload, self, occurrence })`，times/retain 使用 `(ctx, { payload, self })`；按需解构，payload 保留原窗口载荷的对象身份与接口。self 提供 id/owner/skill/origin 与 effective(world)。一个效果开始后，不自动截断所有后续；选择/费用等关键节点按规则重查。装备来源派生与离场 retain 已实现，见 [18 · 装备与查询](18-equipment-queries.md)；allowDead 本身不表示来源保留。

历史来源现在可以普通 invoke/pay，规则与当前所有权分开：`effective(world)` 不恢复，`skillAvailable(ctx, self)` 只授权本次后效及子流程。撤销、到期与实际埋葬快照，以及自定义窗口登记见 [43](43-retained-effects.md)。

动态 Provider 登记与卸载已补齐，见 [44](44-provider-lifecycle.md)：旧候选和支付引用只属于原登记，retain 不绕过卸载，同对象重新登记不复活旧引用。装配期 `addProvider(provider)`；运行期 `addProvider(provider, ctx)` 与 `remove(ctx)`，Context 必须属于该目录唯一挂接的 Room。通常仍采用固定 Provider 从 World 派生能力。

## 状态与生存期

[StateKey](../src/rules/state/state.ts) 组合 key、默认值和类型校验，状态身份由 key/owner/source/lifetime 确定。值为普通数据，读取在类型与运行时都深只读。stateChange 可与其他费用变更组成一次提交；setState 单独提交变化。

[withLifetime](../src/rules/scopes/lifetime.ts) 管理明确的阶段/回合等生存期。普通子 Flow 不自动拥有回合语义；额外阶段获得新 ID。正常完成和 body 中止均原子清除到期状态、授予，再开放 lifetime.ended；代码故障和整局结束保留规则现场。

开始结束的生存期拒绝新增状态，避免到期后效制造永不到期的状态。失去技能不自动清除它已产生的独立效果，状态按自身生存期失效。

次数来源由规则明确选择：按技能定义计数可防止同阶段失去/再获得重置；确实需要按实例计数时用实例 ID。不同分支使用不同 key，不按界面点击累加。

标准包的结姻、制衡、青囊、反间、离间统一以 `self.skill` 作为阶段计数来源；支付事实仍保留实际旧实例。重新授予、启停或替换来源不刷新阶段次数，嵌套阶段则有独立额度；真实内容反例见 [42](42-skill-identity-audit.md)。这不是内核强制所有扩展共用计数身份。

## 联合选择

[JointSelection](../src/core/decisions/selection.ts) 覆盖牌与目标联合选择，支持零/多材料、动态候选和数量范围。候选函数可直接返回稳定 ID，例如 `targets: () => ['乙席', '丙席']`；需要自定义标签时返回 `{ id, label }`，也可混用。字符串标签默认为 ID，描述仍输出完整候选；牌名等有意义的标签继续显式提供。只有数量限制时直接计算完成可能；复杂约束使用普通函数：

- partial 检查额外的前缀约束，可省略，无需返回 null 的占位函数。
- canComplete 判断是否存在合法完成。
- complete 检查最终组合。

只选牌时提供 cards / cardCount，整组省略 targets / targetCount；只选目标时反之。候选与数量必须成对声明，类型检查和构造入口都会拒绝半组配置。构造时一次读取声明字段并绑定原方法；具名选择同样保存实际校验过的选项与 reason，不重新读取 getter。动态候选与约束仍在每次查询时执行。`new JointSelection()` 表达零选择；未声明维度归一为空候选与 0–0 数量，仍会拒绝夹带该维度的选项。描述、部分反馈和最终结果继续包含 cards 与 targets，不新增 UI 选择种类。

联合选择、分组选择、牌目标和转换材料共用同一数量规范化入口：一次读取 min / max，校验后保存为不可变范围，支持原型 getter，不冻结原对象。min 是非负安全整数，max 是不小于 min 的安全整数或 `all`。静态范围在装配时固定，动态分组与转换在每次读取时重新规范化；菜单、存在性与构牌使用本次已校验的范围。候选不足仍由模型实时判断，不把它当作声明错误。

例如点数和最终为 13，不能因此禁用第一张 5 点牌。核心不隐式枚举子集；作者可用普通算法、闭包或合法见证计算可完成性。

inspect 返回前缀合法性、最终可提交性、候选状态、原因和移除失效候选后的 refreshed 值，不替玩家猜测复杂组合的修复方案。describe(input) 同次返回数量描述与该草稿的 preview，省略 input 时仍描述初始空选择；主动技能的反馈只投影当前草稿一次。选中项允许取消；预览与最终验证共用同一约束，提交和支付仍实时重查，不缓存前一次候选。

available() 只检查空前缀的候选数量、可选 partial 与必需的 canComplete，不生成逐项投影，也不执行最终 complete 条件。它与 Decision.available 使用同一实现，适用于“能否进入选择”；突袭、流离与代受的触发判断直接调用它，不能拿它替代具体选择的 validate。候选与约束每次实时读取，不缓存前一次资格。

联合选择使用 decision(player, prompt, { optional, cancelLabel, reason })，取消标记、文案和原因集中在第三个选项对象中，与分组选择的调用形式一致；省略 optional 时不可主动取消。请求仍交给 ctx.ask，特殊描述与反馈可用普通函数扩展。选择本身不宣告或支付技能，提交与支付继续实时验证。

CardBook.hasOffers 与 offers 共用候选迭代，activeAvailable 与 activeOffers 共用主动资格检查；仅判断存在性时可提前停止，不生成完整菜单或逐项描述。用牌征询仍保留固定目标的额外过滤；纯同步过滤拒绝 Promise，候选存在性不替代实际材料、目标与支付的最终验证。

主动技能可用纯同步的 `selection(ctx, { self, phase, book })` 返回 JointSelection，将发动前的材料和目标加入当前出牌请求。`run(ctx, { self, phase, book, choice, selection })` 直接收到最终通过验证的牌与有序目标，以及本次执行校验使用的 JointSelection；没有材料和目标时可省略 selection。具名输入只是本次调用的数据，Context 仍独立传入，不隐式提供全局“当前技能”。标准主动技能不再先提交发动、再询问同一批选择。支付前可复用输入 selection.validate(choice) 重查当前候选；制衡、结姻、仁德、青囊、反间与离间已移除 run 内的重复模型构造。支付和后效仍由普通 run 组织；反间的猜花色、对方响应或获得新信息后的选择仍在结算中询问。

主动 available 可省略，只表达次数等额外发动条件；候选、预览与最终验证统一查询选择模型的 available()。因此仁德不需要重复检测手牌和接收者，制衡、结姻、青囊、反间与离间只额外检查阶段次数；离间的有序目标可完成性仍来自原来的普通算法。选择模型可进入不等于当前草稿已完成，支付和费用后的继续条件保持独立。

主动选择激将配方并确认目标也已表示发动，直接支付零材料宣告后请求他人供牌，不再追问一次是否发动。响应窗口中尚未选择激将时的发动询问仍保留。

界面点击技能、牌和目标只修改同一份草稿，最后确认一次提交。必选的下一目标只有一个合法候选时自动选中，不替玩家选择可选目标，也不自动提交。手动取消目标不立即补回；切换材料或技能时保留仍合法的目标。出牌阶段的“取消选择”只清空草稿，空草稿时的“结束出牌”才结束阶段。UI 与基础 AI 均复用同一选择反馈，不复制规则条件。

自定义 Decision 的 data 可省略；没有 describe 时由 Hub 将缺省值规范为 null。提供 describe 时以其实时结果为准，附属选择适配层不提前读取未使用的静态数据。公开 DecisionRequest 仍包含完整 data，自定义定义中的 optional 仍显式声明。Decision.describe 生成描述，feedback 生成部分反馈。revision 改变或显式 invalidate 时更新描述/token，提交时重新读取候选。请求只携带数据，闭包留在执行侧。联合选择面板由同一模型驱动，顺手/拆桥使用 opaque 选项；有序分组见 [37](37-arrangement-astrology.md)，动态角色额度与逐项接收条件见 [59](59-constrained-assignment.md)。

## 支付与宣告

[askInvoke](../src/rules/skills/invoke.ts) 统一技能的布尔询问与身份描述，返回是否接受；调用者用 available 指定继续条件，并自行组织支付与后效。裸衣、克己和洛神的继续询问复用它，不必手写 Decision。普通首次发动使用 invoke：它组合来源资格、同一询问和零费用宣告。洛神在宣告后失去原技能仍可继续，继续询问不会重复产生发动事实。

[pay](../src/rules/costs/pay.ts) 返回 paid/unavailable，最终检查角色、技能、次数、材料归属/区域及调用者的 legal 条件。技能支付以 skill 唯一确定付款人，普通支付显式传 actor，类型与运行入口均拒绝混用或缺少来源；reason 仍显式声明，不根据技能自动猜测。payDiscard 使用相同来源及付款人检查弃置权限。材料移动、次数和宣告在同一 cost.paid 提交中生效，然后才开放移牌后效和 cost.paid 窗口。零材料支付可整组省略 cards / to，不依赖无关的目的区；声明材料时两者必须成对提供，类型与运行入口均拒绝半组配置。零材料宣告也能记次数，不虚构移动，收据的 cards 仍为空数组。

`changes` 中的补充移动与费用材料一起组成一次真实移牌批次，不需要作者补发通知；费用收据只计 `cards` 声明的材料。所有受影响区域的提交前后快照在同步宣告前固定，具体语义统一见 [04](04-resolution.md)。

普通支付与弃牌费用由同一实现检查、提交并开放后效；payDiscard 只固定弃牌去向并追加实时弃置权限，不复制费用对象。费用字段可由原型 getter 提供，legal 方法保留原接收者；skill / actor / reason 在调用时读取一次，资格、权限、流程因果与收据共用这份来源和原因。材料在权限和 legal 检查前固定，弃置权限与实际移动使用同一份 ID，回调不能替换本次费用。权限与 legal 都必须通过，任一失败都不支付。材料列表每个位置都必须是真实 ID，空槽与未知 / 重复材料一样返回 unavailable，不形成部分支付。

支付后效完整结束后返回。后效令角色死亡或失去技能，不自动退还已付费用；作者按文本决定是否继续。取消选择、材料被取走或最终条件失效，不产生支付。

执行侧待决意图可作为 PaymentIntent 传入：纯 available 在提交前重查，committed 同步确定承诺，先于移牌/支付后效，不能 await。稳定 declaration 与执行闭包分开；护盾/转移的实际例子及故障边界见 [46](46-shield-transfer.md)。

## 可运行例子与证据

[作者入口](05-authoring.md) 的完整示例与 [渡口](../examples/content/harbor/index.ts) 使用相同的 SDK：普通 TypeScript 工厂取得本局 CardBook，通过 invoke 宣告、draw 摸牌。文档原样代码由 [模块场景](../tests/scenarios/content-examples.test.ts) 构建并真实结算，覆盖拒绝、正式摸牌时点、宣告后来源失去与事实重建。

受伤后私取与分批交牌可读 [标准遗计](../src/content/standard/strategists.ts)；私有牌池与真实摸牌各有自己的规则入口和时点。取消后保留已获得牌、逐批移牌、死亡善后与已宣告后失去技能的继续条件，由 [实际技能场景](../tests/scenarios/strategists.test.ts) 保护。通用边界分别见 [技能](../tests/scenarios/skills.test.ts)、[选择](../tests/scenarios/selection.test.ts) 与 [支付](../tests/scenarios/payment.test.ts)；当前验证只记录在 STATUS。

本地 FreeKill 参考：`packages/standard/pkg/skills/wusheng.lua` 将转换与牌执行分开；`standard_cards/pkg/skills/slash.lua` 独立检查次数/目标；`ltk/server/events/skill.lua:206`、`ltk/core/player.lua:996` 提供来源/失效/存活参考；`standard/pkg/skills/yiji.lua` 展示循环和联合选择需求。没有复制代码或兼容接口。

后续已实现语义牌/材料分离、用牌/目标效果身份、转换、基本响应、阶段驱动、反制链、席位投影与装备派生能力。[普通内容组合](39-source-packages.md)、[模式顺序策略](41-action-order.md) 和 [显式历史来源后效](43-retained-effects.md) 也已接入。[窗口中新来源显式加入](51-window-admission.md) 可通过 SkillBook.include 按实际技能实例请求，继续使用普通 on/invoke/pay。独立效果基础登记见 [56](56-independent-effects.md)；当前交付与后续范围以 [STATUS](STATUS.md) 为准。

稳定 ID/可读文本的具名选择使用 chooseOne + ctx.ask；客户端与最终校验复用同一决策，见 [35](35-response-blocks-intrigue.md)。

有限多次发动使用 on.times，when/run 可读取独立 occurrence；同组同席位按实时资格交错，源身份与次数不随后效自动扩张。已处理身份不会复活，新来源不自动补入；契约见 [38](38-window-occurrences.md)。
