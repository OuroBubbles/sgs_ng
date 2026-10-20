# 雌雄双股剑、寒冰剑与标准实体牌表

更新：2026-10-17。本批补入两件剑，标准＋EX 的 32 种牌与 108 张实体牌已接入默认开局。武将目前仍只有甲席预设武圣，完整离线版尚未完成。当前计数和平台验收以 [STATUS](STATUS.md) 为准。

## 目标窗口与伤害替代

当前用牌按指定前、确认前、指定后、确认后四层各自遍历目标，全部初始目标完成后才进入实际效果；四个窗口、锚点、动态追加与状态契约见 [36](36-target-stages.md)。雌雄双股剑在指定后，因此流离等确认前技能先执行；目标若此前已取消，不再询问雌雄剑。延时牌后续判定生效不重复四层。

伤害管线增加 `damageReplacing`，顺序为：

```text
damageCausing（来源增减与来源效果）
  → 冻结 sourceSnapshot
  → damageReplacing（未防止、正数、目标存活且对局继续时）
  → damageInflicting（尚未防止时）
  → 封口、提交、生命结算与后效
```

替代在已有 `DamageDraft` 上显式 `prevent(reason)`，并用普通代码完成其他效果。它不改写已冻结的来源快照，也不需要一套额外的技能解释器。寒冰剑防止后，不进入目标受伤窗口或扣体力；仍有 prevented 结果与 settled 收束。连环、伤害转移尚未实现，不能据此宣称所有派生伤害规则已经闭合。

实现见 [用牌](../src/rules/cards/book.ts)、[伤害](../src/rules/combat/damage.ts)，作者入口由 [sdk](../src/sdk/index.ts) 导出。

## 性别属于角色规则状态

[gender](../src/rules/characters/gender.ts) 提供 `Gender`、`genderOf`、`genderChange`、`setGender` 与 `differentGender`。性别保存在带归属的规则状态中，未增加内核 Player 的固定字段，也未依赖 UI 文本。

| 值            | 含义与比较                                           |
| ------------- | ---------------------------------------------------- |
| male / female | 男 / 女，二者构成异性                                |
| dual          | 双性，与任一有性别角色可构成异性，包括另一个双性角色 |
| none          | 无性别，不构成异性，也是未声明时的默认值             |

同一角色与自身不构成异性。死亡不抹去角色性别，状态可从提交事实重建。`RoleMatch` 的角色配置可提供 gender；初始化随 `match.preparing` 同次提交。当前练习角色按席位交替男女，只用于验证规则和交互，不代表武将定义。

## 两件剑仍是普通技能代码

[swords](../src/content/standard/swords.ts) 使用已有的装备能力工厂、invoke、联合选择、移牌和摸牌接口。没有向内核添加牌名分支。

- 雌雄双股剑在 `targetSpecified` 检查自己的杀与异性目标。来源选择发动后，目标可弃置一张手牌，或选择“令对方摸牌”；没有可弃手牌时来源摸一张。已发动效果不因武器离场或性别随后改变而撤销；来源已死亡时不再摸牌。弃牌是效果移牌，不能伪装为来源支付技能费用。
- 寒冰剑在 `damageReplacing` 处理自己的杀伤害。发动前重查正伤害、未被防止、目标存活且有手牌/装备；接受后先防止该伤害，再至多执行两次独立选牌。每次重新读取目标当前区域：第一次弃牌触发的新获得牌，可以进入第二次选择。目标仅剩一张牌时只弃一张；来源或目标死亡、整局结束时停止后续选择。

寒冰剑对他人手牌复用 `chooseOwnedCard` 的不透明选项，装备则显示公开名称。一次选择保存自己的选项和最终位置检查；两次选择不共享旧快照。只有已公开弃置的实体进入日志。当前尚无完整的“禁止弃置”查询组合，复杂技能接入时需补齐这一边界。

规则依据本地 FreeKill 的 [雌雄双股剑](../freekill/packages/standard_cards/pkg/skills/double_swords.lua)、[寒冰剑](../freekill/packages/standard_cards/pkg/skills/ice_sword.lua)；只采用明确的规则含义，不保留兼容桥或历史时点别名。

## 默认 108 张，可选机制练习

[实体牌表](../src/content/standard/deck.ts) 直接声明名称、花色和点数，再生成 108 个独立实体 ID。与规则目录的 32 种牌逐项对应。标准部分 104 张，EX 为 ♠2 寒冰剑、♣2 仁王盾、♦Q 无懈可击、♥Q 闪电。

各花色 27 张；除 ♠2、♣2、♥Q、♦Q 各有三张外，每个花色点数组合各有两张。重复牌面保留独立实体身份。杀 30、闪 15、桃 8，其余数量由 [牌表场景](../tests/scenarios/deck.test.ts) 固定验证。

默认 `createOfflineMatch()` 使用该牌表。开局设置可选择“机制练习”，其 288 张测试配比便于定位全部牌型；种子复现必须同时指定牌组。`RoleMatch.deckName` 是装配时确定的展示元数据，投影后显示在战场标题，不根据剩余牌堆大小猜测模式。自定义牌组仍可以使用相同 RoleMatch。

开发时另以本地 [FreeKill 牌表](../freekill/packages/standard_cards/pkg/init.lua) 的 `addCardSpec` 行核对完整牌面多重集，证据写入 `.artifacts/validation/deck-audit.json`，包含参考文件 SHA-256。常规测试、运行和构建不读取参考项目。

```powershell
$env:SGS_REFERENCE_AUDIT = '1'
pnpm exec vitest run tests/scenarios/deck.test.ts
Remove-Item Env:SGS_REFERENCE_AUDIT
```

## 验证范围

[两件剑规则场景](../tests/scenarios/swords.test.ts) 22 项，覆盖窗口先后、来源快照、死亡/来源失去、嵌套区域变化、性别变化、重复目标、防止/归零与状态重建。[牌表场景](../tests/scenarios/deck.test.ts) 4 项，覆盖目录、实体身份、数量牌面、默认装配与确定性初始化。

[浏览器场景](../tests/browser/client.spec.ts) 分别验证桌面和触屏的双股剑三分支、寒冰剑发动/拒绝、默认牌组与标准牌组至身份胜负。Windows 原生脚本另走实际 WebView2 的两件剑与标准牌组；是否通过及其对应 exe、归档，以 STATUS 和原生记录为准。完整武将、额外回合、复杂技能与 Android 真机验收继续推进，AI 和联机后置。
