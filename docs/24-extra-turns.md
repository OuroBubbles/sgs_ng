# 额外回合与阶段计划

更新：2026-10-17。额外回合队列已接入 RoleMatch，复用同一回合执行器。完整武将与离线内容仍未完成，当前验证以 [STATUS](STATUS.md) 为准。

## 请求与执行分开

[extra](../src/rules/turn/extra.ts) 提供四个小接口，队列和递增序号都属于 World，不依赖模块可变数组。

```ts
const granted = scheduleExtraTurn(ctx, {
  owner: target,
  reason: 'my:skill',
  phases: ['draw', 'play', 'finish'],
  position: 'next',
});

// 若规则之后明确取消，只取消这个身份，不影响该角色的另一额外回合。
if (granted) cancelExtraTurn(ctx, granted.id, 'my:cancellation');
```

`scheduleExtraTurn` 冻结输入，生成带 id、owner、reason、phases 的请求并提交事实。未声明阶段时使用六阶段；空列表表示只有回合开始/结束，允许重复阶段。next 插在现有待执行请求之前，last 排在之后；默认 next，循环批量授予时应显式选择顺序。

`pendingExtraTurns(world)` 返回冻结的等待列表。`takeExtraTurn(ctx)` 由模式在回合边界消费：接收者死亡则记录 `turn.extra-skipped`，继续寻找存活请求；来源失去或死亡不会撤销已授予的回合。终局不新增或消费请求，未执行项目保留为终止现场。

取消、授予和消费均为显式提交，受纯查询、关闭上下文和串行执行守卫约束。当前授予是独立提交；需要与技能费用同次原子宣告的内容尚未接入，不能把“支付后调用授予”自动当成完整的原子费用契约。

## 正常轮转位置保持独立

[RoleMatch](../src/app/offline/role-match.ts) 每次回合边界优先取出额外请求，没有请求时才使用正常下一席。额外回合不移动 `progress.next`，期间新增请求可继续插队。

例如普通 a 结束后本应轮到 b，此时有 c、d 两个额外请求；c 期间又给 a 一个 next 请求，执行顺序是：

```text
a 普通 → c 额外 → a 额外 → d 额外 → b 普通 → c 普通
```

消费在席位准备决策之前提交；准备期间中止后不会自动重试这个已消费的请求。手动演练显示交接遮罩，默认单机由主持侧自动确认。已存在 taken 事实而没有 started 事实时，表示执行在开始前中止。当前事实重建不恢复挂起执行，不承诺从该位置续局。

同一玩家连续获得额外回合仍需重新确认。交接投影只暴露“额外回合”提示，不把实现原因 ID 当作玩家文案；执行中的标题和公开日志也明确标记额外回合。

## 同一个执行器

`runTurn(ctx, book, owner, options)` 的第四参数现在是 `TurnOptions`：

```ts
const next = takeExtraTurn(ctx);
if (next) {
  await runTurn(ctx, book, next.owner, {
    origin: { kind: 'extra', id: next.id, reason: next.reason },
    phases: next.phases,
    body: defaultPhaseBody,
  });
}
```

origin 默认为 `{ kind: 'normal' }`；body 默认为普通六阶段本体。阶段计划和 origin 在进入等待前复制，调用方之后改变数组或原因不会修改正在运行的回合。

`TurnView.origin/phases`、`TurnResult.origin` 和可序列化 activeTurn 保留这些语义。每次阶段仍有独立 Lifetime：重复出牌阶段有独立次数；`skipNext` 仅消费下一次对应阶段。`turn.end` 继续表示完成当前结算后结束本回合，不抛弃正在处理的牌和后效。

普通代码也可显式 await 嵌套 `runTurn`；内层结束后恢复外层 activeTurn/activePhase，内层到期只清自己的临时状态。队列默认只在外层回合边界调度，不会隐式打断任意技能中的 await。

## 验证边界

[额外回合场景](../tests/scenarios/extra-turns.test.ts) 16 项，覆盖排序、身份取消、冻结输入、死亡、终局、重复阶段及真实杀次数、嵌套状态恢复、开局插入、结束窗口授予、正常轮转不偏移、连续私有交接及状态重建。

现有客户端尚未提供授予额外回合的真实武将。新队列通过规则/主持侧和席位投影验证；原生窗口的现有标准牌局不等于真实额外回合技能验收。任意强制中断、挂起恢复与完整原子费用入口仍需结合真实内容继续实现。
