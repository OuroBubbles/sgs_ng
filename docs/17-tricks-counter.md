# 17 · 整牌流程、锦囊反制与共享牌池

日期：2026-10-17。标准牌子集从 5 种扩到 12 种：新增无懈可击、南蛮入侵、万箭齐发、桃园结义、五谷丰登、顺手牵羊、过河拆桥。它们已进入正式规则客户端的练习牌组；不是完整 104/108 张标准包。

## 一张牌的控制流

[UseRules](../src/rules/cards/types.ts) 保留 `resolve(ctx, effect, book)` 处理单个目标，增加三个相互独立的能力：

- `fixedTargets`：宣告前计算自动目标，统一过滤死亡/禁止目标；玩家回复必须不带手工目标。费用宣告记录实际目标，之后不会随存活列表变化重新生成。
- `canResolve`：目标确认后、反制窗口前检查效果是否仍有意义；反制结束后再次检查。桃园的未受伤者仍在目标列表中，但跳过实际效果与无懈询问。
- `execute(ctx, use, book, resolveTargets)`：整张牌的普通函数。有目标时明确调用一次 resolveTargets；可传局部目标解析函数，用闭包共享本次用牌的资源。

`execute` 能在一个处理区内包住全部目标、嵌套其他牌、分支或循环。无需把临时牌池塞入全局变量或 `extra_data`。只要建立过目标效果，即使全部已取消，也须调度一次，保留效果完成事实和后效。遗漏或重复调度都会报作者错误；已提交效果不回滚。调度上下文必须属于同一 World 和本次用牌的作用域路径。

`UseSnapshot` 增加普通数据的 timing 和 outcome。运行中的阶段/反制句柄、校验闭包不会进入快照；execute 可以返回普通结果，由结算完成事实保存。不能返回 Context、处理句柄或任意 class 实例作为存档数据。

## 无懈针对具体效果，也能针对反制用牌

[反制标准库](../src/rules/cards/counter.ts) 装配到 effectStarting 的 counter 组，前面是 main 组，后面是 after 组。普通技能可先取消或改变效果；已取消或不再有意义的效果不再询问无懈。Room 内核不知道任何锦囊牌名。

```text
原牌的目标效果：确认 → main → counter
  → 征询无懈 A（完整 use，零玩家目标）
    → A 的整牌函数征询针对 A 的反制 B
      → B 继续征询，直到当前层无人使用
      → B 完成、清理 B 的处理区
    → A 返回自己是否生效，完成与清理
  → 只有 A 最终生效，才取消原目标效果
原牌继续其余目标 → 完成与清理
```

无懈是 `card.used`，不是闪/杀响应协议。它没有假冒的玩家目标；UseTiming.counter 携带本次 CounterOpportunity，反制对象明确区分 effect 与 use。机会有 Lifetime、World 所属、祖先路径与相关性检查；过期、跨局、原效果已取消/目标死亡的机会不能重新支付。

每层反制牌的材料留在自己的处理区，等待更深一层结束才完成自己。源角色或转换技能在宣告后消失，不自动吞掉已经产生的反制；终局停止新询问，当前材料仍善后。三个独立反制用牌不会被压成一个缺少身份的奇偶布尔值；奇偶结果只是嵌套正常结算的后果。

当前本地热座按当前回合角色起的座次依次征询；无回合时以原牌来源为锚点。这是明确的离线调度，不宣称实现实时竞速抢答。放弃当前机会不禁止参加下一层机会。

`installCounterspells(room, book, names?)` 默认接受 standard:nullification，也可配置其他反制牌名称；这些牌可直接调用 resolveCounter。下一层保留同一名称集合。作者转换配方也能生成反制牌，不需要改 Room 或 CardBook 的牌名分支。CounterRequest 的相关性仍是普通纯查询函数，不变成 DSL。

## 自动目标与逐目标响应

南蛮和万箭在宣告时选定全部合法其他角色，按行动顺序逐目标进入效果。它们各自要求杀/闪，复用统一响应数量、支付、响应后效和伤害流程。无懈只取消当前效果，不取消整张多目标牌。前一个目标的后效使后续目标死亡时，后续效果跳过；临时出现的新角色不会隐式加入本次目标列表。

桃园对所有角色建立目标效果，未受伤者在效果前跳过；受伤者可分别被无懈。回复与伤害依然走相同的生命规则标准库。

## 五谷：普通闭包与有主处理区

[withRevealedCards](../src/rules/cards/reveal.ts) 从牌堆顶取得实有数量，必要时洗入弃牌堆，原子记录公开身份与移动；不借用任何角色手牌，也不从其他处理区回收牌。公开事实在移动后效前已提交。

[五谷实现](../src/content/standard/tricks.ts) 在初始目标完成四层之后，按 ready 身份数量在整牌函数中创建公开牌池（分层契约见 [36](36-target-stages.md)），再用 `resolveTargets(at, localResolver)` 逐目标选择。局部解析函数读取本池实时余牌；被无懈的目标不取牌，末尾只弃置实际剩余牌。

两次嵌套五谷各有独立闭包、处理区与候选，不互相覆盖。作者转换也能获准借用公开牌池材料作为反制牌：父池失去该材料，子反制拥有并清理它，父池不会再弃置一次。牌堆不足时只展示实际取得的牌；没有伪造摸牌或欠牌。

UI 只显示 cards.revealed 明确公开、且当前仍在相应区域中的牌。不能因为一个区域叫 processing 就把其全部内容公开。公开牌被获得后退出牌池，公共日志保留其公开选择事实。

## 顺手与拆桥：选择不等于持牌身份

[chooseOwnedCard](../src/rules/cards/choose.ts) 为本次选择生成 opaque 选项 ID，保留执行侧到实体牌的映射。隐藏候选用局内随机源排列；公开候选不消耗这次随机。默认只有装备、判定区和本人的手牌显示牌名，其他私有区也保持暗选。

回复只能使用仍有效的选项编号，不能直接提交实体 ID。选择前后再次检查角色存活、原持有区域与终局；选择本身不移动牌。实际移动使用明确实体 ID 和原区域，接受后记录独立事实。

顺手有距离 1 与目标有牌的限制；拆桥没有距离限制。标准实现只选手牌、装备、判定区域，不碰私有特殊区。来源死亡或目标在确认中失去全部可选牌时，不再弹空选择。暗中获得手牌的公共日志只说“一张手牌”；拆桥进入弃牌区或取得公开牌时，才公开相应牌名。

新增 judgment 区域用于明确区域身份与选择。该锦囊批当时仅提供区域身份；后续已实现首批装备（见 [18](18-equipment-queries.md)）和判定/延时牌（见 [19](19-judgment-delayed.md)），不能把当时的区域存在等同于后来的完整规则。

## 验证与剩余工作

后续 [60](60-counter-pending-windows.md) 修正反制开窗中原目标死亡/终局/原效果取消后，仍执行同窗候选的问题，并在嵌套或最后一席准备返回后再次检查封口资格。已使用的反制牌保留 by，已提交费用不回滚；16 项新增边界与原有正常无懈分别验证，公共完成后效保持原语义。

后续 [62](62-counter-effect-eligibility.md) 让内部反制继承 effectStarting.available，包含本次 canResolve 和目标禁令；治满的桃园、失去最后一张牌的顺手/拆桥等不再继续浪费无懈。正常决斗、延时后续生效和封口后的公共结果分别保留。

该锦囊批新增 27 项行为场景：[反制 10 项](../tests/scenarios/counter.test.ts)、[锦囊/作者组合 16 项](../tests/scenarios/tricks.test.ts)、[练习初始化 1 项](../tests/scenarios/practice.test.ts)。该批完成时合计 187 项规则/主持侧场景与 4 项布局测试，共 191 项；后续计数见 STATUS。

[浏览器](../tests/browser/client.spec.ts) 新增四类场景，各跑桌面/触屏：无懈实际用牌与结果、自动多目标万箭、四人五谷选牌、顺手暗选。该批与原场景合计 24 项，使用实际 CSP 和生产构建。平台产物与原生验收以 [STATUS](STATUS.md) 的当前记录为准。

锦囊批的练习牌堆为 128 张测试配比，后续装备批扩为 192 张（见 [18](18-equipment-queries.md)），支持复现种子，不是标准牌数量/花色/点数配比。借刀杀人仍需武器/装备语义；判定、延时锦囊、标准武将与完整包登记也仍待完成。AI、联机继续后置。

参考本地 FreeKill 的 [无懈](../freekill/packages/standard_cards/pkg/skills/nullification.lua)、[五谷](../freekill/packages/standard_cards/pkg/skills/amazing_grace.lua)、[南蛮](../freekill/packages/standard_cards/pkg/skills/savage_assault.lua)、[桃园](../freekill/packages/standard_cards/pkg/skills/god_salvation.lua)、[顺手](../freekill/packages/standard_cards/pkg/skills/snatch.lua)、[拆桥](../freekill/packages/standard_cards/pkg/skills/dismantlement.lua)。只参考规则与反例，未修改参考项目。
