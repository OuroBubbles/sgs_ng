# 14 · 摸牌与六阶段驱动

日期：2026-10-16。当前能通过正式决策跑完六阶段；[生命与身份装配](15-life-role-match.md) 已接入多角色调度和基础胜负，[客户端](16-local-client.md) 已接入正式决策。完整标准内容仍待完成。

## 摸牌与牌堆

[draw / reshuffle](../src/rules/cards/draw.ts) 使用每局随机源。drawing 窗口可修改摸牌数；提交记录请求值、最终值和每次修改原因。余牌不足时将弃牌区打乱后补到牌堆底，保留已有牌堆顶。不会从任何处理区回收牌。

洗牌有序移动和摸牌提交都可由事实重建。洗牌后效结束后，实际摸牌重新读取当前牌堆；仍不足则返回实际取得的牌，不伪造数量。摸牌后牌被其他效果取走，原摸牌事实仍成立。伤害、摸牌、响应请求在进入等待前复制数据，调用方后来修改输入不能改变本次流程。

提交边界后续审计见 [49](49-deck-boundaries.md)：起初死亡/终局不开放 drawing；窗口中失效停止剩余候选，洗牌后再重查资格。提交前失效返回 unavailable，已移入手牌后的死亡/终局仍保留真实完成事实。DrawResult.count 是修改后的请求数，cards 才是实际提交的实体快照。

## 阶段与回合

[runTurn / runPhase](../src/rules/turn/turn.ts) 默认提供准备、判定、摸牌、出牌、弃牌、结束六阶段。runTurn 第四参数为 TurnOptions，可提供 body、phases 与 origin；额外回合、阶段计划、重复阶段和嵌套恢复见 [24](24-extra-turns.md)。

```text
turn.started
  → 每阶段 phase.before，可宣告跳过
  → 未跳过：phase.started → 普通阶段函数 → phase.ending
  → 生存期到期清理 → phase.finished
turn.ending → 生存期到期清理 → turn.finished
```

每次阶段都有独立 Lifetime。跳过的阶段不运行本体、started 或 ending 窗口。额外出牌阶段得到新身份和独立次数。阶段结束窗口仍处于阶段生存期中，技能可按显式阶段 ID 查询本阶段事实，然后再到期清理。

默认判定阶段已执行乐不思蜀、闪电等延时牌，见 [19 · 判定与延时牌](19-judgment-delayed.md)。默认摸两张；默认出牌使用 play-action 决策；默认弃牌按具名手牌上限查询计算数量，并最终支付。取消主动用牌表示结束出牌阶段，强制弃牌不能取消。模式可用普通 PhaseBody 函数扩展/替换本体，不需要把流程压成模板表。

activeTurn/activePhase 在 World 中保存可序列化身份数据；控制句柄和运行闭包不进入 World。正常完成或阶段 body 中止都会恢复上层阶段状态，异常则冻结现场。

currentPhase(ctx) 只返回同一 World、当前祖先路径内存活的最内层阶段句柄，可用于嵌套决策中的阶段状态；嵌套关闭后恢复，阶段外返回空。它不用于恢复暂停协程，见 [32](32-benevolence-supply-rescue.md)。

## 跳过、结束与原子宣告

phase.skip(ctx, reason) 提交跳过意图；phase.skipChange(ctx, reason) 生成声明变更，可放入 pay 的 changes。费用、次数、跳过标记在同一提交生效，支付后效不会看到半宣告状态；费用失败则不跳过。这为巧变类机制提供可组合入口，不把某个技能写入内核。

phase.replace(ctx, reason) / replaceChange(ctx, reason) 仅在 phaseStarted 窗口替代尚未执行的默认阶段体，仍开放阶段结束窗口。快照与结果区分 replaced 和 skipped；不是强行取消子流程。突袭与原子支付示例见 [31](31-commanders-phase-replacement.md)。

turn.skipNext(ctx, kind, reason) 预定本回合下一次对应阶段的跳过，进入该阶段前原子消费；未消费的意图随回合到期。

turn.end(ctx, reason) 提交结束标记和原因，当前已经产生的用牌/后效仍完整结算，之后停止主动决策与后续阶段。它不等于关闭整局 Room，也不强行取消子效果。生存期句柄同时检查 World 所属和祖先关系，相同文本 ID 不能跨局复用。

## 当前装配

```ts
// room 已用合法 WorldSeed 建立，定义由 app 装配。
const skills = new SkillBook([wusheng]);
skills.attach(room);
const cards = new CardBook(standardCards, skills);
await room.run('local-turn', (ctx) => runTurn(ctx, cards, 'a'));
```

主持侧读取 room.decisions.pending 并回复。玩家回复不携带 actor、时机或 generated 规则指令，主持侧固定这些信息。阶段机制测试使用脚本化输入；客户端已在同一接口接入 [基础 AI](26-basic-ai.md)。

## 验证与下一步

[阶段场景](../tests/scenarios/draw-turn.test.ts) 使用正式决策完成摸牌、杀/闪、结束出牌、强制弃牌、回合结束，并核对状态重建。还覆盖跳过、支付后效中结束回合、死亡标记后停止阶段、独立额外阶段、阶段中止、手牌上限、洗牌和原子跳过宣告。

阶段批新增 50 项场景，生命/身份批新增 27 项；客户端主持侧又新增 8 项，锦囊/反制批新增 27 项。装备/查询批新增 21 项，判定/延时牌批新增 32 项；该判定批次为 240 项规则/主持侧场景，加 4 项布局共 244 项，原有 8 项 P0 演示/选择测试已移除。浏览器与原生证据另见 STATUS。

生命与基础身份装配已补齐濒死救援、死亡埋葬、胜负和多角色调度，客户端已接入。反制链已实现；判定与首批延时锦囊已实现；标准＋EX 的实体牌表与装备已补齐；下一步完成武将、主动动作与复杂技能验收。Demo 已有基础 AI，完整智能托管与联机仍后置。
