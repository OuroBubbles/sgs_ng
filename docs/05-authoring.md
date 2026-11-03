# 05 · 内容开发入口

本文使用当前 [SDK](../src/sdk/index.ts)。系统能力与未验收边界以 [STATUS](STATUS.md) 为准；流程、时点和故障的完整契约见 [04](04-resolution.md)。

## 一将一文件

标准武将位于 [src/content/standard/generals/](../src/content/standard/generals/)，每个文件导出该武将的技能并 `export default general(...)`。[generals/index.ts](../src/content/standard/generals/index.ts) 用 `import.meta.glob` 收集同目录全部默认导出，新增武将只需新建文件，不再改任何登记列表。`general(id, name, kingdom, hp, skills, { gender? })` 按武将牌面顺序书写（与 FreeKill 的 `General:new(ext, name, kingdom, hp)` 同序），直接接收技能对象；createContent 从武将的 `abilities` 自动登记技能，同一技能对象被多处引用时只登记一次。`ContentDefinition.skills` 仍可列出不属于任何武将的技能（例如机制演武）。

```ts
import { draw, general, skill, on, useDeclared, cardDef } from '../../../sdk';

export const study = skill({
  id: 'study',
  name: '研习',
  description: '当你使用锦囊牌时，你可以摸一张牌。',
  triggers: [
    on(useDeclared, {
      who: (use) => use.actor, // 只在事件主体是技能拥有者时触发
      when: (ctx, use) => cardDef(ctx, use.card.name).type === 'trick',
      ask: '是否发动【研习】摸一张牌？', // 询问 + 宣告由引擎完成
      effect: (ctx, _use, self) => draw(ctx, { player: self.owner, count: 1, reason: self.skill }),
    }),
  ],
});

export default general('scholar', '学士', '群', 3, [study]);
```

技能回调需要本局牌目录时调用 `rulesOf(ctx)`（或 `cardDef` / `cardLabel` / `face` 等作者 helper），不再有接收 CardBook 的技能工厂；装备能力同样只写静态 `skill`。

## 触发技：唯一的 on

`on(Event.timing, spec)` 是技能和独立效果共用的唯一触发入口（原 `trigger` / 技能 `on` / `effectOn` 已合并）。所有回调都是位置参数 `(ctx, event, self, ...)`：

- `who(event)`：事件主体，不等于拥有者时不触发。
- `when(ctx, event, self, at)`：纯查询；`times(ctx, event, self)`：本窗口有限次数快照，每次独立重查。
- 非锁定技默认 `order: 'choose'`；`locked: true` 表示锁定技，不询问、不宣告、自动排序。
- `ask`：询问是否发动并宣告（skill.invoke）；可为字符串或 `(ctx, event, self, at) => string`，多次触发用 `nth(at)` 追加「第 i/n 次」。
- `cost`：先由玩家完成选择（返回 null/false 视为不发动），再宣告；`declare` 返回随宣告同次提交的附加数据、状态变更或代价。
- `keep`：宣告时的合法条件，与「未终局」一起由引擎检查。
- `retain(ctx, event, self)`：来源不再可用（失去、失效或拥有者阵亡）时仍可处理本次事件；资格为 `(self.active(ctx) ∨ retain) ∧ who ∧ when`。
- `effect(ctx, event, self, value, at)`：宣告即生效，之后失去技能或条件改变不撤销；只有终局会截断 effect。效果内若文本要求再查（如奸雄要求材料仍在处理区），在 effect 里普通地判断。

同一声明放进独立效果的 `create(self).triggers` 时，默认自动排序，不支持 `ask` / `cost` / `retain`（效果不询问、不宣告）；资格为「效果实例仍存在」加 who/when，self 是该效果实例的只读视图（owner 为效果记录的 owner，skill 为效果类型）。spec 在 on 调用时读取固定，之后改写原对象不影响对局；回调按普通函数调用，不保留类实例的 `this`。

## 事件：时点、草案与历史同一身份

规则时点由 `defineEvent` 声明，ID 统一为 `事件.时点`（驼峰转 kebab）：

```ts
import { defineEvent, timing } from '../../../sdk';

export const Provision = defineEvent('provision', {
  finished: timing<ProvisionResult>(), // ID: provision.finished
});
// 开窗：await ctx.window(Provision.finished, result, { subject: result.target });
// 订阅：on(Provision.finished, { who: (r) => r.target, effect: ... })
```

`timing<T, R = T>(...groups)` 的 T 是挂钩载荷（可变草案或结果），R 是同名历史事实的记录类型。提交历史时直接传事件：`ctx.commit(Damage.dealt, changes, detail)`，detail 按 R 检查；读取时 `ctx.history.facts(Damage.dealt)` 返回 `Fact<DamageResult>[]`，遍历混合事实用 `isFact(fact, Turn.started)` 收窄。不再手写 `Fact<unknown>` 与字符串 kind 比较。所有事实（包括只入历史、没有挂钩的事实，如 `Cards.revealed`、`CardEvent.used`）都由 defineEvent 声明；`commit` / `facts` / 移牌声明的 `kind` 只接受事件时点，没有字符串重载。窗口候选在开窗时一次收集，没有中途入窗（include / listen 已删除）。随移牌写入的事实用 `declared<D>()` 声明，记录为 `{ moves, before, declaration: D }`；只入历史的事实也写出 R（如 `timing<unknown, PhaseSnapshot>()`），离线投影的日志按事件时点登记类型化的叙述函数（`on(Damage.dealt, (d) => …)`），不再对历史载荷做 record/text 防御式解析。

## 主动技：action

`action({ id, limit, cards, targets, pay, selection, declare, effect })` 生成 `active` 能力：`limit` 为每阶段次数（键为技能 ID 末段），`cards: { count, areas, filter }` 与 `targets: { count, filter }` 生成联合选择，`pay: 'discard'` 弃置所选牌作为费用；复杂配对等约束可用 `selection` 自写 JointSelection 模型。effect 取得 `{ self, phase, cards, targets }`。

## 规则动词自带存活与终局处理

`damage`、`draw`、`recover`、`judge`、`chooseOwnedCard` 以及作者动词 `obtain` / `takeCard` / `give` / `askDiscard` / `select` / `obtainJudgment` 都会在目标阵亡或已终局时 no-op 或返回 unavailable，技能无需在每个 await 后手写 `isGameOver` / `alive` 检查。牌的获得统一写成移牌事实的 `declaration` 形式（如 `card.taken` 的 `{ moves, before, declaration }`）。

## AI 提示与技能同处

技能可声明 `ai: { value?: (view) => number, targets?: 'ally' | 'enemy' }`。基础 AI 只通过 `observation.skills(id)` 读取提示：`value` 给出主动技能的发动意愿（不大于 0 不发动），`targets: 'ally'` 让选目标偏向友方。view 只含观察者视角的 `self / players / hand / cards / hostility / cost`，提示必须是纯函数。基础 AI 本身不再按技能 ID 分支。

## 组合与运行

用 [createContent](../src/content/catalog.ts) 将一份或多份 `ContentDefinition` 组合为本局目录，例如 `createContent(standard, practice)`。声明按引用使用，不复制、不冻结、不绑定，定义对象应视为常量；每局 createBooks 创建独立 CardBook / SkillBook，技能经 `rulesOf(ctx)` 读到的就是该局目录。持续生效的独立效果放在 `ContentDefinition.effects`（裸衣的 `luoyiAftereffect` 在[标准入口](../src/content/standard/index.ts)声明）。

用 [createOfflineMatch](../src/app/offline/practice.ts) 运行普通场景时提供 `{ seed, preset, lineup, content }`；阵容长度决定人数，无固定阵容的练习局使用 `{ count, seed, preset }`。content 可传普通 ContentDefinition 或已有目录；直接建局时 deck 可写目录牌组 ID 或实体牌数组。

[研习示例](../examples/content/study.ts) 与 [渡口](../examples/content/harbor/index.ts) 是可直接 import 的完整源码，[真实场景](../tests/scenarios/content-examples.test.ts) 验证取消、宣告与来源失效。未来扩展只保留[内容组合接口](39-source-packages.md)。

底层声明的通用约定仍然有效：技能可直接写普通对象并 `satisfies SkillDefinition`；active / viewAs 的 label 可省略；on 可省略局部 id（默认取时点 ID）；局部 ID 冲突在登记时报错，批量登记失败整批不生效。主动技能底层回调为 `(ctx, { self, phase, book })` 与 `(ctx, { self, phase, book, choice, selection })`；转换回调 `(ctx, { self, book, purpose })`；查询修正 `modify(query, (ctx, { input, self }) => value)`，见 [装备与查询](18-equipment-queries.md#小而可组合的纯查询)；卡牌 use 回调见 [语义牌与用牌](13-card-use.md#一次用牌)。

## ctx、self 与普通函数

`on` 的回调接受位置参数 `(ctx, event, self, …)`，独立函数直接按 `(ctx: Context, event: DamageResult, self: SkillHandle)` 标注即可。`self.owner` 是技能拥有者，`self.id` 是本次技能实例，`self.skill` 是定义 ID；`ctx` 携带本次结算的状态读取、原因、历史和作用域。没有 `ctx.owner`、`ctx.draw` 或隐藏的全局“当前事件”。

规则操作直接调用 `await draw(ctx, input)`、`await damage(ctx, input)` 等普通函数。分支、循环和局部变量由 TypeScript 表达；父流程等待所有嵌套后效结束才恢复。不要并行写同一局；直接 await 或返回子操作的 Promise。

临时处理区使用 `withProcessing(ctx, materials, body, cleanup?)`：直接编写主体，默认只弃置结尾仍在该区的余牌；特殊目的区域或善后函数放在最后。body 可返回领域值，自定义善后可根据 resolved/aborted 处理余牌，不要求把技能改写成生命周期配置。

只有一步时可直接写 `effect: (ctx) => draw(ctx, input)`；技能、卡牌与领域后效的执行回调会等待返回的操作，忽略其结果。需要按 `paid/unavailable` 等结果分支时仍用普通 `await`；返回值本身不改变取消或中止语义。

`ctx.flow(...)` 返回领域值，中止默认向外传播。只有确实允许局部中止并继续的边界才使用 `ctx.attempt(...)`；故障和整局关闭不能因此恢复。无需给每个技能包一层 attempt，或逐层检查 aborted。

## 选哪种能力入口

| 需求                         | 作者层入口（优先）                                        | 底层入口（作者层不够时）                                                 | 可运行源码                                                |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| 在时点参与结算               | `on(Event.timing, { who, when, ask/cost, keep, effect })` | —（技能与独立效果共用）；`when` 为纯查询，`effect` 可等待                | [刚烈](../src/content/standard/generals/xiahoudun.ts)     |
| 出牌阶段主动发动             | `action({ limit, cards, targets, pay, effect })`          | `active` 中的 `available` / `selection` / `run`                          | [结姻](../src/content/standard/generals/sunshangxiang.ts) |
| 将材料解释为另一张牌         | `convert(id, { as, match, areas })`                       | `viewAs`；用牌与响应规则继续由 CardBook 处理                             | [武圣](../src/content/standard/generals/guanyu.ts)        |
| 修正牌面、距离或限制         | —                                                         | `modify` + 具名 `cardQueries`；自定义组合可用 `defineQuery`              | [谦逊](../src/content/standard/generals/luxun.ts)         |
| 创建失去技能后仍可存在的效果 | —                                                         | `EffectDefinition` / `EffectBook`，实例数据存 World                      | [裸衣](../src/content/standard/generals/xuchu.ts)         |
| 定义新的规则时点             | —                                                         | `defineEvent(id, { x: timing<T>() })` + `ctx.window`，跨文件直接共享对象 | [渡口](../examples/content/harbor/index.ts)               |

一个技能可以混用两层，也可直接编排公开规则函数。作者层只是同一套 `on` / `active` / `viewAs` 声明的写法，不是第二套机制；新 helper 应来自真实重复的语义，而不是为隐藏一个循环建立通用框架。

## 选择、费用与继续条件

稳定 ID / 可读选项使用 `chooseOne`；材料与目标的联合选择使用 `JointSelection`；有序分组使用 `ArrangementSelection`。模型提供动态候选、前缀检查、最终验证和预览，UI 消费同一决策，不重写合法性。复杂约束用普通 `canComplete` 判断合法完成路径、`complete` 检查最终组合；需要额外前缀约束时再提供 `partial`，无需空函数占位。不能靠无界穷举或只检查最终组合。三个入口均读取选项的 id / label 后形成快照，支持原型 getter，不冻结原对象。

JointSelection 的 cards / targets 候选函数可直接返回稳定 ID 数组，需要自定义文字时返回 `{ id, label }`，两种条目可以混用；字符串的标签就是 ID。索引与预览使用同一次读取的字段值。预览仍输出完整候选，不改变回复形状。JointSelection 中不用的维度可整组省略：只选牌提供 cards / cardCount，只选目标提供 targets / targetCount；候选与数量必须一起声明。构造时统一补齐空维度，动态候选仍在预览和提交时重新读取；结果始终保留 cards / targets 两个数组，不让技能处理多种返回形状。

所有数量范围共用同一约束：min 为非负安全整数，max 为不小于 min 的安全整数或 `all`。联合选择、静态分组、牌的静态目标数量和转换的静态材料数量在对应声明规范化时检查；分组函数和转换函数返回的动态范围在每次查询时检查，错误指出对应牌或配方，不等到玩家提交后才暴露。

`selection.available()` 只查询空前缀能否继续，不生成候选投影，也不要求已选齐；复杂可完成性仍由声明中的普通函数决定。主动技能的候选、预览与最终验证共用这一入口。实际提交还会验证选中的具体牌与有序目标，支付继续独立重查次数及费用。

`invoke` 负责自愿发动的询问、来源资格和零费用宣告。需要自己组织支付或询问已宣告效果是否继续时，使用 `askInvoke(ctx, self, prompt, available?)`；它返回是否接受，资格由 available 表达，支付与后效继续使用普通代码。裸衣将独立效果与发动同次提交，克己将跳过标记与发动同次提交；洛神的继续询问沿用已宣告循环自己的继续条件。

技能支付只传 skill，付款人来自其 owner，如 `pay(ctx, { skill: self, reason: self.skill, limit })`；普通支付显式传 actor，两种来源互斥。reason 始终由调用者声明。零材料支付可省略 cards 和 to；声明材料时两者必须一起提供，弃置费用可用 `payDiscard` 固定目的区。支付入口重新检查角色、来源、次数与材料，返回 `paid/unavailable`。费用与次数提交后，移牌及支付后效完整结束才返回，取消后效不自动退款。不要按 UI 点击计次。

需要在费用确定时同步修改待决草案，可使用 `PaymentIntent`。它的 `available` 是纯查询，`committed` 必须同步，先于支付后效；异步宣告属于代码故障。普通技能通常无需直接使用此入口，实际例子见 [伤害转移](../src/content/workshop/defense.ts)。

“后续还需要什么条件”由技能文本决定。来源在发动前必须有效；已经宣告的效果不因为来源消失而统一回滚，也不应在每个 await 后机械添加 `self.active(...)`。确实要求目标仍存活、当前阶段未结束或仍持有技能时，用动态候选及 `available` 表达，并由实际操作最终校验。区分草案、按发动时固定的来源与已经提交的结果。

直接调用 `draw` / `recover` 即复用规则操作对受益者存活与终局的重查；技能只表达是否接受发动、支付是否成功、材料/目标选择和文本特有的继续条件。多目标后效仍逐个 await，每个目标在实际操作时独立校验。

## 状态、只读值与生存期

局内计数和标记用 `defineState` / `readState` / `setState`，不要放在共享定义或模块级可变变量中。`stateChange` 可与费用组成同一提交。`UsageLimit` 的 source 由规则选择：按技能定义计数可防止同阶段重新授予重置，按实例计数则区分每次获得。

阶段、回合等使用有身份的 `Lifetime`，嵌套阶段和额外回合各自独立。普通 Flow 不自动变成回合生存期。独立效果使用自己的到期条件，失去创建它的技能不代表效果一律消失；具体契约见 [独立效果](56-independent-effects.md)。

World、事实和接纳后的决策值在类型与运行时均只读；需要本地修改数组时先复制。领域草案通过其公开方法修改，封口后不能继续改写。`ctx.query` 与所有合法性查询不能写状态、取随机数或 await；违规异步规则查询立即冻结本局。

状态初值、状态写入和效果新增 / 更新先固定普通数据快照，再把这份快照交给 accepts；校验与保存不会各读一次原值。有 Context 的状态写入与效果操作在纯查询内复制，数据 getter 不能借复制写入规则状态。效果记录作为整份图复制，origin 与 data 的共享引用保持。

具名 Query 的开始值、贡献与合并函数、来源资格、retain、状态与独立效果的数据校验器、独立效果行为工厂及自定义触发绑定都必须同步。主动技能的 `available` / `selection`、用牌的 `UseRules.selection`、转换的候选/资格/数量/构牌函数，以及选择模型的候选与约束也遵循此约定；用牌目标和响应资格的最终重查仍是纯查询。

查询回调的同步性由类型保证；运行时只在 Room 的查询边界检查返回值，执行侧查询返回 Promise 时立即冻结本局；本地投影、预览或回复出错则由主持侧停止本局并显示错误。普通内容继续直接使用现有入口，无需自行包裹守卫；异步后效仍放在 effect / onEnd 中。作者函数内部的普通表达式仍由作者负责，类型检查不能省略。

## 扩展与验证的边界

普通文件可以导出函数、事件（defineEvent）和 Query，由相对 import 共享同一实例；资源使用静态 import 或调用者提供的 URL。见 [跨文件协作](39-source-packages.md#跨模块代码共享) 与 [资源](39-source-packages.md#资源与所有权)。不在挂起技能中途热换定义，也不引入签名或沙箱体系。

当前客户端支持已登记的选择形态。自定义 `ctx.ask` 类型能在规则层运行，不代表 UI 和基础 AI 已自动具备该交互；不支持的必选决策会中止基础 AI 对局。先复用现有选择模型，确有新交互需求时再补完整执行、投影和客户端路径。

改动后先运行 `pnpm typecheck`、`pnpm lint` 与对应领域场景；交付前运行 `pnpm check`，界面改动另跑 `pnpm test:ui`。检查领域结果、取消/失效与嵌套路径，不为每个实现细节追加测试。轨迹从 `ctx.history` 的事实和原因链读取，随机数使用 `ctx.randomInt`；不依赖真实时间、动画或 `Math.random` 决定规则。
