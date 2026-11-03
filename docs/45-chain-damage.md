# 45 · 连环传播与具名伤害属性

更新：2026-10-18。本批加入公开连环状态、独立传播伤害和两张作者演武牌，用真实卡牌检验伤害管线。通用运行内核没有加入连环阶段或技能模板；实现仍在规则库的普通函数中。

## 项目采用的传播规则

本地 FreeKill 在 [ChangeHp](../../freekill/ltk/server/events/hp.lua) 中解除连环并收集其他连环角色，在 DamageFinished 后以最终伤害值逐个传播；noname 在 [连环规则](../../noname/resources/app/noname/library/index.js) 的 damageAfter 中收集当时仍连环的角色。这两种快照时机并不等价，尤其是受伤后技能会改变连环状态时。

本项目明确选择以下规则，不混用两种目标收集时机：

1. 实际提交正数、可传导伤害时，受伤角色若处于连环，在同一次提交中扣减体力并解除连环。防止、归零、死亡目标和终局均不产生新的解链或传播。
2. 只有直接伤害建立传播计划。提交时按本局模式的行动序收集其他存活且连环的角色，冻结角色身份与顺序；来源本人也可能在其中。
3. 先完成起点的状态变更窗口、濒死/救援、伤害后效及 damageSettled，再逐个结算计划。每个目标执行前重查存活和连环，新增连环角色不补入旧计划；终局停止后续传播。
4. 每次传播有独立 DamageDraft，输入数量使用起点的最终 `amount`。首名角色限伤会改变传播基数，后续某名角色的加减伤或防止只影响自己。
5. 传播伤害可以解除当前目标的连环，但不再建立第二份传播计划。嵌套的另一笔直接伤害可以建立自己的计划；外层随后重查已解除的角色，因此不会自动重复命中。

计划在实际提交时冻结，不是开伤害窗口时冻结。模式顺序政策见 [41](41-action-order.md)。本地参考文件及 SHA-256 记录在 `.artifacts/validation/chain-reference.json`；常规运行、构建和测试不读取参考项目。

## 状态和提交边界

[chain.ts](../src/rules/combat/chain.ts) 提供四个普通入口：

| 入口                                     | 行为                                                    |
| ---------------------------------------- | ------------------------------------------------------- |
| `isChained(world, player)`               | 读取公开权威状态，不依赖 UI 或第二份角色列表            |
| `chainChange(ctx, player, value)`        | 构造可组合 Change；自身不提交，也不开窗口               |
| `setChained(ctx, player, value, reason)` | 直接返回 ChainResult；实际变化才提交并开放 chainChanged |
| `chainChanged`                           | 只读的 player/before/after/reason 变更窗口              |

`setChained` 区分 changed、unchanged 和 unavailable。死亡角色或终局不再设置，未知角色/非法值报作者错误。纯查询和关闭的 Context 不能改变状态。

伤害自动解链的事实就在 `damage.dealt` 中，和体力变化原子提交，不另写一条重复的状态提交。结果中的 `unchained` 记录此次确实发生过解链；随后开放 chainChanged，再进入濒死。变更后技能可以重新连环或改变体力，但不能改写已经提交的事实。

使用低层 chainChange 组合自己的费用/宣告时，后效窗口由调用者明确调度，和其他低层 Change 的契约相同。它不是监听所有状态写入的隐藏事件总线。

## 来源、数量与结果各自明确

[damage.ts](../src/rules/combat/damage.ts) 为每笔伤害提供稳定的 `id`。传播输入携带：

```ts
origin: { kind: 'chain', damage: root.id }
```

它指向传播起点，关联牌仍是原来的不可变 EffectRef，不伪造新的目标效果或新的用牌。`input.to` 是本次实际受伤角色；`input.card.target` 仍是原牌效果的目标，两者在传播时可以不同。

`DamageResult.chainPlan` 是计划，不保证列出的角色全部受伤；实际结果在各笔伤害事实中。返回起点结果前，会等待当前允许执行的全部传播子流程完成。结果不嵌入一棵重复的子结果树。

`sourceSnapshot` 继续记录来源阶段结束时的输入与数量，目标侧仍可防止、限伤或再次增伤。本项目传播读最终 amount，不读 sourceSnapshot.amount，也不把 hpLoss 当作传播基数。后续已接入护盾，完全吸收仍以 amount 传播，见 [46](46-shield-transfer.md)。

`isDirectDamage(input)` 区分直接伤害与传播。裸衣、麒麟弓、寒冰剑现在明确只处理直接伤害；传播仍保留原牌材料，因此曹操可以通过奸雄取得尚在处理区的材料，后续善后不会再次弃置。青釭剑的忽略防具仍只属于原目标效果，不传给连环角色。

已经宣告的伤害保留来源身份，即使来源死亡；这沿用本项目已有契约，不照搬 FreeKill 将死亡来源改为 nil 的处理。来源技能是否仍有效继续由技能目录判断。

## 扩展属性与普通攻击函数

卡牌和伤害共用开放的具名 Nature 字符串。定义中的空属性在装配时拒绝，转换产生的空牌面在支付前拒绝，不需要为每个新属性修改枚举。

默认只有 fire/thunder 传导。其他属性是否传导由本笔伤害明确指定；普通代码也可使某次火焰伤害不传导：

```ts
await damage(ctx, {
  from: self.owner,
  to: target,
  amount: 1,
  nature: 'my-pack:ice',
  conducts: true,
});
```

conducts 决定本次伤害是否解除连环及产生传播，不把所有非 normal 属性自动视作连环伤害。

[resolveAttack](../src/rules/combat/attack.ts) 可接收一个普通伤害函数。作者复用完整的闪响应、贯石斧突破及 AttackResult 管线，只替换命中后的伤害：

```ts
await resolveAttack(ctx, effect, book, 'standard:jink', (at, hit) =>
  damage(at, {
    from: hit.actor,
    to: hit.target,
    amount: 1,
    nature: hit.card.nature,
    card: hit,
    conducts: true,
  }),
);
```

默认行为不变；自定义函数同样直接返回领域值，局部中止默认沿调用链传播。这是函数组合入口，不是属性策略配置表。

## 可运行演武与验证

[作者演武](../src/content/workshop/index.ts) 新增缚阵、引焰和“连环演练（48 张）”。缚阵对一至两人分别切换连环；引焰对其他角色造成火焰伤害。它们是自制示例，不冒充完整军争牌包；原 44 张演武、40 张遗玉牌组保持不变。

本批当时标准/演武内容版本为 `0.1.5`，启用后合计 36 种牌、26 名武将。当前已更新为 `0.1.6`，增量见 [46](46-shield-transfer.md)；演武继续精确依赖标准版本，默认标准＋EX 仍为 32 种牌、25 名将、108 张实体。

自然复现：启用作者演武，选择连环演练、关羽、两人、AI 关羽、种子 4。甲席起手有缚阵 chain-card-7 和引焰 chain-card-19；先连接双方，再对乙席引焰，双方各受到一次火焰伤害并解链。桌面/触控验证标记、暂停恢复、固定甲席、实际费用与日志；Windows 驱动覆盖同一输入。截图为 `.artifacts/ui/chain-linked-*.png`、`chain-damage-*.png` 和 `native-chain-*.png`。

AI 观察增加公开连环状态；基础策略能连接敌方、解除己方连环，并估计引焰的公开传播目标，避免明显的自身致死。这没有引入隐藏身份/手牌读取或搜索器。

[40 项规则场景](../tests/scenarios/chains.test.ts) 覆盖状态提交、防止/零伤害、计划快照、模式顺序、来源死亡、濒死回复、终局、嵌套传播、独立草案、实际火杀转换与标准技能/装备联动、材料取得、开放属性和攻击函数。两局四人连环演练由基础 AI 经正式选择至胜负，检查真实传播、48 张实体守恒、处理区清理与事实重建。

最新全量结果见 [STATUS](STATUS.md)。后续护盾与伤害转移已接入 [46](46-shield-transfer.md)。复活、完整军争内容、任意复杂技能验收和完整离线版仍待继续。Android、完整智能托管与联机继续后置；事实重建不恢复正在执行的伤害栈。
