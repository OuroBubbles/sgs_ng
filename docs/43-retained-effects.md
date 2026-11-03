# 43 · 历史来源与当前后效资格

更新：2026-10-18。本批补齐已离场来源的普通发动/支付，登记技能撤销、到期及埋葬快照，并用作者演武包的遗玉验证真实界面。通用运行内核没有新增三国杀专用分支；规则标准库继续使用普通函数和已有 Window/Flow。

## 当前所有权与本次后效分开

以前 `on.retain` 能让离场装备成为候选，但 `invoke/pay` 仍只检查当前所有权，因此可选离场后效无法正常宣告。普通显式授予的技能在最后来源移除后，也不再进入变更窗口的当前来源集合。

现在只有一项来源资格：`self.active(ctx)`。普通来源为「拥有者存活、仍持有且未失效」（Provider 来源还须仍在登记中）；[on](../src/rules/skills/on.ts) 为正在执行的 `run` 绑定的来源改为「本次回调及其子流程内，`active ∨ retain` 仍成立」。它不把旧来源放回 World，也不让旧转换、查询修正或主动动作重新出现在目录中。作者直接继续调用 `invoke(ctx, self, ...)` 或 `pay(..., { skill: self })`。

触发资格统一为 `(active ∨ retain) ∧ who ∧ when`。`retain` 是普通纯谓词，完整决定来源不可用时能否处理本次事件：不再隐含存活或登记检查，死亡来源的后效直接写进 retain（原 `allowDead` 已删除）。核心在进入回调前重查；回调开始后，支付前需要的文本条件继续写在 `PaymentSpec.legal` 或 `invoke` 的 available 参数中。已经完成的宣告和费用不回滚。

## 资格只属于当前执行

绑定引用在回调正常返回、局部中止和故障时都会关闭。父流程、兄弟后效、其他 Room 和之后的新流程不能借用这份引用支付；重新装备同一张实体牌也不会重新打开旧回调的资格。新来源应重新从当前目录取得。

各个 occurrence 分别绑定资格。拒绝第一次不吞掉第二次，也不能在第二次中复用已经关闭的第一次引用。`SkillHandle` 可以由普通 class 提供，包装会保留原方法的接收者；触发声明本身（on 的 spec）在声明时读取固定，回调按普通函数调用。

引用、谓词和 Context 只留在执行侧。支付事实继续保存实际 `skill/instance` 和声明数据；历史来源的实例 ID 没有改写为新授予。World/事实重建不保存回调，也不恢复挂起执行。

## 显式提供历史快照

[SkillBook.registerSnapshots](../src/rules/skills/skills.ts) 在装配期登记一个窗口的普通读取函数：

```ts
const My = defineEvent('my', { changed: timing<{ before: readonly SkillInstance[] }>() });
skills.registerSnapshots(My.changed, (event) => event.before);
```

读取函数只用于该窗口的候选收集，不能提交规则操作。目录挂接后封口，重复登记拒绝；返回非数组、同一实例 ID 对应不同角色/技能等错误，在执行效果前报告。当前实例优先，同一历史身份重复出现不会复制技能或发动次数。

内置登记包括：

- `skillsChanged` 的 before 实例。
- `lifetimeEnded.skillsBefore` 中受本次到期影响的实例。
- `playerBuried` 和 `deathFinished` 的实际埋葬前实例。

这些候选依然必须明确声明 retain，普通效果不自动取得历史资格。当前查询和转换调用 `bindings(world)` 时不带窗口，不会发现历史实例。装备来源继续由原有 Provider 根据 `cardsMoved.before` 提供；自定义派生来源也可以继续使用普通 Provider。

这不是扫描整个 Journal，也不是开窗后自动发现新技能。跨未来窗口的独立效果使用自己的状态与生存期；后续 [56](56-independent-effects.md) 已提供效果目录、普通触发/查询与结束后效，不必手写专用 Provider，也不把一次历史回调的引用长期保留。

## 丢失技能的普通写法

[skillLost](../src/rules/skills/skills.ts) 匹配事件中的原实例、角色与技能，要求原来有启用授予、当前已不存在该实例，并检查当前失效状态。撤销部分来源或只是暂停授予，不等于失去整个技能；失去后重新获得的新实例也不替换旧身份。

```ts
const lost = (ctx: Context, change: SkillChange, self: SkillHandle) =>
  skillLost(ctx.world, change.before, self);

on(Skill.changed, {
  id: 'after-loss',
  retain: lost,
  when: lost,
  ask: '是否发动？',
  effect: (ctx, _change, self) => draw(ctx, { player: self.owner, count: 1, reason: self.skill }),
});
```

到期/埋葬的数组可用 `some(old => skillLost(ctx.world, old, self))` 表达。它读取当前封印状态，不复制整个旧 World，也不会恢复已经到期的失效标记。新的后效状态需要新的有效生存期，不能往已经结束的原 Lifetime 写入。

## 死亡与埋葬记录各自的事实

生命事件类型与窗口放在 [life-events.ts](../src/rules/combat/life-events.ts)，结算器在 [life.ts](../src/rules/combat/life.ts)。技能目录只依赖事件定义，不导入完整死亡执行器。

`DeathEvent.skillsBefore/zonesBefore` 继续描述最初死亡时的快照。死亡后效可以改变牌或授予技能；`BurialEvent.burial.skillsBefore/zonesBefore` 另外记录真正埋葬前的内容，埋葬事实也保存该快照。后续窗口按实际移除的来源收集，不改写最初的死亡事件。retain 成立的已死亡旧来源可以自愿处理这次埋葬后效。

## 可运行内容与验证

[作者演武包](../src/content/workshop/index.ts) 新增遗玉与“遗玉演练（40 张）”牌组。遗玉离开装备区后，可以玉碎摸一张；拒绝不宣告，手牌中的遗玉被弃置也不会发动。实现只有普通 `equipmentLost → retain/when → invoke → draw`，没有专用客户端分支；原整备演武牌组仍为 44 张。启用演武包后共 34 种牌、26 名武将。

自然输入：作者演武、演武客、两人、AI 关羽、遗玉演练、种子 10。甲席先装备遗玉，再装备起手八卦阵；旧遗玉已在弃牌堆、新防具已在装备区，此时由甲席选择是否玉碎。接受才摸一张，没有把旧防具恢复为当前能力。桌面/触控分别验证接受和拒绝；截图在 `.artifacts/ui/retained-equipment-*.png`，Windows 驱动也覆盖两种选择。

[26 项规则场景](../tests/scenarios/retained-effects.test.ts) 覆盖普通离场宣告、真实材料费用、撤销/到期/埋葬、当前所有权隔离、死亡来源、已知角色、作用域/Room/关闭引用、发生中失效、when 与后续支付分离、局部中止/故障、有限次数、纯查询、class 来源、快照错误/去重/封口，以及真实作者包材料和事实重建。

标准与演武内容版本为 `0.1.4`，演武继续精确依赖标准版本；完整回归与分发证明见 [STATUS](STATUS.md)。本批完成显式快照来源及本次后效的普通支付，不声称任意历史来源、动态来源卸载、窗口中新来源补入、长期独立效果注册、录像恢复或完整离线版已经验收。Android、高级托管与联机仍按既定顺序后置。

后续已补齐动态 Provider 卸载及重新登记边界，见 [44](44-provider-lifecycle.md)；登记资格独立于 retain，已卸载引用不能继续发动/支付。独立效果基础登记见 [56](56-independent-effects.md)，本节其余未实现边界继续保留。
