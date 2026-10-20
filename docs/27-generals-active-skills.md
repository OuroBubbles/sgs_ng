# 27 · 武将目录与主动技能

更新：2026-10-17。默认单机接入首批三名武将和正式主动发动入口。后续已实现弃置查询与十八武将，见 [28](28-discard-martial-generals.md) / [29](29-wei-judgment-effects.md) / [30](30-strategists-private-pools.md) / [31](31-commanders-phase-replacement.md) / [32](32-benevolence-supply-rescue.md) / [33](33-wu-recovery-history.md)。完整标准武将与复杂技能仍未完成。

## 当前内容与版本

| 武将   | 势力 / 性别 / 基础体力 | 技能                                                                                                 |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 关羽   | 蜀 / 男 / 4            | 武圣：一张红色手牌或装备当杀使用或打出                                                               |
| 黄盖   | 吴 / 男 / 4            | 苦肉：失去 1 点体力，存活后摸两张牌，不限次数                                                        |
| 孙尚香 | 吴 / 女 / 3            | 枭姬：每失去一张装备区牌，可摸两张；结姻：阶段限一次，弃两张手牌，令受伤的其他男性角色与自己各回复 1 |

依据本地 FreeKill 的[标准武将表](../freekill/packages/standard/pkg/init.lua)、[苦肉](../freekill/packages/standard/pkg/skills/kurou.lua)、[结姻](../freekill/packages/standard/pkg/skills/jieyin.lua)、[枭姬](../freekill/packages/standard/pkg/skills/xiaoji.lua)；男性包含双性，依据 [Player.isMale](../freekill/packages/freekill-core/ltk/core/player.lua)。没有混入界限突破版本，没有导入参考源码或美术；普通构建和测试不读取参考项目。

主控仍是甲席，当前开局可选二十五名武将（观星/空城见 [37](37-arrangement-astrology.md)）；AI 席位默认使用固定循环预设，也可统一指定武将；可重复武将，尚无抽将、选将草稿或隐藏武将模式。手动演练保留原无武将机制角色、交替性别与甲席武圣，指定牌型场景与真实武将内容验证分开。主公体力奖励与主公技初始授予由身份模式负责。

## 定义与局内状态

[GeneralDefinition / GeneralBook](../src/rules/characters/general.ts) 保存 ID、名称、势力、性别、基础体力与技能 ID。目录拒绝重复武将、非法数值和未登记技能，定义深冻结，不保存局内血量或次数。

RoleMatch 玩家可以指定 `{ id, general }`，不能同时用 maxHp/gender/skills 隐式覆盖武将目录。机制夹具仍可以不带 general。整个目录与选中引用在创建 Room 之前校验；初始化同步提交选将 ID 和性别，再按武将 ID 授予技能来源。`generalOf(world, owner)` 从事实状态读取选将，展示用目录解释名称与势力。当前没有换将、双将或武将来源撤销协议；事实重建不恢复挂起执行。

## 主动技能是普通流程

`SkillDefinition.active` 为动作列表，每项有 id、label、纯 available 和普通 run；同技能内部动作 ID 不可重复，名称与说明属于 SkillDefinition。

```ts
active: [
  {
    id: 'action',
    label: '技能名',
    available(ctx, self, phase, book) {
      return true; // 只查询资格，不写状态或弹选择。
    },
    async run(ctx, self, phase, book) {
      // 自由组织选择、pay、领域操作、后续选择、分支与循环。
      // book 提供语义用牌和查询服务，phase 提供阶段生存期。
    },
  },
];
```

[activeOffers / validateActive / activate](../src/rules/skills/active.ts) 统一检查：本人技能实例、有效来源、当前正在执行的出牌阶段、所属 World 与 scope、存活、回合与游戏未结束。嵌套阶段不能借用外层阶段；阶段开始前、已关闭阶段或失效技能不能发动。available 在纯查询守卫中执行，点击不支付、不记次数。

动作进入独立 `skill.active` 子流程，再查资格后调用 run。作者继续使用 JointSelection、pay、draw、loseHp、recover、CardBook 等普通 API。没有要求所有技能先选固定张数，也不把技能伪装成用牌或零材料转换；闭包与 await 保留。

主持侧统一请求 `play-action`，原 `play-card` 名称已移除，无兼容别名。用牌回复 `{ choice, targets }`，仍走 CardBook 的规则；主动回复 `{ skill: instanceId, action: actionId }`，actor 和 phase 由主持侧固定，不接受执行闭包。主动候选明确为 `kind: 'active'`。界面先选择技能并确认，之后由技能代码开放后续选择；苦肉无材料，结姻另开可取消的联合选择。取消结姻回到出牌入口，取消 play-action 结束出牌阶段。

## 三个流程约束

苦肉先宣告，再经 loseHp 完整执行失去体力、濒死、救援与死亡。救援成功后才摸两张，死亡或终局后不摸；不添加每阶段一次的假限制。基础 AI 仅在体力大于 2 且手牌不足 6 张时考虑发动。

结姻不要求本人受伤。动态选择两张当前手牌与一名受伤的其他男性角色；支付前复用同一模型最终校验。弃牌、次数和宣告同次提交，次数绑定技能实例与阶段生存期，重复出牌阶段分别计数。支付后依次回复目标、来源，各自读取当前存活状态；目标死亡或技能失去不退款，也不取消已经宣告的剩余效果。

枭姬用移牌前后区域快照计算实际失去装备的数量，装备区内部重排不算失去。批量离场固定本次次数，逐次询问；每次继续前重查存活与技能。首轮摸牌后失去技能会停止后续询问，不以当前装备数量倒推次数，不重新解释后续嵌套移动。

实现见 [generals.ts](../src/content/standard/generals.ts)，只依赖公开 SDK。结姻已接入统一弃置查询与 payDiscard，详见 [28](28-discard-martial-generals.md)。基础 AI 只专门识别苦肉、结姻，未宣称通用主动技能策略完成；未知可选动作允许放弃，自定义必选决策仍明确报告不支持。

## 验证

[14 项新增场景](../tests/scenarios/active-skills.test.ts) 覆盖装备派生主动与离场、目录/冻结、零牌主动、技能所属与阶段/嵌套/失效边界、苦肉重复与濒死、结姻取消/费用/性别/次数/后效、枭姬逐件离场、选将事实重建及三武将真实四席 AI 至胜负。

[浏览器](../tests/browser/client.spec.ts) 在桌面与触屏分别验证黄盖连续苦肉及真实血量/手牌变化；孙尚香经过 AI 实际行动，再验证取消、两张手牌支付、回复与次数。不向画面注入已伤角色或直接写胜负。Windows 原生脚本另覆盖正式选黄盖和实际苦肉。结果见 [STATUS](STATUS.md)。

后续继续补齐标准武将、更多牌面查询、复杂主动技能与选择模型、内容包登记和完整离线模式。Android 仍等桌面版完成后开展。
