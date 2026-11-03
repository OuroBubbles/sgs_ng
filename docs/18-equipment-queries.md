# 18 · 装备来源、纯查询与语义牌颜色

日期：2026-10-17。本批新增诸葛连弩、丈八蛇矛和六种标准坐骑，装备批完成时练习客户端为 20 种牌；后续判定/延时牌见 [19](19-judgment-delayed.md)。当前未完成的装备和武将见 [STATUS](STATUS.md)。

## 以牌位置为唯一来源

[装备标准库](../src/rules/cards/equipment.ts) 从 World 的 equipment 区域派生能力。装备移动、支付为材料、转移持有者、埋葬后，下一次查询立即反映实际位置，不依赖一套安装/卸载回调更新另一份技能列表。

显式授予的技能仍按角色/技能共享实例，多个 grant 分别管理。装备能力则按实体牌/持有者拥有独立句柄，origin 指向该牌；它们不伪装成 World 中的显式 grant。相同定义可以复用，来源身份仍明确。重新装回同一角色时沿用该实体来源身份，不声称生成新的装备占用 epoch。

[SkillBook](../src/rules/skills/skills.ts) 的 binding 同时服务触发、转换和查询。能力提供者只读取权威状态；定义、函数与局内状态分开。CardBook 构造时装配其目录的装备能力提供者；同一局使用一套 CardBook/SkillBook 装配。重复能力实例 ID 会报作者错误。

## 安装与替换

`equipment(id, label, slot | { weapon: range }, ...parts)` 生成普通牌定义，部件与 `skill(...)` 相同；内核对象形 `equipmentCard({ id, label, slot, range?, skill? })` 用于自定义能力 ID 或名号。装备自动以自己为目标，不要求玩家再次点击自己；被禁止的目标不能通过过滤成零目标来支付掉装备。

`skill` 是静态 SkillDefinition，回调需要当前目录与用牌服务时调用 `rulesOf(ctx)`；方天等能力共用 `extraTargets` 查询。防御结果和青龙/斧/戟/弓的后续实现见 [22](22-weapons-defense.md)。

`equip(ctx, book, { card, owner, from })` 要求明确原区域。它将同槽旧装备移至弃牌区，新装备移入持有者装备区，在一次提交中完成。标准槽位是 weapon、armor、offensive-horse、defensive-horse；扩展可直接命名新槽位。

`equipment.equipped` 与这次移动同次提交，先于移牌后效。后效可以立即取走新装备，事实依然准确记录此前已经发生的安装，当前投影则按实时位置显示。新装备在用牌支付后已被取走时，安装不可用，不会顺带弃掉旧装备。默认处理区只善后实际余牌。

`moveCards` 可携带 `{ kind, data }` 声明，把领域事实与实际移动放在同一次提交中；cardsMoved 窗口始终在提交后开放。没有为装备建立另一个提交器。直接移牌不隐式执行标准替换；扩展需要安装语义时应调用 equip，或明确编写自己的安装操作。

当前持久装备绑定仅支持一个同名实体。零/多材料、改名后的虚拟装备尚无安装协议；拒绝这类使用，不假称它已成为实体牌自身的定义。普通转换牌仍支持零/多材料。

## 小而可组合的纯查询

[defineQuery / modify](../src/rules/skills/query.ts) 定义带类型的查询与贡献函数。modify 的内容回调使用 `(ctx, { input, self })`，共享函数可标注 `ModifyInput<T>`；底层 `SkillModifier.contribution(ctx, input, self)` 继续支持自定义来源。`undefined` 表示不贡献，null 可以有查询自己定义的意义。查询对象标识类型身份，不依赖全局字符串注册，也不开一轮触发窗口。

CardBook 的基础策略可通过 createBooks(policy) 或构造参数按需提供。distance、handLimit、attackRange、三类 prohibit、usage 与 responseTimes 逐项取用（未提供的项使用默认策略），按普通函数调用，不绑定接收者、不冻结原对象。每次查询继续读取当前 World 并组合技能修正，不缓存结果，也不以基础策略替代完整用牌或响应验证。

```ts
modify(cardQueries.distanceCorrection, (_ctx, { input: request, self }) =>
  request.from === self.owner ? -1 : undefined,
);
```

贡献函数可以使用普通闭包、分支和算法；在 Context 的纯查询守卫内同步运行，不能提交、问选择、开子流程或消耗随机。该守卫不证明任意 JavaScript 闭包没有外部副作用。失效或死亡来源不贡献查询。

[当前卡牌查询](../src/rules/cards/queries.ts) 的组合方式明确如下：

| 查询                                            | 组合方式                                                        |
| ----------------------------------------------- | --------------------------------------------------------------- |
| distanceCorrection                              | 活角色座次基础距离加各项修正，再交给模式 distance；非自身至少 1 |
| attackRange                                     | 模式提供基础范围，与各来源的固定范围取最大                      |
| handLimitCorrection                             | 体力加修正，至少 0，再交给模式 handLimit                        |
| usageLimit                                      | 默认上限与来源上限取最大；null 不限，再交给模式 usage           |
| prohibitUse / prohibitResponse / prohibitTarget | 模式与各来源取或                                                |
| responseCount                                   | 模式要求与各来源的固定响应数量取最大                            |

这不是完整的限制/覆盖/优先级策略框架。扩展可定义自己的查询；尚未接入的组合策略需在规则标准库明确实现，不能靠注册顺序假装解决。

`book.distance(ctx, from, to, semanticCard?)` 在用牌验证中应传本次语义牌。武器/坐骑被选作材料时，相关查询排除即将支付的该装备；无牌参数用于查询当前普通距离。连弩同样不能为以它自身作材料的第二张杀提供无限次数。正常宣告后的装备离场不重新抹掉已经合法宣告的目标。

## 离场事实与候选保留

TriggerSource 在开窗时取得本次 payload。装备提供者在 cardsMoved 窗口额外收集移动前的装备来源，当前查询与转换仍只使用当前装备。来源离场并不自动让其所有效果继续有效。

`on` 的 retain 是明确的资格后备，配合 when 限定本次事实。装备能力可用以下普通谓词，两处引用同一函数：

```ts
const lost = (ctx: Context, event: MoveResult, self: SkillHandle) =>
  equipmentLost(ctx.world, event, self);

on(Cards.moved, {
  id: 'lost',
  retain: lost,
  when: lost,
  effect(ctx, event, self) {
    // 这里可继续普通 async 结算；self.origin 指向具体离场装备。
  },
});
```

equipmentLost 检查移动前后区域、原持有者与当前失效状态。它不会让“手牌中的装备牌被弃置”发动已安装装备的离场能力。retain 不绕过 when 或候选执行前重查；存活与否由 retain 自行表达。支付与埋葬都经过相同 cardsMoved 事实，不必分别补丁式卸载。

离场后的普通 invoke/pay 已由 [43](43-retained-effects.md) 补齐。它们读取本次后效的作用域资格，不把装备恢复为当前拥有；查询、转换和主动动作仍按实时位置判断。

目前解决了装备移动前来源候选，不等于完成窗口多 occurrence、开窗后显式补入，或所有技能来源的历史遗留策略。

## 颜色与花色独立

SemanticCard 明确记录 color、suit、rank。单材料默认继承；多材料默认无花色、无点数，所有材料同色时保留颜色，混色为 none。CardFace 可明确覆盖 color。丈八只返回杀的名称，复用统一构造逻辑，不把两张不同红色花色伪造为红桃。

语义牌快照和公共牌面投影保存颜色，无花色的红色杀仍显示红色。实体牌身份、材料与处理区所有权没有因此合并。

## 标准内容与验证

诸葛连弩提供阶段内不限次数的杀；丈八提供两张手牌作为杀的使用/响应；赤兔、大宛、紫骍是进攻坐骑，绝影、的卢、爪黄飞电是防御坐骑。正负马槽独立。装备批练习牌堆为 192 张测试配比，不是完整标准牌数量或花色/点数分布。

上段为该装备批次的历史规模。当前默认标准＋EX 108 张、可选机制牌组 288 张，完整 32 种牌、两件剑与性别规则见 [23](23-swords-standard-deck.md)，当前验证以 [STATUS](STATUS.md) 为准。

[装备行为场景](../tests/scenarios/equipment.test.ts) 21 项；该批规则/主持侧共 208 项，加布局共 212 项。浏览器新增装备替换和丈八转换，该批两种配置合计 28 项；检查实际 CSP、控制台错误、可见选择和确认位置。原生与归档证据以 STATUS 为准。

参考本地 FreeKill [连弩](../../freekill/packages/standard_cards/pkg/skills/crossbow.lua)、[丈八](../../freekill/packages/standard_cards/pkg/skills/spear.lua)、[标准装备定义](../../freekill/packages/standard_cards/pkg/init.lua)、[虚拟牌颜色推导](../../freekill/ltk/core/card.lua)，及 noname [角色装备/手牌分区](../../noname/resources/app/noname/library/element/player.js)。只吸收规则与交互含义，未复制其全局对象或装备状态维护路径。
