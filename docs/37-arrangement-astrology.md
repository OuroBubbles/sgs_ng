# 37 · 有序分组与诸葛亮

后续 [59](59-constrained-assignment.md) 在同一模型增加动态组、逐项接收条件与真实可行初始方案，并提供角色分配呈现；本篇的普通观星顺序与善后保持原样。

更新：2026-10-17。接入诸葛亮的观星、空城，当前标准目录含二十五名武将。已有实现和验证仍不代表完整离线版验收；默认人类甲席、其余基础 AI，Android 仍在桌面完成之后。

## 一个分组模型，技能仍是普通代码

[ArrangementSelection](../src/core/decisions/arrangement.ts) 解决单一选择语义：每个当前候选恰好分配一次，每组内部有顺序，组有稳定 ID、可读标签和数量上下限。它不解释牌堆、支付、技能或实体移动。

```ts
const model = new ArrangementSelection({
  items: () =>
    pool.remaining().map((id) => ({ id, label: book.definition(ctx.world.card(id).name).label })),
  groups: [
    { id: 'top', label: '牌顶', count: { min: 0, max: 'all' } },
    { id: 'bottom', label: '牌底', count: { min: 0, max: 'all' } },
  ],
});
const answer = await ctx.ask(model.decision(owner, '整理顺序', { reason }));
```

回复是 `{ groups: [{ id, items: [itemId, ...] }, ...] }`。组的传入顺序不改变组身份；返回值按定义顺序规范化，保留组内顺序并深冻结。重复、遗漏、未知项、未知组、数量越界和实时候选变化都会使旧选择失效。DecisionHub 继续负责 token、过期与重复回复检查。

initial 先满足各组下限，再按定义顺序填充剩余容量。没有可完成的容量时决策返回 unavailable，不开放无法完成的必选等待。模型不穷举任意耦合约束，也不承诺为所有作者技能自动求解；额外业务判断仍是普通函数。

describe 只输出 items、groups、initial 和 reason 等普通数据；校验闭包留在执行侧。排序不是把 JointSelection.cards 数组偷偷解释成另一套语义，联合选择的候选与选择反馈保持原合同。

## 私有牌与清理策略

[withPrivateTopCards](../src/rules/cards/private-pool.ts) 仍默认把余牌弃置，遗计不变。新增第四个 cleanup 参数，可传目的区域或 ProcessingCleanup，复用现有 withProcessing 的所有权与善后。

观星用普通代码组合：发动宣告 → 取最多五张私有牌 → 必选分组排序 → 同次提交牌顶/底移动。牌顶与牌底的回复顺序均从先到后，牌顶第一张是下次首先取得的牌；中间原有牌保持顺序。它不触发摸牌、不进入手牌，也不公开牌面。

正常结束、终局、本人死亡或局部子流程中止时，未处置的实时余牌按当前顺序回顶。被其他后效取得的牌不再移动；已接受发动后失去观星，不撤销本次选择。整局立即中止与未捕获故障仍保留诊断现场，不假装执行了完整规则善后。

cards.arranged 事实保存真实顺序供状态重建；公开投影只解释置顶/置底数量。本人可见的私有池来自现有生存期元数据，其他观察者和 AI 不取得牌面或牌序。没有添加牌堆记忆服务，历史重建仍不恢复挂起协程。

## 观星与空城的规则位置

[观星](../src/content/standard/generals/zhugeliang.ts) 在本人准备阶段开始时询问。X 按接受发动后的存活人数计算，至多五；跳过准备阶段不询问，牌堆不足时洗入弃牌，仍不足则只处理实有牌，空池不开放排序等待。

空城是现有 cardQueries.prohibitTarget 的普通修正：有效来源且本人手牌为空时，禁止成为杀/决斗目标。装备和私有临时池不算手牌，群体锦囊与响应资格不受它限制。目标时点后、实际生效前失去最后手牌由统一管线重查；决斗已经开始后打出最后一张杀，不中断已经进入 resolving 的效果。

参考 [标准目录](../../freekill/packages/standard/pkg/init.lua)、[观星](../../freekill/packages/standard/pkg/skills/guanxing.lua)、[空城](../../freekill/packages/standard/pkg/skills/kongcheng.lua)。本次实现按标准技能文本，不加入界观星的额外阶段触发或额外摸牌。参考源码未修改。

## 客户端和基础 AI

[ArrangePanel](../src/client/panels/ArrangePanel.svelte) 接收纯投影，按钮移动分组并调整先后；桌面和横屏触屏共用。候选可来自私有池，也可作为普通可读项显示。专用草稿经 LocalSession.inspectAnswer 预览、answer 最终提交，组件不能移动牌。

必选排序不可 Escape 关闭；可选排序可取消。暂停会销毁面板、私有投影和未提交草稿，恢复后从同一开放请求的当前 initial 重新调整，不承诺保存暂停前排列。全局手牌数字键与确认快捷键不会穿透排序面板。

基础 AI 在观星时只按本人私有池中的可见牌做简单估值排序，全部留在顶；它不规划判定或推理未查看的牌。其他有序分组决策尝试合法 initial，失败则沿用明确的 unsupported 边界，没有引入高级搜索。

## 证据和剩余范围

[34 项规则场景](../tests/scenarios/astrology.test.ts) 覆盖分组/顺序/上下限、非法和过期回复、二至八人局与存活计数、顶底真实摸牌、空池和洗牌、来源变化/实时余牌善后、投影与暂停、AI 合法回复、空城与决斗，以及混合八人标准局的真实胜负。默认测试不读取参考项目。

[浏览器](../tests/browser/client.spec.ts) 增加本人排序/暂停/真实摸牌与诸葛亮 AI 两类操作，桌面和触屏共四项；[原生驱动](../scripts/smoke-native.mjs) 覆盖相同操作。当前全量测试、Windows 实际运行和归档字节证据统一见 [STATUS](STATUS.md)。
