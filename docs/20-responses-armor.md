# 响应供牌与防具范围

更新：2026-10-17。本批在既有判定、装备来源和支付管线上加入八卦阵、青釭剑、仁王盾。该批验收时练习牌组为 25 种牌、232 张测试配比；后续进度见 [STATUS](STATUS.md)，仍不是完整标准包。

## 作者入口

`CardBook.respond(ctx, actor, names, effect)` 请求打出，`useResponse` 请求响应中的使用；都先打开 `responseRequested`，再提供实体牌/转换选择。抵消杀时使用闪，万箭要求打出闪；完整契约见 [55](55-response-purpose.md)。即使手里没有闪，技能也有供牌机会。

窗口内的 `ResponseOpportunity` 是有生存期的规则句柄：

| 字段 / 操作               | 语义                                           |
| ------------------------- | ---------------------------------------------- |
| `actor`                   | 本层被询问的角色                               |
| `purpose`                 | use 或 response，决定使用/打出管线             |
| `beneficiary`             | 最初需要响应的角色，嵌套委托不改变它           |
| `to`                      | 本次响应对应的具体 EffectId / UseId 与牌面快照 |
| `names`                   | 可以满足请求的牌名                             |
| `actors`                  | 当前委托祖先链，用于拒绝环，不是全局尝试名单   |
| `available(ctx)`          | World、作用域、生存期、存活和单次供牌状态检查  |
| `canProvide(ctx, choice)` | 按 purpose 检查牌名、牌面、配方与对应禁令      |
| `provide(ctx, choice)`    | 最终重查并支付，成功后占用本机会               |
| `delegate(ctx, player)`   | 为另一角色嵌套开窗并询问；成功时采纳其响应     |
| `result`                  | 已提供的响应，未成功提供时为 null              |

技能可以在闭包中分支、循环或 `await`，无需注册八卦专用响应类型。例如判定成功后：

```ts
const jink = {
  kind: 'generated',
  face: { name: 'standard:jink' },
  materials: [],
  reason: 'my:skill',
} as const;

if (judgment.matched && request.canProvide(ctx, jink)) {
  await request.provide(ctx, jink);
}
```

`provide` 按用途复用 `CardBook` 的完整使用或打出支付、处理区和完成时点。材料和禁令在支付前再次检查；请求在供牌/委托期间预留，支付后效不能重入并重复供牌。无效或过期请求不收费。玩家的 wire reply 仍只接受实体牌与合法配方，不能提交 generated 指令。

`ResponseResult` 成功分为 responded（实际打出者）和 used（实际使用者与完整 use），委托使用另附 supplied；`isResponseSatisfied` 判断两项成功。实际打出完成窗口以 subject 区分 effect / judgment / supply，见 [30](30-strategists-private-pools.md) 与 [32](32-benevolence-supply-rescue.md)。`responseFinished` 只属于实际打出的牌，不为委托父层重复触发；原请求者的使用则有自己的 useFinished。宣告保留 beneficiary 和请求身份，委托另有 response.delegated 事实。失败尝试不阻止换人或本人继续供牌。

请求句柄/闭包不进入历史；`response.requested`、`response.request-finished` 保存普通数据。它们用于说明原因链，不承诺恢复暂停中的 JavaScript 调用栈。

## 八卦阵：宣告和后续效果分开

八卦阵监听 `responseRequested`，检查本角色是被询问者、闪未被禁止、装备在这个效果内有效，然后通过 `invoke(ctx, self, prompt, available)` 询问发动。

`invoke` 将接受选择与最终资格检查接到零材料的技能支付宣告，产生 `skill.invoked`。发动后进入普通 `judge`，红色时按请求用途提供一张零材料闪。判定期间防具离场不撤销已经发动的技能；供牌仍检查请求存活与对应使用/打出禁令。黑色判定或选择不发动后，继续普通闪选择。多闪需求逐次请求，每次分别判定。

这一区分让“发动前来源失效”和“发动后来源离场”有清楚边界，不需要在每个后效里重复检查同一个来源。

## 青釭剑：规则属于此杀的效果

青釭剑在每个有效目标的 `targetSpecified` 调用：

```ts
effect.ignoreEquipment(ctx, 'armor', 'standard:qinggang_sword');
```

该声明只属于当前 EffectId，保留在其 ignoredEquipment 快照。全部初始目标先完成四层，之后来源失去武器不撤销已声明效果；失去武器后新增、转移或重复的身份重新检查来源，不自动继承青釭。作者显式声明整次用牌规则时仍可使用 use.ignoreEquipment，它才包含之后新增身份。详见 [36](36-target-stages.md)。

防具作者在处理对应效果时使用 `equipmentEffectiveFor(world, self, effect, 'armor')`。它只忽略该效果目标的实际装备来源；普通角色技能复用相同代码仍是角色技能。青釭剑移除后，本次已声明的杀仍忽略防具，新安装的目标防具也受此声明约束。另一次嵌套杀、另一角色作为队友供牌时的防具都分别判断。

**这里没有把玩家的防具全局关闭。** 新防具的效果型能力也必须调用这个助手；没有 EffectRef 的距离、转换等普通查询不会因此全局失效。八阵等具体武将能力尚未实现，测试中的普通来源复用只是验证来源语义。

仁王盾在 `effectStarting` 的 main 组检查黑色杀和上述有效性，然后取消该目标效果。它判断语义颜色，所以可以正确处理颜色与花色分离的转换牌。

## 界面与证据

- 装备共用公开装备区、牌面详情与真实用牌管线。八卦发动显示“发动 / 不发动”，判定和供闪进入公开日志。
- 多个可选效果需要排序时，发送稳定 ID 与可读技能名映射；界面显示名称，提交仍使用 ID。
- 委托响应的公开日志说明实际供牌者和受益者，不复制受益者的私有手牌。
- [规则场景](../tests/scenarios/armor-response.test.ts) 本批新增 20 项，覆盖禁令变化、离场、双闪、嵌套杀、新增目标、委托环、死亡、重入、过期/外部 World、wire 回复和状态重建。
- [浏览器场景](../tests/browser/client.spec.ts) 从正常开局验证八卦红判供闪与青釭剑破仁王盾，沿用生产构建与实际 Tauri CSP。
- [当前状态](STATUS.md) 记录最终检查与原生包证据；原生构建成功本身不视为运行验收。

本章批次最初只提供委托机制与作者组合探针；后续已接入护驾的实际魏角色供闪，见 [31](31-commanders-phase-replacement.md)，以及激将的打出委托、供牌后由主公使用杀，见 [32](32-benevolence-supply-rescue.md)。多次触发发生项与判定牌面视为仍待完成；额外回合、标准＋EX 牌组和基础 AI 已接入，完整智能托管与联机仍后置。

具名响应禁令与唯一供牌的后续边界见 [54](54-named-response-blocks.md)：请求先收窄允许名称，委托不能扩大集合，实际代打者禁止打出仍独立校验；一次提供成功后收束剩余供牌候选，失败委托则恢复原请求。
