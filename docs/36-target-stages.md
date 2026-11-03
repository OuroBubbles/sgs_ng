# 36 · 分层目标时点与动态目标

更新：2026-10-17。修正多目标用牌的时序，保留普通异步牌体和局部 resolver。没有增加目标 DSL 或第二套事件调度器。默认人类甲席、其余基础 AI；Android 仍等桌面完成后开展。

## 四层之后才生效

一次用牌的初始目标先按下列顺序完成四层。每层按宣告时冻结的模式行动序遍历所有有效目标，然后才进入下一层。

| 层     | 作者窗口         | 窗口 ID           | 回合外主体回退 |
| ------ | ---------------- | ----------------- | -------------- |
| 指定前 | targetSpecifying | target.specifying | 用牌来源       |
| 确认前 | targetConfirming | target.confirming | 当前目标       |
| 指定后 | targetSpecified  | target.specified  | 用牌来源       |
| 确认后 | targetConfirmed  | target.confirmed  | 当前目标       |

当前身份模式在活动回合内优先采用回合角色，回合外才使用表中主体回退；特殊规则可显式覆盖。目标遍历的冻结序列与每个窗口的入口序列分别处理，见 [41](41-action-order.md)。

负载统一为 `{ use: UsePlanView, effect: CardEffect }`。先记录本身份的 card.targeting 事实，再打开窗口。目标在各层之间死亡、被禁止或取消时，不再进入后续层。

后续 [61](61-target-pending-windows.md) 补齐同窗持续资格：本身份不再 targeting 或目标失效时，停止本窗剩余候选；效果启动另要求 ready 和当前 canResolve。流离后的新身份仍单独补齐四层，已提交费用不回滚。canResolve 不用于提前过滤声明阶段，公共完成窗口仍可观察取消结果。

四层结束后才进入 `UseRules.execute`，其后 `resolveTargets` 按该牌行动序逐个开放 effectStarting、实际 resolver 和 effectFinished。没有整牌函数的牌直接进入同一调度。五谷因此在全部初始目标确认后建立公开牌池，数量取当时 ready、存活且未被禁止的目标数；生效时仍读取本池实时余牌。

ready 仅表示目标时点已经完成；较晚目标的窗口仍可能令较早目标死亡或被禁止。整牌函数分配共享资源时读取实时有效性，实际效果也会再次检查，不能仅凭 ready 推断仍然可生效。

## 状态与身份

```text
pending → targeting → ready → resolving → resolved / aborted
              ↘ cancelled / skipped（也可在 ready 取消或跳过）
```

`targetStage` 表示最后已经进入的目标层，窗口内也是该层；它不宣称窗口已经执行完毕。四层结束的目标为 ready，实际 resolver 开始才封口为 resolving。取消、响应要求、响应禁令和防具忽略可以改写 pending、targeting、ready；实际执行、处理区到期、纯查询或其他 World 的 Context 都不能迟到改写。

每次新增或转移产生新的 EffectId，显式 repeatTarget 也如此。取消不退材料或次数。目标宣告/修改仍是有生存期的 World 数据；层游标和已访问集合属于当前协程。card.targeting 可以证明时点访问顺序，历史重建不承诺恢复挂起函数。

延时牌初次放置完成四层；之后判定生效沿用 UseId，生成新的 EffectId，直接由 pending 到 ready，targetStage 为 null，不重复指定或确认目标。

## 动态追加和转移

运行时每次取最早尚未完成的层，并按该牌行动序选择尚未进入该层的有效身份。新身份补齐此前的层，旧身份从不重放；每个身份每层至多访问一次。

例如在 C 的确认前追加较早的 B：B 先补指定前和确认前，已经确认过的 C 不倒退，剩余目标继续。到指定后和确认后，各层重新按座次选择未访问身份。

牌体、生效前窗口、resolver 或 effectFinished 都可以追加目标。生效前窗口追加者先补四层，再执行当前已经选中的效果，不能抢占它；resolver/后效追加者在本效果后效结束后补四层，再继续后续效果。作者自己决定是否允许无限追加，内核不静默截断可信规则函数。

`UseSnapshot.effects` 保留身份创建顺序，适合关联编辑与原因；card.effect 事实记录实际执行顺序。例如 B、C 的宣告中，在 B 生效后显式重复 B，声明身份为 1、2、3，实际完成顺序为 1、3、2。效果身份而非数组下标标识结算。

## 标准技能的位置

流离位于确认前；铁骑、雌雄双股剑、青釭剑及来源无双位于指定后；决斗目标的无双位于确认后。流离先封闭旧身份，之后只对当前新身份询问铁骑或雌雄剑。

青釭在每个目标的指定后使用 `effect.ignoreEquipment`。首个效果后来源死亡、失去剑或无双，不撤销其他初始目标已经记录的声明；此后新增身份仍重新检查当前技能来源。作者显式使用 `use.ignoreEquipment` 则表示整次用牌规则，按接口约定包含以后新增身份，不能与青釭的具体技能时点混同。

首个实际效果中止只结束本 EffectId，其余已确认目标继续。终局或后席目标死亡使后续实际效果跳过，不撤销已完成的四层，也不省略正常处理区善后。Room 的立即中止或故障诊断边界保持原契约。

## 验证与边界

[27 个目标分层场景](../tests/scenarios/target-stages.test.ts) 覆盖四层遍历/锚点、各层追加和转移、较早座次插入、牌体及生效中追加、重复身份执行顺序、取消 ready 身份、首伤后来源死亡/失去无双和武器、全目标铁骑先判定、五谷确认前/后死亡或禁令、延时生效、局部中止/终局与 World 重建。原有流离、雌雄剑和青釭反例同步采用新时序。

参考 [FreeKill onAim](../../freekill/ltk/server/events/usecard.lua) 的四阶段顺序及标准技能真实挂载点，参考源码未修改。后续有序分组、诸葛亮和私有余牌归还见 [37](37-arrangement-astrology.md)。这批闭合的是用牌目标分层，不代表通用窗口多 occurrence、任意模式排序、完整复杂技能或协程存档已完成。当前数量和客户端实际运行证据见 [STATUS](STATUS.md)。
