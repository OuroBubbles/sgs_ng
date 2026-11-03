# 13 · 语义牌、目标效果与响应

状态：语义牌、目标效果与响应的当前契约；实现与验证范围见 [STATUS](STATUS.md)，整牌流程与反制见 [17](17-tricks-counter.md)。

## 实际模块

- [类型与转换](../src/rules/cards/types.ts)：SemanticCard、CardChoice、ViewAs、UseTiming、EffectRef。
- [CardBook](../src/rules/cards/book.ts)：固定牌目录、候选、构造、统一验证、宣告、目标效果与响应。
- [UsePlan](../src/rules/cards/plan.ts)：增删/转移/显式重复目标、阶段封口与原因记录。
- [标准牌子集](../src/content/standard/cards.ts)：杀、闪、桃、决斗、无中生有，以及无懈、群体锦囊、借刀与延时牌。
- [武圣](../src/content/standard/generals/guanyu.ts)：红色手牌/装备作为杀，复用同一管线。

## 语义牌与材料

实体牌仍恰处于一个区域，语义牌是本次操作冻结的值：牌名、花色、点数、属性、材料、转换来源。零材料和多材料都正常，不往实体牌表里塞虚拟牌。

当前牌面查询见 [50](50-card-faces.md)：book.face 保留印刷牌与角色过滤的区分，实体构建与单/多材料继承使用当前牌面；武圣、急救等配方通过 materials(ctx, { self, book }) 查询。转换的同步回调均可按需读取 self、book 和实际 purpose；make 另外取得 materials / parameters，异步 use 另外取得 intent。宣告后继续使用冻结语义牌，不按材料后来的区域和技能状态重算。

physical 选择必须是本人的手牌；viewAs 从当前有效技能实例的配方构造。配方只定义牌面、动态材料与数量，不复制距离、次数、目标或响应规则。固定转换的 make 是普通 CardFace 值，候选牌名直接从该值取得；动态转换保留 names / make 函数，make 可以根据普通参数返回不同牌面或拒绝构造。二者共用候选、材料、用途、目标与最终用牌校验；登记时复制固定牌面，宣告后的语义牌继续冻结。

规则代码也可以显式发出 generated 指令，为零/多材料生成牌，复用同一用牌过程。该指令不出现在玩家回复协议中，不能由选择回复伪造。它的材料可以来自规则明确指定的处理区，不被固定手牌入口限制。

候选列出配方家族，不枚举材料组合。它不能证明任意 make/参数一定存在合法完成；复杂前缀反馈与完整选择 UI 的接入仍需继续。

## 一次用牌

卡牌 `use` 回调统一采用显式 `ctx` 与具名输入，按需解构：`canUse/prepare(ctx, { request, book })`、`target(ctx, { request, target, book })`、`selection(ctx, { intent, book })`、`fixedTargets(ctx, { actor, card, book })`、`canResolve/resolve(ctx, { effect, book })`、`execute(ctx, { use, book, resolveTargets })`。共享函数或类方法可标注 SDK 导出的对应 `Card*Input` 类型。目录仍是本局同一 CardBook，不存在隐式当前牌或当前目标。

`resolveTargets(ctx, resolver?)` 仍是整牌函数可调用一次的普通函数；局部 resolver 同样接收 `(ctx, { effect, book })`。整牌资源可以由普通闭包共享，查询必须同步，prepare 与执行后效可以等待。execute 的普通数据返回值保存在本次 UseSnapshot.outcome 中，undefined 按 null 处理；逐目标 resolver 的返回值被忽略。两者的返回值都不替代目标状态或中止语义。

```text
构造牌面，校验时机/次数/目标
  → 可选 prepare 附属选择 → 冻结参数并重新验证
  → 建立独立处理区
  → 材料、次数、宣告在 card.used 中原子提交
  → 支付后效
  → use.declared / use.targets
  → 四层各遍历全部有效目标：指定前 → 确认前 → 指定后 → 确认后
  → 整牌 execute（可选）
  → 逐个独立目标效果：重查 → 启动 → 响应/执行 → 收束
  → card.finished / use.finished
  → 只清理本次处理区余牌
```

玩家已知的附属选择通过纯同步 `UseRules.selection` 合并到出牌草稿；`book.useSelection` 将其映射为真实目标与参数，再复用完整校验。宣告前异步准备、附属参数和借刀的真实目标见 [21 · 准备与借刀](21-preparation-collateral.md)。

UseId 来自本局稳定 FlowId，每个目标有独立 EffectId。初始目标按来源座次顺序执行。增删、转移和重复通过方法完成；添加目标不隐式重跑已经结算的目标。转移取消旧效果、创建新身份，并记录 fromEffectId；明确再次结算才调用 repeatTarget。

目标在轮到前已经死亡/被禁止时，不再启动其窗口。指定前/后以来源为锚点，确认前/后以目标为锚点；各层之间重查有效性。初始目标的四层均先于整牌函数与首个实际效果；新增身份补齐四层，旧身份不重放，详见 [36](36-target-stages.md)。取消只作用于对应效果，不退还已支付材料/次数，也不取消其他目标。重复取消幂等，已封口的计划和已开始执行的效果拒绝迟到修改。

已经宣告的牌不因来源死亡或转换技能失去自动消失；语义牌不重新从后来状态解释。伤害关联明确的 useId/effectId/card/processing，受伤后技能可以合法取走材料，结尾不重复弃置这些牌。子用牌可以借走父处理区材料，两个处理区各自善后。

同窗持续资格见 [61](61-target-pending-windows.md)：四层窗口只处理仍有效的 targeting 身份，effectStarting 的 main/counter/after 均要求 ready 及当前 canResolve；取消、移除、转移或失效后不再执行该窗口的剩余候选。effectFinished 仍公开已封口的取消/跳过/完成结果。检查发生在候选边界，不能代替正在运行的异步技能内部对后续操作的重查。

后续 [62](62-counter-effect-eligibility.md) 为 effectStarting 负载提供 available(ctx) 纯查询，与窗口 active 共用本次 resolver 的实际资格；标准反制及后续无懈继承它，不按牌名重复拼装条件，也不把延时生效误当初次放置。查询不会进入事实和展示数据；已封口的公共反制结论仍不倒改。

## 响应与具名查询

响应先打开 responseRequested，允许技能供牌或委托，再回退 card-response 决策。玩家回复只允许 physical/viewAs，规则供牌可以使用 generated。抵消杀调用 useResponse，完整使用闪并产生 card.used/useFinished；万箭和决斗调用 respond，产生 card.responded/responseFinished。请求 purpose 明确区分实际用途；委托者打出后，原请求者如需使用便在处理区回调内交接材料。详见 [55](55-response-purpose.md) 和 [20 · 响应与防具](20-responses-armor.md)。每项活动有独立 ID 并关联效果，完成后效及善后结束才返回。

响应杀不计入主动出牌阶段杀次数。需要多次响应时逐次支付，已打出第一张而第二张失败，不退第一张。禁止使用与禁止响应是不同查询。救援桃使用 askUse → use/rescue，不混入响应协议；救援调度与生命流程见 [15 · 生命与身份](15-life-role-match.md)。

当前纯查询可注入距离、攻击范围、手牌上限、使用/响应禁止、目标禁止、次数、响应数量与额外目标数，各自保留语义。它们不是完整技能修正声明/组合系统。出牌时机携带明确 owner/Lifetime，规则发出的 effect 时机与主动出牌分开；每次宣告仍进入历史。

## 证据与剩余边界

[用牌场景](../tests/scenarios/use-card.test.ts)、[转换场景](../tests/scenarios/view-as.test.ts)、[输入快照](../tests/scenarios/action-inputs.test.ts) 覆盖目标独立响应、转移身份、显式重复、零/多材料、动态牌名、装备材料、材料被取得、来源死亡、旧回复、禁止与输入对象被外部修改。

标准＋EX 的 32 种牌和 108 张实体牌已接入（见 [23](23-swords-standard-deck.md)），包含无懈反制链、装备与独立语义颜色（见 [18](18-equipment-queries.md)）、判定与延时锦囊（见 [19](19-judgment-delayed.md)）；生命救援和基础身份胜负已接入独立规则。现有武将与复杂机制的覆盖范围见 [STATUS](STATUS.md)。参考本地 FreeKill 的 standard_cards 牌定义及 standard 武圣机制，代码没有兼容桥或牌/技能 ID 特判内核。

防御成功后的追加用牌/突破、局部距离参数和动态目标数见 [22 · 武器与防御结果](22-weapons-defense.md)。

目标声明已改为 World 生存期数据，所有目标改写传入当前 Context；与费用同次提交的转移、按响应方冻结的最低次数、锦囊类别和距离豁免见 [34](34-target-declarations-tacticians.md)。

单次效果的响应禁令、单次用牌的具名反制禁令（含延时保存和自定义反制链）见 [35](35-response-blocks-intrigue.md)。
