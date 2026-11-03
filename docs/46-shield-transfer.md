# 46 · 护盾与待决伤害转移

更新：2026-10-18。标准与作者演武内容版本为 `0.1.6`。本批继续扩充规则库，通用运行内核只增加窗口继续条件，没有增加技能脚本语言。

## 伤害量、扣血与护盾分别记录

[shield.ts](../src/rules/combat/shield.ts) 提供 `shieldOf`、`changeShield`、低层 `shieldChange` 和只读 `shieldChanged` 窗口。护盾是角色公开状态，初始为零；非负安全整数，不设全局上限。变体需要上限时在自己的规则中决定。`changeShield` 接受增减量，减少至零为止；返回实际量和 attemptedAmount，无变化不开窗，死亡或终局返回 unavailable。

[damage](../src/rules/combat/damage.ts) 提交前按最新护盾计算 `shieldLost = min(shield, amount)`，`hpLoss = amount - shieldLost`。伤害、护盾消耗、解链同次提交，先开放 shieldChanged，再 chainChanged，然后处理实际扣血引起的濒死与伤害后效。消耗护盾不再额外提交重复状态事实。

完全吸收仍是 dealt，amount 保持原伤害量，hpLoss 为零，照常开放伤害后效、解链和传播。遗计的逐次数量因此由 amount 决定，不能按 hpLoss 少触发。传播同样使用起点最终 amount，每名接收方独立消耗自己的护盾。loseHp/recover 不消耗或补回护盾。

输入 `bypassShield: true` 或防御阶段 `draft.ignoreShield(reason)` 可忽略本次护盾。原因进入结果；这个标记随本笔伤害转移，但不自动传给后续连环包。草案封口、纯查询或过期 Context 不能修改它。低层 shieldChange 只产生绝对值 Change，组合费用时后效由调用者显式安排。当前没有复活机制，不宣称死亡后护盾重置或继承规则已验收。

## 转移的是待决伤害

`draft.canTransfer(ctx, to)` 查询当前资格；`draft.transfer(ctx, to, reason)` 用于无额外费用的立即转移，返回 transferred/unavailable。必须在来源快照完成后、原伤害尚待决时，以本次伤害的活跃后代 Context 调用。相同角色、未知/死亡接收方、零伤害、防止、已转移和终局均不可转移。

转移声明后，原草案立即停止接受修改，原窗口不再执行其他候选。原伤害最终为 `kind: 'transferred'`，不扣原目标体力/护盾，不解除其连环，也不触发其 received。结果中的 transfer 保存接收方、原因与子伤害 ID；中止发生在派发前时子 ID 可以为 null。

接收方有新的伤害身份与独立防御草案：

```ts
origin: { kind: 'transfer', damage: parent.id }
```

公开 damage 输入中的 origin 只是来源数据，手写这个字段不会恢复私有续接或跳过来源阶段；待决转移必须使用草案接口。

它继承当前伤害量、来源快照、来源角色、属性、原牌关联及本次护盾豁免。只重开接收方 inflicting，不再次开放 causing/replacing，所以来源加伤不会重复。新目标仍可增减、防止、消耗护盾或再转移；不改写原 `input.to`，也不伪造原牌的 EffectRef.target。子结果完成、创作者的普通后续完成后，原伤害才收束。原目标的 beforeHp/afterHp 是原伤害封口时的当前值；嵌套流程造成的变化不归入原伤害的 hpLoss。

这和“改用牌目标”是不同阶段的行为：流离仍修改 UsePlan，代受处理已经过来源阶段的待决伤害。内核不限制接收方必须没出现过，允许作者用费用/次数等条件控制 B→C→B。

直接伤害转移到连环角色，可从实际受伤角色建立新传播计划；原目标仍连环时可能进入该计划。传播包再被转移时，origin 同时保留 `chain: root.id`，仍属于原计划，不能再次扩张。`isDirectDamage` 只认没有 origin 的伤害；`isChainDamage` 能识别转移过的传播。

## 费用提交先于费用后效

弃牌后才尝试转移会留下漏洞：接收方在弃牌后效中死亡时，原伤害可能错误地恢复。带费用的技能先创建短期意图：

```ts
const intent = draft.prepareTransfer(ctx, target, self.skill);
const paid = await payDiscard(ctx, book, {
  skill: self,
  cards: answer.value.cards,
  areas: ['hand'],
  reason: self.skill,
  intent,
  declaration: { label: self.name, ...intent.data },
});
if (paid.kind === 'paid') await intent.resolve(ctx);
```

[pay](../src/rules/costs/pay.ts) 的 PaymentIntent 是执行侧普通接口：纯 `available` 在提交前重查，失败不支付；`committed` 在费用事实/状态提交后同步运行，先于 cardsMoved/costPaid。它不接受 await，不开放规则窗口；抛错或返回 Promise 时运行时故障停止，已提交费用不回滚。它是可信规则代码的同步提交边界，不是任意回调事务或持久化命令。

转移意图在 committed 时冻结当前数量并写入 damage.transferring，原伤害此时已转移。之后接收方死亡、防止或整局结束，不恢复原目标；费用导致原角色死亡/失去技能，也不撤销已声明的转移。费用本身同批改变存活状态时，同样保留承诺。`resolve` 只能执行一次，必须等待支付后效后在原伤害的活跃后代内调用。创建而未支付的意图不会影响原草案；不能绕过 available 直接把 committed 当作独立发动接口。

意图和执行闭包不写入 World、PaymentReceipt 或事实；只有 intent.data 等稳定数据可以作为 declaration。事实重建仍不恢复悬停函数、草案或转移意图。

## 窗口收束与运行示例

`WindowOptions.active` 接受纯同步条件。窗口入场收集前、候选循环、顺序选择后和效果返回后检查；false 收束整个窗口，并记 window.stopped trace。只在这些边界采样，不订阅闭包变化或主动唤醒等待中的请求。默认窗口行为不变，不回滚已经执行的后效。伤害使用它停止防止/转移/目标死亡/终局后的旧候选，通用内核不认识这些伤害条件。

[作者演武](../src/content/workshop/index.ts) 新增凝障、守阵客/代受与“护盾与转移（48 张）”：8 凝障、8 缚阵、8 引焰、12 杀、6 闪、6 桃。定义见 [defense.ts](../src/content/workshop/defense.ts)，复用普通锦囊、联合选择、弃置权限、费用和伤害接口，无专用 UI。代受只接受直接伤害，不再次转移传播/转移包；这是自定义演示，不宣称完整天香或军争包已实现。

自然复现：启用作者演武，护盾与转移牌组、两人、AI 关羽、种子 4。本人关羽先凝障，再缚阵双方、引焰乙席，甲席体力不变、护盾 2→1，双方解链。本人改选守阵客，首回合结束出牌并弃牌，等待 AI 直接攻击，可弃一张手牌并选乙席代受，也可取消不支付。

SeatView 与受限 AI 观察公开 shield；Canvas/无障碍按钮显示护盾与连环，暂停仍保留公共标记。日志区分护盾吸收和转移，AI 使用合法性预览选择便宜费用与敌方目标，并在护盾不足时优先凝障；没有增加隐藏信息、搜索或高级托管。

## 证据与边界

- [22 项护盾场景](../tests/scenarios/shield.test.ts)：实际量、原子提交、防止/零伤害、临时加盾、传播、豁免、失去体力/回复、全吸收遗计与数值边界。
- [25 项转移场景](../tests/scenarios/damage-transfer.test.ts)：一次来源阶段、新防御、回转、费用后效/同批死亡、未支付、重复执行、纯查询/过期/外部 Context、传播与终局。
- [支付场景](../tests/scenarios/payment.test.ts) 新增 3 项，检查意图顺序、重复支付拒绝、同步/异步故障保留费用；[窗口场景](../tests/scenarios/window-guard.test.ts) 新增 4 项。
- [5 项内容场景](../tests/scenarios/defense-content.test.ts) 含自然起手、实际材料/取消/支付和种子 4/17 的四人基础 AI 整局，检查 48 张牌守恒、结算清理及事实重建。上述合计新增 59 项，不重复计算整局。
- 桌面/触控浏览器和 Windows 驱动均加入护盾吸收及代受接受/取消；最新全量结果与构建证据见 [STATUS](STATUS.md)。截图为 `.artifacts/ui/shield-*.png`、`damage-transfer-*.png` 和对应 native 前缀文件。

本地参考只读：FreeKill `ltk/server/events/hp.lua:55–96` 的盾与扣血、`packages/shzl/pkg/wind/skills/tianxiang.lua:42–58` 的先防止再弃牌；noname `resources/app/noname/library/element/content.js:10952–10961` 的伤害护甲吸收。参考 SHA-256 记录在 `.artifacts/validation/shield-transfer-reference.json`。本项目选择无全局护盾上限、转移不重开来源阶段，均为明确的规则库契约，不声称完全兼容参考项目。

复活、完整军争/风包、任意扩展策略和完整离线验收仍待继续；Android 在桌面完成后开展，完整智能托管和联机仍后置。
