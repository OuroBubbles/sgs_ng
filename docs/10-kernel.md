# 10 · 首批规则内核实施

日期：2026-10-16。状态：首批机制可运行；后续技能、联合选择与费用见 [12 · 第二批规则机制](12-skills-selection-costs.md)。[正式客户端](16-local-client.md) 已接入执行者，完整标准内容与双端验收仍未完成。

## 实际模块

| 模块                                               | 已实现的责任                                              |
| -------------------------------------------------- | --------------------------------------------------------- |
| [World](../src/core/state/world.ts)                | 每局状态所有权、深冻结读视图、批次准备、实体牌唯一位置    |
| [Room / Context](../src/core/runtime/room.ts)      | 串行根流程、显式父子上下文、未等待子操作守卫、故障冻结    |
| [Scope](../src/core/runtime/scope.ts)              | 有身份的作用域、层级路径、同步幂等资源释放、规则中止      |
| [Window](../src/core/runtime/window.ts)            | 类型化时点与具名顺序组；候选执行由 Room 负责              |
| [DecisionHub](../src/core/decisions/hub.ts)        | 活跃选择、预览、会话 token、最终验证、一次接纳与关闭      |
| [Journal](../src/core/history/journal.ts)          | 单调序号、原因链、当前/祖先作用域、提交事实               |
| [rebuildWorld](../src/core/history/rebuild.ts)     | 从完整有序提交事实重建 World，不执行触发或内容代码        |
| [moveCards](../src/rules/cards/move.ts)            | 批量移动后才开放后效，提供移动前后快照                    |
| [withProcessing](../src/rules/cards/processing.ts) | 独立处理区身份、零/多材料、余牌清理与自定义中止策略       |
| [damage](../src/rules/combat/damage.ts)            | 来源修改、来源快照、目标修改、防止/零伤害、提交与后效骨架 |
| [sdk](../src/sdk/index.ts)                         | 精选实际类型和操作导出，不复制实现                        |

## 执行和错误

`room.run` 是主持侧入口，`ctx.flow` 创建拥有独立作用域的子结算。函数可以同步返回，也可以使用任意普通 `async`、闭包、分支和循环。运行时不改写函数体。

一个上下文只能等待一个子操作；其子上下文可以继续嵌套。等待子操作时调用父上下文写操作会报错。父函数退出时还持有未结束子操作，也会冻结本局。该守卫与 no-floating-promises 互补，不承诺识别所有用户自己创建的 Promise 或任意外部副作用。

运行层只返回 `resolved(value)` / `aborted(reason)`。防止伤害、零伤害等是领域结果，位于已正常完成的 value 中，不是运行异常。子 scope 的 `abort` 允许父流程继续执行明确善后；`room.abort` 立即终止整局并关闭等待。正常终局使用 `room.finish`：停止现有和未来输入，等待当前根流程善后后再关闭；详见 [15 · 生命与身份](15-life-role-match.md)。结束后不能重新进入该 Room。

内容异常冻结本局，保留已提交事实，只做安全资源释放。清理按后进先出逐项尝试；清理错误不能覆盖已经记录的原始内容错误。不会回滚整条技能，也不会在故障后擅自发动弃牌等规则后效。

作者可用 `ctx.unwrap(await operation(...))` 取出已正常完成的业务值，并将子流程中止显式传递至当前作用域。它不把 `declined` / `unavailable` 等业务结果当作中止，不捕获普通异常，不替代需要明确恢复的 `FlowResult` 检查。实际契约与响应审计见 [40](40-flow-results-responses.md)。

## Window 的当前语义

开窗时快照具体效果实例；新注册效果默认从下一次窗口开始。候选按具名组、行动顺序锚点和座次处理。同玩家同组的自动项按稳定 ID 先执行，需要玩家选择顺序的多个效果通过 Decision 选先后。每次轮到和顺序选择返回后重查资格，移除的效果不会继续发动。每个独立 occurrence 只处理一次，有限次数候选可以生成多个 occurrence。

当前已有 SkillBook 提供实例/来源/失效检查的候选来源。底层 Trigger 的 eligible 仍是调用者提供的纯查询，不能当成装备遗留等全部技能规则。有限次数生成与实时资格已接入 [38](38-window-occurrences.md)，模式行动序见 [41](41-action-order.md)。[51](51-window-admission.md) 新增 ctx.windowOf(type) 与 ctx.include(ref, source, select?)：只向当前或未来组/席位显式加入新身份，不重放已处理候选；窗口的组/座次和旧候选次数保持固定。SkillBook.include 可按新授予实例筛选，默认仍不自动补入。

资格、决策验证和 `ctx.query` 开启写入守卫；它们不能提交状态、开子流程、问选择、抽随机数或修改伤害草案。这个开发检查不证明任意 JavaScript 闭包没有副作用。

## Decision 与提交

`DecisionSpec` 只描述展示数据；执行侧 `Decision<T>` 在此基础上附加 available/validate 闭包。`DecisionRequest` 是带 ID、token、revision 的冻结描述，不携带校验函数。主持侧从 `room.decisions.pending` 取得请求，再调用 preview/submit/cancel；[LocalSession](../src/app/offline/session.ts) 已将此接口接入正式 UI。

预览不支付费用。提交匹配仍开放的 ID/token 后重新验证并复制归一化值，关闭请求再恢复结算。错误回复保持开放以便修正；重复/旧请求被拒绝。草案改变可显式 invalidate token，不把 World revision 当成全部选择版本。无完成路径返回 unavailable；scope 关闭会唤醒等待者。

当前还提供 JointSelection 的牌/目标候选、部分选择、可完成性和最终验证模型，详见第二批实施；排序、分组、分配等专用模型仍待实现。

提交只接受普通数据和具名 Change，不能 await 或执行内容回调。准备完整下一状态、复制/校验事实成功后，才同步替换权威状态。批内重复牌、起点错误、非法体力或不完整位置均拒绝整批。旧视图和旧事实保持不变。暂用完整状态副本，当前规模优先可读性，不预建事务/索引框架。

## 处理区与伤害

窗口现在可接受纯 `active` 条件，false 收束整个窗口，不回滚已执行效果。伤害用它停止转移/防止后的旧候选；护盾、转移和费用意图仍属于规则库，见 [46](46-shield-transfer.md)。

`withProcessing` 的每次调用创建独立 zone/scope。显式移入该 zone 表示把牌归入本次处理；结束时读取实时余牌，不无条件弃置最初材料。默认可以指定余牌区域，也可传普通清理函数区分正常/中止去向。body 中止和正常终局仍执行领域善后；代码故障和立即中止整局保留现场。清理必须处置完余牌，不能静默留下悬挂区域。

伤害的来源快照和目标草案分开。来源加伤后保存不可变快照，再打开 `damageReplacing`，之后进入目标侧限伤、增减或防止，直到真正提交才封口。替代窗口的资格与寒冰剑见 [23](23-swords-standard-deck.md)。防止、零伤害与实际伤害各有独立结果，只有实际伤害开放 dealt/received。嵌套反击等子流程全部结束后，外层调用才返回；来源死亡不会被通用运行时直接短路。

后续已实现濒死救援先于伤害后效、死亡与埋葬调度，以及独立的失去体力，见 [15 · 生命与身份](15-life-role-match.md)。连环传播、开放属性与普通攻击伤害函数见 [45](45-chain-damage.md)；护盾和待决伤害转移已接入 [46](46-shield-transfer.md)，来源阶段只执行一次，接收方重新结算防御。

## 验证与运行

```sh
pnpm test:core
pnpm test:core --reporter=json --outputFile=.artifacts/validation/scenarios.json
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm format:check
```

首批新增 41 项规则场景、第二批 34 项、第三批 50 项、生命/身份批 27 项、正式客户端主持侧 8 项、锦囊/反制批 27 项、装备/查询批 21 项、判定/延时牌批 32 项、响应/防具批 20 项、准备/借刀批 24 项、武器/防御结果批 24 项、两件剑/标准牌组批 26 项、额外回合批 16 项、基础 AI 批 12 项、武将/主动批 14 项；弃置批 14 项、武将扩展 8 项；魏将与语义边界 24 项；改判/私有池与谋士 27 项；曹操/张辽与阶段替代 38 项，见 [31](31-commanders-phase-replacement.md)；交牌/供牌/救援与刘备/华佗 35 项，见 [32](32-benevolence-supply-rescue.md)；回复草案/活动查询与吴将 35 项，见 [33](33-wu-recovery-history.md)；目标宣告/响应要求与谋将 36 项，见 [34](34-target-declarations-tacticians.md)；本批响应限制/具名选择与三将 38 项，见 [35](35-response-blocks-intrigue.md)；新增目标分层 27 项，见 [36](36-target-stages.md)；本批新增排序与诸葛亮 34 项，见 [37](37-arrangement-astrology.md)；本批新增窗口次数与组合 36 项，见 [38](38-window-occurrences.md)；窗口次数批验收时为 728 项规则/主持侧场景，加 7 项多席位布局，合计 735 项；最新验证以 [STATUS](STATUS.md) 为准。原有 8 项 P0 演示/选择测试已移除。首批场景位于 [kernel](../tests/scenarios/kernel.test.ts)、[damage](../tests/scenarios/damage.test.ts)、[processing](../tests/scenarios/processing.test.ts)，常规测试不依赖参考项目或 UI，牌表可选参考审计见 [23](23-swords-standard-deck.md)。

独立规则报告保存在 `.artifacts/validation/scenarios.json`，随当前测试重新生成。平台与客户端证据单独记录在 STATUS。

覆盖多 Room、嵌套/并发误用、作用域中止、清理故障、旧上下文、重复/过期回复、最终验证、排序重复/遗漏、候选失效/新技能、座次/玩家顺序、原子交换、深冻结、来源快照、嵌套反击、部分材料被取得与状态重建。

状态重建只恢复提交数据；它不能恢复技能栈、监听闭包、挂起选择、随机源当前位置或继续原来的对局，也不是完整录像播放器。

模式行动序现在通过纯 `actionAnchor` 函数注入，`ctx.actionOrder(subject?)` 提供共享读取；窗口主体与显式起点覆盖分开。目标序列成为用牌宣告数据，详见 [41](41-action-order.md)。

TriggerSource 的候选绑定到本次挂接；同对象重新挂接不复活原窗口，旧卸载函数不删除新登记。`Room.onClose` 提供同步执行侧资源清理；SkillBook 借此在整局结束/中止/故障时自动释放挂接记录。内部 Provider 的登记、支付和运行期 Context 边界见 [44](44-provider-lifecycle.md)。
