# 内容作者指南

内容只从 [SDK](../src/sdk/index.ts) 导入：它按“定义 / 时点 / 查询 / 动词 / 选择模型”分组，列出写武将、技能与牌所需的全部名字（约 110 个值），没有第二套写法。测试与主持端直接引用各自的规则模块，不经过 SDK。流程、时点和故障的完整契约见 [ARCHITECTURE](ARCHITECTURE.md)，标准规则裁定见 [RULINGS](RULINGS.md)。

## 一将一文件，一技一文件

标准武将位于 [src/content/standard/generals/](../src/content/standard/generals/)，技能位于 [skills/](../src/content/standard/skills/)：武将文件只 import 自己的技能并 `export default general(...)`，技能文件 `export default skill(...)`，只属于这个技能的标记与小工具写在同一文件里。不需要任何登记表：主持端启动时扫描内容包（见下节）。立绘、技能与阵亡语音按原字节放在 [public/standard/](../public/standard/)，以稳定 URL `/standard/<file>` 提供，按文件名约定归属武将；[assets.json](../src/content/standard/assets.json) 只记录导入素材的来源与原字节。`general(id, name, kingdom, hp, skills, { gender? })` 按武将牌面顺序书写（与 FreeKill 的 `General:new(ext, name, kingdom, hp)` 同序），直接接收技能对象（别包的技能也直接 import，如演武客引用标准包的武圣）；同一技能对象被多处引用时只登记一次。不属于任何武将的技能（例如由拾慧授予的余响）同样放在 `skills/` 下。

```ts
// skills/study.ts
import { cardDef, draw, on, skill, Use } from '../../../sdk';

export default skill(
  '<包>:study',
  '研习',
  '当你使用锦囊牌时，你可以摸一张牌。',
  on(Use.declared, {
    who: (use) => use.actor, // 只在事件主体是技能拥有者时触发
    when: (ctx, use) => cardDef(ctx, use.card.name).type === 'trick',
    ask: '是否发动【研习】摸一张牌？', // 询问 + 宣告由引擎完成
    effect: (ctx, _use, self) => draw(ctx, { player: self.owner, count: 1, reason: self.skill }),
  }),
);

// generals/scholar.ts
import { general } from '../../../sdk';
import study from '../skills/study';

export default general('<包>:scholar', '学士', '群', 3, [study]);
```

`skill(id, name, description, ...parts)` 是唯一的技能写法：每个部件按形状归类——`on(...)` 为触发、`modify(...)` 为查询修正、`action(...)` 为主动技、`convert(...)` 或带 `make` 的对象为转换、`defineMark(...)` 为本技能使用的标记（带 `skill` 时即持续效果，见“持续效果”），带 `lord` / `ai` 的对象为选项。内核里的 `SkillDefinition` 是它的产物，不再作为第二种写法导出。

技能与牌的回调需要本局牌目录时调用 `rulesOf(ctx)`（或 `cardDef` / `cardLabel` / `face` 等作者 helper）；回调只收到 `ctx` 与具名输入，没有目录参数。

## 添加武将

1. 在包的 `skills/` 下为每个技能新建 `<名>.ts`（`export default skill('<包>:<名>', ...)`），在 `generals/` 下新建 `<名>.ts`（`export default general('<包>:<名>', ...)`）——ID 必须等于“包目录名:文件名”。
2. 素材可选，按约定放在 `public/<包>/`：`portraits/<名>.jpg|png|webp`、`audio/death/<名>.mp3`、`audio/skill/<技能名><n>.mp3`。
3. 重启主持端（`pnpm dev` 会自动重启）。不改其它文件、不重新构建网页；只有改界面时才需要 `pnpm build`。

## 添加牌：一牌一文件

标准牌位于 [src/content/standard/cards/](../src/content/standard/cards/)，每个文件 `export default` 一种牌：普通牌用 `card({...})`，装备用 `equipment(id, label, slot, description, ...parts)`（与 `skill(...)` 同序，部件即装备技能），延时锦囊用 `delayedCard({...})`。规则说明 `description` 与规则写在同一处，大厅和卡面详情直接显示；`kind` 只选无卡图时的卡面纹样（缺省按类别：基本 other、锦囊 trick、装备 equipment）。几种牌共用的小工具放在包根的普通模块（如 [card-kit.ts](../src/content/standard/card-kit.ts)），只有 `cards/` 下的文件会被当作牌。

```ts
// src/content/standard/cards/ex_nihilo.ts
import { card, draw } from '../../../sdk';

export default card({
  id: 'standard:ex_nihilo',
  type: 'trick',
  label: '无中生有',
  kind: 'draw',
  description: '出牌阶段对自己使用，摸两张牌。',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, { request, target }) => request.actor === target,
    resolve: (ctx, { effect }) =>
      draw(ctx, { player: effect.target, count: 2, reason: 'standard:ex_nihilo' }),
  },
});
```

1. 在包的 `cards/` 下新建 `<名>.ts`，ID 为 `<包>:<名>`；牌按文件名排列（牌的先后不影响结算）。
2. 素材可选：`cards/<名>.png`（卡图）、`icons/<名>.png` 或 `marks/<名>.png`（图标）、`audio/card/<male|female>/<名>.mp3`；装备缺省用 `icons/<栏位>.png` 与 `audio/card/common/<栏位>.mp3`（两种坐骑都记作 `horse`）。
3. 把实体牌加进牌组（[deck.ts](../src/content/standard/deck.ts)），重启主持端。

**有序目标元组**：需要“先选 A、再选与 A 相关的 B”的牌（借刀杀人），`target` 写成过滤器数组，第 i 个过滤器收到已选前缀 `chosen`；首位是效果目标（受目标禁令约束），结算时从 `effect.tuple` 取整组。玩家逐个点选，界面按过滤器个数自动分组；流离等转移只给新角色时沿用原元组的后续位置。

```ts
target: [
  (ctx, { request, target }) => target !== request.actor && equipmentInSlot(ctx, target, 'weapon').length > 0,
  (ctx, { request, target, chosen: [holder] }) => canSlash(ctx, holder!, target),
],
async resolve(ctx, { effect }) {
  const [holder, victim] = effect.tuple as [string, string];
  // ...
},
```

内容包是 `src/content/` 下含 `package.ts` 的目录（目录名以 `.disabled` 结尾则跳过），由 [load-content](../src/host/load-content.ts) 发现：`package.ts` 只描述包本身（牌组 `decks`、`practice`、`order` 与可选的展示覆盖），在其中列出 `generals` / `cards` / `skills` 会在启动时报错——它们各自是一个文件。练习牌组可用 `deckOf(prefix, [[牌名, 张数], ...])` 展开。顺序确定：标准包先行，其余按目录名；包内武将先按 `order`（标准包保留原包顺序，影响大厅与按种子抽将），其余按文件名追加；牌与技能按文件名。同 ID 的不同技能对象、ID 与文件名不符、默认导出形状不对（武将须为 `general`、技能须为 `skill`、牌须带 ID / 类别 / 牌名 / 说明）、`order` 指向不存在的文件、约定目录里找不到对应武将的立绘或阵亡语音、找不到对应牌的卡图，都会让主持端启动失败并指出文件。各包源码的 SHA-256 即 `contentHash`，随 hello 与 `/catalog` 发出。

## 触发技：唯一的 on

`on(Event.timing, spec)` 是唯一的触发入口，技能与持续效果（带技能的标记）都用它。所有回调都是位置参数 `(ctx, event, self, ...)`：

- `who(event)`：事件主体，不等于拥有者时不触发。
- `when(ctx, event, self, at)`：纯查询；`times(ctx, event, self)`：本窗口有限次数快照，每次独立重查。
- 非锁定技默认 `order: 'choose'`；`locked: true` 表示锁定技，不询问、不宣告、自动排序。
- `ask`：询问是否发动并宣告（skill.invoke）；可为字符串或 `(ctx, event, self, at) => string`，多次触发用 `nth(at)` 追加「第 i/n 次」。
- `cost`：先由玩家完成选择（返回 null/false 视为不发动），再宣告；`declare` 返回随宣告同次提交的附加数据、状态变更或代价。
- `keep`：宣告时的合法条件，与「未终局」一起由引擎检查。
- `retain(ctx, event, self)`：来源不再可用（失去、失效或拥有者阵亡）时仍可处理本次事件；资格为 `(self.active(ctx) ∨ retain) ∧ who ∧ when`。
- `effect(ctx, event, self, value, at)`：宣告即生效，之后失去技能或条件改变不撤销；只有终局会截断 effect。效果内若文本要求再查（如奸雄要求材料仍在处理区），在 effect 里普通地判断。

spec 在 on 调用时读取固定，之后改写原对象不影响对局；回调按普通函数调用，不保留类实例的 `this`。

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

`timing<T, R = T>(...groups)` 的 T 是挂钩载荷（可变草案或结果），R 是同名历史事实的记录类型。提交历史时直接传事件：`ctx.commit(Damage.dealt, changes, detail)`，detail 按 R 检查；读取时 `ctx.history.facts(Damage.dealt)` 返回 `Fact<DamageResult>[]`。不再手写 `Fact<unknown>` 与字符串 kind 比较。所有事实（包括只入历史、没有挂钩的事实，如 `Cards.revealed`、`CardEvent.used`）都由 defineEvent 声明；`commit` / `facts` / 移牌声明的 `kind` 只接受事件时点，没有字符串重载。窗口候选在开窗时一次收集，没有中途入窗（include / listen 已删除）。随移牌写入的事实用 `declared<D>()` 声明，记录为 `{ moves, before, declaration: D }`；只入历史的事实也写出 R（如 `timing<unknown, PhaseSnapshot>()`），离线投影的日志按事件时点登记类型化的叙述函数（`on(Damage.dealt, (d) => …)`），不再对历史载荷做 record/text 防御式解析。

## 主动技：action

`action({ id, limit, cards, targets, pay, selection, declare, effect })` 生成 `active` 能力：`limit: { per: 'phase' | 'turn' | 'round' | 'game', times }` 为次数限制（按技能定义计数，重新授予不重置），`cards: { count, areas, filter }` 与 `targets: { count, filter }` 生成联合选择，`pay: 'discard'` 弃置所选牌作为费用；复杂配对等约束可用 `selection` 自写 JointSelection 模型。effect 取得 `{ self, phase, cards, targets }`。

## 规则动词自带存活与终局处理

`damage`、`draw`、`recover`、`judge`、`chooseOwnedCard` 以及作者动词 `obtain` / `takeCard` / `give` / `askDiscard` / `select` / `obtainJudgment` / `useSupplied` 都会在目标阵亡或已终局时 no-op 或返回 unavailable，技能无需在每个 await 后手写 `isGameOver` / `alive` 检查。牌的获得统一写成移牌事实的 `declaration` 形式（如 `card.taken` 的 `{ moves, before, declaration }`）。

“由他人代出一张牌供我使用”（激将）是通用动词 `useSupplied(ctx, self, intent, { name, from })`：宣告技能后按行动顺序请求满足 `from` 的存活角色打出 `name`，首张供出的牌由使用者按原意图使用，目标、距离与次数仍算使用者的；无人供牌时返回 null。转换配方的 `use` 只需调用它：

```ts
use: async (ctx, { self, intent }) => {
  const from = (at: Context, actor: string) => kingdomOf(at.world, actor) === '蜀';
  const used = await useSupplied(ctx, self, intent, { name: 'standard:slash', from });
  if (used) return used;
  markFailed(ctx, self); // 激将：本阶段不能再主动以激将使用杀
  return { kind: 'unavailable', reason: 'No Shu player supplied Slash.' };
},
```

## AI 提示与技能同处

技能可声明 `ai: { value?: (view) => number, targets?: 'ally' | 'enemy' }`。基础 AI 只通过 `observation.skills(id)` 读取提示：`value` 给出主动技能的发动意愿（不大于 0 不发动），`targets: 'ally'` 让选目标偏向友方。view 只含观察者视角的 `self / players / hand / cards / hostility / cost`，提示必须是纯函数。基础 AI 本身不再按技能 ID 分支。

## 组合与运行

主持端用 [createContent](../src/content/catalog.ts) 将各包组合为本局目录。声明按引用使用，不复制、不冻结、不绑定，定义对象应视为常量；每局创建独立的 SkillBook（技能与牌目录），规则经 `rulesOf(ctx)` 读到的就是该局目录。技能用到的标记作为部件列在 `skill(...)` 里，随技能自动登记。

用 [createRoleMatch](../src/host/content.ts) 运行普通场景时提供 `{ seed, preset, lineup, content }`；阵容长度决定人数，无固定阵容的练习局使用 `{ count, seed, preset }`。content 可传 `ContentDefinition`（`{ cards, generals, decks, … }`，示例与测试用）或已有目录；直接建局时 deck 可写目录牌组 ID 或实体牌数组。

[研习示例](../examples/content/study.ts) 与 [渡口](../examples/content/harbor/index.ts) 是可直接 import 的完整源码，[真实场景](../tests/scenarios/content-examples.test.ts) 验证取消、宣告与来源失效。

声明的通用约定：active / viewAs 的 label 可省略；on 可省略局部 id（默认取时点 ID）；局部 ID 冲突在登记时报错，批量登记失败整批不生效。主动技能底层回调为 `(ctx, { self, phase })` 与 `(ctx, { self, phase, choice, selection })`；转换回调 `(ctx, { self, purpose })`；查询修正 `modify(query, (ctx, { input, self }) => value)`，具名查询见 [queries.ts](../src/rules/cards/queries.ts)；卡牌 use 回调见 [types.ts](../src/rules/cards/types.ts)。

## ctx、self 与普通函数

`on` 的回调接受位置参数 `(ctx, event, self, …)`，独立函数直接按 `(ctx: Context, event: DamageResult, self: SkillHandle)` 标注即可。`self.owner` 是技能拥有者，`self.id` 是本次技能实例，`self.skill` 是定义 ID；`ctx` 携带本次结算的状态读取、原因、历史和作用域。没有 `ctx.owner`、`ctx.draw` 或隐藏的全局“当前事件”。

规则操作直接调用 `await draw(ctx, input)`、`await damage(ctx, input)` 等普通函数。分支、循环和局部变量由 TypeScript 表达；父流程等待所有嵌套后效结束才恢复。不要并行写同一局；直接 await 或返回子操作的 Promise。

需要暂存牌时用 `withPrivateTopCards` / `withRevealedCards`：直接编写主体，结尾仍在暂存区的余牌由规则统一善后。

只有一步时可直接写 `effect: (ctx) => draw(ctx, input)`；技能、卡牌与领域后效的执行回调会等待返回的操作，忽略其结果。需要按 `paid/unavailable` 等结果分支时仍用普通 `await`；返回值本身不改变取消或中止语义。

`ctx.flow(...)` 返回领域值，中止默认向外传播。只有确实允许局部中止并继续的边界才使用 `ctx.attempt(...)`；故障和整局关闭不能因此恢复。无需给每个技能包一层 attempt，或逐层检查 aborted。

## 选哪种能力入口

| 需求                   | 作者层入口（优先）                                        | 底层入口（作者层不够时）                                                 | 可运行源码                                        |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| 在时点参与结算         | `on(Event.timing, { who, when, ask/cost, keep, effect })` | `when` 为纯查询，`effect` 可等待                                         | [刚烈](../src/content/standard/skills/ganglie.ts) |
| 出牌阶段主动发动       | `action({ limit, cards, targets, pay, effect })`          | 自写 `selection` 模型                                                    | [结姻](../src/content/standard/skills/jieyin.ts)  |
| 将材料解释为另一张牌   | `convert(id, { as, match, areas })`                       | 带 `make` 的配方；他人代出用 `useSupplied`                               | [武圣](../src/content/standard/skills/wusheng.ts) |
| 修正牌面、距离或限制   | `modify(cardQueries.x, fn)`                               | 自定义组合可用 `defineQuery`                                             | [谦逊](../src/content/standard/skills/qianxun.ts) |
| 失去技能后仍持续的效果 | `defineMark(id, initial, { scope, skill })`               | 持有标记即拥有 `skill`，标记到期即结束                                   | [裸衣](../src/content/standard/skills/luoyi.ts)   |
| 定义新的规则时点       | —                                                         | `defineEvent(id, { x: timing<T>() })` + `ctx.window`，跨文件直接共享对象 | [渡口](../examples/content/harbor/index.ts)       |

一个技能可以混用这些部件，也可直接编排 SDK 中的规则函数；新 helper 应来自真实重复的语义，而不是为隐藏一个循环建立通用框架。

## 选择、费用与继续条件

稳定 ID / 可读选项使用 `chooseOne`；材料与目标的联合选择使用 `JointSelection`；有序分组使用 `ArrangementSelection`。模型提供动态候选、前缀检查、最终验证和预览，UI 消费同一决策，不重写合法性。复杂约束用普通 `canComplete` 判断合法完成路径、`complete` 检查最终组合；需要额外前缀约束时再提供 `partial`，无需空函数占位。不能靠无界穷举或只检查最终组合。三个入口均读取选项的 id / label 后形成快照，支持原型 getter，不冻结原对象。

JointSelection 的 cards / targets 候选函数可直接返回稳定 ID 数组，需要自定义文字时返回 `{ id, label }`，两种条目可以混用；字符串的标签就是 ID。索引与预览使用同一次读取的字段值。预览仍输出完整候选，不改变回复形状。JointSelection 中不用的维度可整组省略：只选牌提供 cards / cardCount，只选目标提供 targets / targetCount；候选与数量必须一起声明。构造时统一补齐空维度，动态候选仍在预览和提交时重新读取；结果始终保留 cards / targets 两个数组，不让技能处理多种返回形状。

所有数量范围共用同一约束：min 为非负安全整数，max 为不小于 min 的安全整数或 `all`。联合选择、静态分组、牌的静态目标数量和转换的静态材料数量在对应声明规范化时检查；分组函数和转换函数返回的动态范围在每次查询时检查，错误指出对应牌或配方，不等到玩家提交后才暴露。

`selection.available()` 只查询空前缀能否继续，不生成候选投影，也不要求已选齐；复杂可完成性仍由声明中的普通函数决定。主动技能的候选、预览与最终验证共用这一入口。实际提交还会验证选中的具体牌与有序目标，支付继续独立重查次数及费用。

`on(..., { ask })` 负责自愿发动的询问、来源资格和零费用宣告；锁定技要留下“发动”记录时在 effect 里 `await declare(ctx, self, { changes, discard, ... })`。需要询问已宣告效果是否继续时，使用 `askInvoke(ctx, self, prompt, available?)`；它返回是否接受，资格由 available 表达。裸衣将标记与发动同次提交，克己将跳过标记与发动同次提交；洛神的继续询问沿用已宣告循环自己的继续条件。

技能费用写在宣告里（`declare` 的 `discard` / `give` / `limit`），或用 `payDiscard` 弃置并附带 `intent`。支付入口重新检查角色、来源、次数与材料，返回 `paid/unavailable`。费用与次数提交后，移牌及支付后效完整结束才返回，取消后效不自动退款。不要按 UI 点击计次。需要在费用确定时同步修改待决草案的例子见 [代受](../src/content/workshop/skills/relay.ts)：`draft.prepareTransfer` 生成的意图随 `payDiscard` 一起提交。

“后续还需要什么条件”由技能文本决定。来源在发动前必须有效；已经宣告的效果不因为来源消失而统一回滚，也不应在每个 await 后机械添加 `self.active(...)`。确实要求目标仍存活、当前阶段未结束或仍持有技能时，用动态候选及 `available` 表达，并由实际操作最终校验。区分草案、按发动时固定的来源与已经提交的结果。

直接调用 `draw` / `recover` 即复用规则操作对受益者存活与终局的重查；技能只表达是否接受发动、支付是否成功、材料/目标选择和文本特有的继续条件。多目标后效仍逐个 await，每个目标在实际操作时独立校验。

## 状态、只读值与生存期

局内计数和标记（类 FreeKill 的 mark）用 `defineMark(id, initial, { scope? })` 声明一次，不要放在共享定义或模块级可变变量中。数字标记默认校验为非负整数、布尔标记为布尔值，其余形状可传 `accepts`。`scope: 'phase' | 'turn' | 'round'` 的标记随当前阶段/回合/轮自动到期，作用域外读到初值，无需手写清理：

```ts
const skipped = defineMark('standard:fangquan-skipped', false, { scope: 'turn' });
skipped.of(ctx, self.owner); // 读
skipped.set(ctx, self.owner, true); // 写并入历史
declare: (ctx, phase, self) => ({
  changes: [phase.skipChange(ctx, self.skill), skipped.change(ctx, self.owner, true)], // 与发动同次提交
});
```

次数限制只有一种写法 `Limit = { per, times }`：牌写在 `use.limit`（杀为 `{ per: 'phase', times: 1 }`），主动技写在 `action({ limit })`。修正用牌规则只用一个具名查询 `cardQueries.useRule`，返回 `{ times?, targets?, range? }` 的增量，`Infinity` 表示不限（咆哮 `{ times: Infinity }`、方天画戟 `{ targets: 2 }`、奇才 `{ range: Infinity }`）。

阶段、回合、轮使用有身份的 `Lifetime`，嵌套阶段和额外回合各自独立。谁进行下一个回合只由规则层的 `playRounds` 决定：额外回合（`scheduleExtraTurn`，类 FreeKill `gainAnExtraTurn`）在当前回合结束后、下一个正常回合前执行，属于当前轮且不移动正常轮转；模式只提供座次、首席与每回合前的交接钩子。放权见 [fangquan.ts](../src/content/standard/skills/fangquan.ts)。普通 Flow 不自动变成回合生存期。

## 持续效果：带技能的标记

“本回合你造成的伤害 +1”这类效果不随失去技能而消失，它就是一个带 `skill` 的标记：存活角色持有该标记（当前作用域内的值不等于初值）即拥有这个技能，标记到期效果就结束。嵌套的他人回合里，回合作用域的标记读到初值，效果自然不生效。

```ts
// skills/luoyi.ts
export const stripped = defineMark('standard:luoyi', false, {
  scope: 'turn',
  skill: skill('standard:luoyi-bonus', '裸衣', '本回合你使用杀或决斗造成的伤害加 1。',
    on(Damage.causing, { locked: true, when: dealtWith(hit, self.owner, 'standard:slash', 'standard:duel'), effect: … }),
  ),
});
export default skill('standard:luoyi', '裸衣', '…', on(Phase.started, { …, declare: (ctx, _p, self) => ({ changes: [stripped.change(ctx, self.owner, true)] }) }), stripped);
```

效果技能里的触发通常写 `locked: true`（不询问、自动排序）。标记的值可以是数据（如 [盟约示例](../examples/content/covenant.ts) 的承诺对象），效果在 effect 里按需清除标记即提前结束。写法与边界见 [持续效果场景](../tests/scenarios/lasting-effects.test.ts)。

World、事实和接纳后的决策值在类型与运行时均只读；需要本地修改数组时先复制。领域草案通过其公开方法修改，封口后不能继续改写。`ctx.query` 与所有合法性查询不能写状态、取随机数或 await；违规异步规则查询立即冻结本局。

状态初值与状态写入先固定普通数据快照，再把这份快照交给 accepts；校验与保存不会各读一次原值。有 Context 的状态写入在纯查询内复制，数据 getter 不能借复制写入规则状态。

具名 Query 的开始值、贡献与合并函数、来源资格、retain 与标记的数据校验器都必须同步。主动技能的 `available` / `selection`、用牌的 `UseRules.selection`、转换的候选/资格/数量/构牌函数，以及选择模型的候选与约束也遵循此约定；用牌目标和响应资格的最终重查仍是纯查询。

查询回调的同步性由类型保证；运行时只在 Room 的查询边界检查返回值，执行侧查询返回 Promise 时立即冻结本局；本地投影、预览或回复出错则由主持侧停止本局并显示错误。普通内容继续直接使用现有入口，无需自行包裹守卫；异步后效仍放在 effect / onEnd 中。作者函数内部的普通表达式仍由作者负责，类型检查不能省略。

## 扩展与验证的边界

普通文件可以导出函数、事件（defineEvent）和 Query，由相对 import 共享同一实例；资源使用静态 import 或调用者提供的 URL。例子见 [渡口](../examples/content/harbor/index.ts)。不在挂起技能中途热换定义，也不引入签名或沙箱体系。

当前客户端支持已登记的选择形态。自定义 `ctx.ask` 类型能在规则层运行，不代表 UI 和基础 AI 已自动具备该交互；不支持的必选决策会中止基础 AI 对局。先复用现有选择模型，确有新交互需求时再补完整执行、投影和客户端路径。

改动后先运行 `pnpm typecheck`、`pnpm lint` 与对应领域场景；交付前运行 `pnpm check`（typecheck、lint、format:check、test），界面改动另跑 `pnpm test:ui`。检查领域结果、取消/失效与嵌套路径，不为每个实现细节追加测试。轨迹从 `ctx.history` 的事实和原因链读取，随机数使用 `ctx.randomInt`；不依赖真实时间、动画或 `Math.random` 决定规则。
