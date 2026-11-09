# 标准规则裁定

本页记录标准＋EX 内容在本项目中的规则裁定，以及锁定每条裁定的场景测试。实现以 [武将](../src/content/standard/generals/)、[牌](../src/content/standard/cards/)（一牌一文件，说明随定义）与 [实体牌表](../src/content/standard/deck.ts) 为准；技能文本只写在内容源码里，不在别处复制。

FreeKill / noname 只作为本地参考分别查阅，不把不同项目、不同模式的文本拼成一套规则；它们也不代表上游最新版本。覆盖的证据是行为测试本身：通用机制证明与具体声明证明分开保留（武圣不能借龙胆的额度场景，无中生有不能借决斗的反制记录）。

## 武将与技能

下表是标准 26 将 / 42 技能在本项目的裁定，右列是锁定该行为的场景测试。重新授予、计次、失效、死亡与嵌套等共同边界另见 [skill-identity](../tests/scenarios/skill-identity.test.ts) 与 [occurrences](../tests/scenarios/occurrences.test.ts)。

| 武将   | 技能与项目采用的基线                                                                                                                                                     | 专项证据入口                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 关羽   | 武圣：红色手牌/装备作杀，真实距离/次数/支付保留                                                                                                                          | [转换](../tests/scenarios/view-as.test.ts)、[当前牌面](../tests/scenarios/card-faces.test.ts)                                                                      |
| 黄盖   | 苦肉：不限次数，失去体力先完整救援，存活才摸二                                                                                                                           | [主动技能](../tests/scenarios/active-skills.test.ts)、[生命](../tests/scenarios/life.test.ts)                                                                      |
| 孙尚香 | 结姻：每阶段一次，两手牌费用、受伤的其他男性；枭姬：每张失去的装备独立机会                                                                                               | [主动技能](../tests/scenarios/active-skills.test.ts)、[身份](../tests/scenarios/skill-identity.test.ts)、[次数](../tests/scenarios/occurrences.test.ts)            |
| 赵云   | 龙胆：手牌杀/闪互转，继续经过统一使用或响应                                                                                                                              | [武将转换](../tests/scenarios/martial-generals.test.ts)、[牌面](../tests/scenarios/card-faces.test.ts)                                                             |
| 张飞   | 咆哮：杀次数无限，距离与目标要求仍保留                                                                                                                                   | [武将转换](../tests/scenarios/martial-generals.test.ts)                                                                                                            |
| 甘宁   | 奇袭：黑色手牌/装备作拆，权限与当前材料重查                                                                                                                              | [武将转换](../tests/scenarios/martial-generals.test.ts)、[弃置权限](../tests/scenarios/discard.test.ts)                                                            |
| 夏侯惇 | 刚烈：每次伤害一次，非红桃后来源弃二手牌或受伤                                                                                                                           | [魏将](../tests/scenarios/wei-generals.test.ts)                                                                                                                    |
| 许褚   | 裸衣：阶段少摸一；本人用杀/决斗的直接伤害增加，独立回合效果                                                                                                              | [魏将](../tests/scenarios/wei-generals.test.ts)、[伤害身份](../tests/scenarios/skill-identity.test.ts)                                                             |
| 甄姬   | 洛神：准备阶段重复黑判取得；倾国：黑色手牌作闪                                                                                                                           | [魏将](../tests/scenarios/wei-generals.test.ts)、[准备顺序](../tests/scenarios/occurrences.test.ts)                                                                |
| 司马懿 | 鬼才：手牌实际打出改判；反馈：来源手牌/装备，自伤只选装备                                                                                                                | [谋士](../tests/scenarios/strategists.test.ts)、[响应主体](../tests/scenarios/response-boundaries.test.ts)、[判定牌面](../tests/scenarios/card-faces.test.ts)      |
| 郭嘉   | 天妒：取得仍在处理区的最终判定牌；遗计：每伤害点看二并任意分配                                                                                                           | [谋士](../tests/scenarios/strategists.test.ts)、[逐次发动](../tests/scenarios/occurrences.test.ts)、[护盾量](../tests/scenarios/shield.test.ts)                    |
| 曹操   | 奸雄：本次伤害牌全部材料仍在处理区才可取得；护驾：实际魏角色供闪，身份模式只授予主公                                                                                     | [主公与替代](../tests/scenarios/commanders.test.ts)、[行动序](../tests/scenarios/action-order.test.ts)                                                             |
| 张辽   | 突袭：替代默认摸牌体，按座次暗取一至两人各一张，不是跳阶段                                                                                                               | [主公与替代](../tests/scenarios/commanders.test.ts)                                                                                                                |
| 刘备   | 仁德：每出牌阶段首次累计二张回复；激将：蜀角色供杀，使用者与打出者分开                                                                                                   | [仁德/供牌](../tests/scenarios/benevolence.test.ts)、[身份](../tests/scenarios/skill-identity.test.ts)、[响应主体](../tests/scenarios/response-boundaries.test.ts) |
| 华佗   | 青囊：每阶段一次，一手牌治疗受伤角色；急救：本人回合外红牌作桃使用                                                                                                       | [仁德/供牌](../tests/scenarios/benevolence.test.ts)、[身份](../tests/scenarios/skill-identity.test.ts)、[生命](../tests/scenarios/life.test.ts)                    |
| 孙权   | 制衡：每阶段一次，弃手牌/装备摸等量；救援：其他当前吴势力使用桃，回复加一                                                                                                | [吴将](../tests/scenarios/wu-generals.test.ts)、[身份](../tests/scenarios/skill-identity.test.ts)                                                                  |
| 吕蒙   | 克己：只统计本回合实际本人出牌阶段中本人使用/打出的杀                                                                                                                    | [吴将](../tests/scenarios/wu-generals.test.ts)、[本批领域归属](../tests/scenarios/activity-periods.test.ts)                                                        |
| 陆逊   | 谦逊：不能被选为顺手/乐目标；连营：批量失去最后手牌一次机会                                                                                                              | [吴将](../tests/scenarios/wu-generals.test.ts)                                                                                                                     |
| 黄月英 | 集智：非转化普通锦囊；奇才：锦囊豁免距离，保留其他目标条件                                                                                                               | [目标与谋将](../tests/scenarios/tacticians.test.ts)                                                                                                                |
| 吕布   | 无双：本人杀要求两闪，决斗对方每次两杀，要求按效果身份固定                                                                                                               | [目标与谋将](../tests/scenarios/tacticians.test.ts)、[响应中止](../tests/scenarios/response-boundaries.test.ts)                                                    |
| 大乔   | 国色：方块手牌/装备作乐；流离：费用与转移意图同次提交，弃装备后重算范围                                                                                                  | [目标与谋将](../tests/scenarios/tacticians.test.ts)、[目标四层](../tests/scenarios/target-stages.test.ts)                                                          |
| 马超   | 马术：本人距离减一；铁骑：红判禁止本次杀的闪响应，供牌/八卦不绕过                                                                                                        | [谋略与响应禁令](../tests/scenarios/intrigue.test.ts)                                                                                                              |
| 周瑜   | 英姿：阶段多摸一；反间：每阶段一次，目标猜花色、暗选公开取得后比较当前花色                                                                                               | [谋略](../tests/scenarios/intrigue.test.ts)、[移动后牌面](../tests/scenarios/card-faces.test.ts)                                                                   |
| 貂蝉   | 离间：每阶段一次，手牌/装备费用，后选男性对先选男性使用不可无懈决斗；闭月：结束阶段摸一                                                                                  | [谋略](../tests/scenarios/intrigue.test.ts)、[身份](../tests/scenarios/skill-identity.test.ts)                                                                     |
| 诸葛亮 | 观星：存活数至多五，牌顶/底各自有序；空城：空手禁止杀/决斗选为目标                                                                                                       | [观星](../tests/scenarios/astrology.test.ts)、[准备顺序](../tests/scenarios/occurrences.test.ts)                                                                   |
| 刘禅   | 享乐：成为杀的目标后，使用者弃一张基本牌，否则此杀对其无效；放权：跳过出牌阶段，回合结束时可弃一张手牌令其他角色获得额外回合（排在当前轮内，不移动正常轮转）；若愚未实现 | [刘禅](../tests/scenarios/liushan.test.ts)、[轮与额外回合](../tests/scenarios/rounds-and-marks.test.ts)                                                            |

## 牌

实体表为标准＋EX 108 张、32 种定义（[deck.ts](../src/content/standard/deck.ts)）。同类坐骑分别列出；机制练习牌组不是标准实体表。

| 牌         | 需核对的具体语义                                                      | 专项证据入口                                                                                                      |
| ---------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 杀         | 距离/阶段次数、目标身份、完整闪响应/伤害、材料善后                    | [用牌](../tests/scenarios/use-card.test.ts)、[目标四层](../tests/scenarios/target-stages.test.ts)                 |
| 闪         | 只进入当前响应用途，独立支付与打出完成事实                            | [响应用途](../tests/scenarios/armor-response.test.ts)、[响应边界](../tests/scenarios/response-boundaries.test.ts) |
| 桃         | 普通自救/指定濒死者、实际回复裁剪与材料清理                           | [生命](../tests/scenarios/life.test.ts)、[待决边界](../tests/scenarios/life-boundaries.test.ts)                   |
| 决斗       | 从目标轮流打杀、实际胜方伤害、连续要求、局部中止                      | [锦囊](../tests/scenarios/tricks.test.ts)、[响应边界](../tests/scenarios/response-boundaries.test.ts)             |
| 无中生有   | 自己摸二，反制、洗牌后资格与当前牌序                                  | [锦囊](../tests/scenarios/tricks.test.ts)、[牌堆边界](../tests/scenarios/deck-boundaries.test.ts)                 |
| 无懈可击   | 针对一个目标效果/另一张无懈，嵌套反制层次                             | [反制](../tests/scenarios/counter.test.ts)、[响应禁令](../tests/scenarios/intrigue.test.ts)                       |
| 南蛮入侵   | 全部其他目标依次打杀，目标各自独立后效                                | [锦囊](../tests/scenarios/tricks.test.ts)、[目标四层](../tests/scenarios/target-stages.test.ts)                   |
| 万箭齐发   | 全部其他目标依次打闪，防具/供闪分别核对，不误用杀专属规则             | [锦囊](../tests/scenarios/tricks.test.ts)、[主公供牌](../tests/scenarios/commanders.test.ts)                      |
| 桃园结义   | 全体受伤目标回复，非受伤者不产生实际回复                              | [锦囊](../tests/scenarios/tricks.test.ts)、[回复](../tests/scenarios/wu-generals.test.ts)                         |
| 五谷丰登   | 按目标数公开池、逐目标选牌、剩余牌善后                                | [锦囊](../tests/scenarios/tricks.test.ts)                                                                         |
| 顺手牵羊   | 距离一，暗手牌/公开装备/逻辑判定牌选择与重查                          | [锦囊](../tests/scenarios/tricks.test.ts)、[延时牌](../tests/scenarios/delayed.test.ts)                           |
| 过河拆桥   | 效果弃置权限、暗选与逻辑延时牌整体                                    | [弃置](../tests/scenarios/discard.test.ts)、[锦囊](../tests/scenarios/tricks.test.ts)                             |
| 借刀杀人   | 宣告前选定目标元组 [持械者, 杀目标]、真实出杀或交当前武器、取消不支付 | [借刀](../tests/scenarios/collateral.test.ts)、[准备](../tests/scenarios/use-preparation.test.ts)                 |
| 乐不思蜀   | 其他目标判定区、无懈/红桃、跳本回合下个出牌阶段                       | [延时牌](../tests/scenarios/delayed.test.ts)、[额外回合](../tests/scenarios/extra-turns.test.ts)                  |
| 闪电       | 自身装入、黑桃二至九无来源雷伤、不命中/无懈传递                       | [延时牌](../tests/scenarios/delayed.test.ts)、[连环](../tests/scenarios/chains.test.ts)                           |
| 诸葛连弩   | 范围一，杀次数无限，作为材料时能力剔除                                | [装备](../tests/scenarios/equipment.test.ts)                                                                      |
| 雌雄双股剑 | 范围二，异性目标弃手牌或来源摸牌                                      | [双剑](../tests/scenarios/swords.test.ts)                                                                         |
| 青釭剑     | 范围二，仅当前杀效果忽略目标防具                                      | [防具](../tests/scenarios/armor-response.test.ts)、[目标四层](../tests/scenarios/target-stages.test.ts)           |
| 青龙偃月刀 | 范围三，闪后对同目标追加独立用杀，豁免距离/阶段次数                   | [武器](../tests/scenarios/weapons.test.ts)                                                                        |
| 丈八蛇矛   | 范围三，两手牌作杀，颜色与多材料实际支付                              | [装备](../tests/scenarios/equipment.test.ts)、[牌面](../tests/scenarios/card-faces.test.ts)                       |
| 贯石斧     | 范围三，弃二张其他牌突破防御，费用后效不撤销声明                      | [武器](../tests/scenarios/weapons.test.ts)                                                                        |
| 方天画戟   | 范围四，材料含全部非空手牌时至多额外两目标                            | [武器](../tests/scenarios/weapons.test.ts)                                                                        |
| 麒麟弓     | 范围五，直接杀伤害中弃目标当前合法坐骑                                | [武器](../tests/scenarios/weapons.test.ts)、[连环](../tests/scenarios/chains.test.ts)                             |
| 寒冰剑     | 范围二，防伤后依次重选目标至多二张可弃手牌/装备                       | [双剑](../tests/scenarios/swords.test.ts)、[连环](../tests/scenarios/chains.test.ts)                              |
| 八卦阵     | 判定供闪，红判生成响应；忽略防具和禁响应分别生效                      | [防具](../tests/scenarios/armor-response.test.ts)、[鬼才牌面](../tests/scenarios/card-faces.test.ts)              |
| 仁王盾     | 黑杀效果无效，颜色独立于花色，青釭按效果忽略                          | [防具](../tests/scenarios/armor-response.test.ts)                                                                 |
| 赤兔       | 进攻距离减一，作为材料不借用离场能力                                  | [装备](../tests/scenarios/equipment.test.ts)                                                                      |
| 大宛       | 同类进攻坐骑，与赤兔同槽而非额外叠加                                  | [装备](../tests/scenarios/equipment.test.ts)、[实体表](../tests/scenarios/deck.test.ts)                           |
| 紫骍       | 同类进攻坐骑，独立实体/目录身份                                       | [装备](../tests/scenarios/equipment.test.ts)、[实体表](../tests/scenarios/deck.test.ts)                           |
| 绝影       | 防御距离加一，失去后立即撤销                                          | [装备](../tests/scenarios/equipment.test.ts)                                                                      |
| 的卢       | 同类防御坐骑，与绝影同槽                                              | [装备](../tests/scenarios/equipment.test.ts)、[实体表](../tests/scenarios/deck.test.ts)                           |
| 爪黄飞电   | 同类防御坐骑，独立实体/目录身份                                       | [装备](../tests/scenarios/equipment.test.ts)、[实体表](../tests/scenarios/deck.test.ts)                           |

## 项目采用的规则语义

- 仁德以出牌阶段累计。FreeKill 使用 `_rende_cards-phase`，noname 说明使用“回合”措辞；本项目按 [仁德实现](../src/content/standard/generals/liubei.ts) 的明确阶段生存期与原子交牌累计处理，不从文本相似推断嵌套行为相同。
- 裸衣选择 FreeKill 的本人使用且本人造成直接伤害条件；noname 的 luoyi2 对杀/决斗非连环伤害判断更宽，且其临时技能到期点采用 phaseJieshuBegin。本项目当前按整个回合的持续效果（回合标记）处理。
- 方天选择“材料包含全部非空手牌”，和 FreeKill 当前代码一致；不能仅按 noname“最后手牌”短句推断多材料或零材料分支。
- 天妒的公共判定结束机会先于洛神的本次判定后续；最终牌若已被取得，后者不抢回。判定最终快照与当前牌面分开。
- 抵消杀时使用闪，万箭齐发要求打出闪；用途、禁令、完成时点、转换和委托材料交接见 [response-purpose 场景](../tests/scenarios/response-purpose.test.ts)。参考为 FreeKill 的 `SlashOffsetFunc`、`archery_attack.lua` 与 noname 的 `chooseToUse`；用途区别不只是事实名称。
- 铁骑的具名响应禁令、混合请求过滤和唯一供牌窗口收束见 [named-response-blocks 场景](../tests/scenarios/named-response-blocks.test.ts)。复杂替代额度仍需按具体规则验证，不把标准分支推广到所有内容。
- 身份胜负选择死亡后效/埋葬完成后判胜，未终局才执行击杀奖惩；这属于已声明的项目基线，不宣称逐时点复制两个参考实现。

待决资格分别由 [判定](../tests/scenarios/judgment-boundaries.test.ts)、[反制](../tests/scenarios/counter-boundaries.test.ts)、[目标](../tests/scenarios/target-window-boundaries.test.ts) 与 [内层效果](../tests/scenarios/counter-effect-eligibility.test.ts) 场景锁定。检查发生在候选与结果封口边界，不让普通异步函数在任意位置自动中断。

## 活动的领域归属

因果后代不等于实际活动领域。统计本回合或本人出牌阶段的行为时，不能仅凭祖先 scopePath 把嵌套回合、其他阶段或边界动作混入。

[cardActivities](../src/rules/cards/activity.ts) 接收完整、有序的事实列表，返回原始 scopePath、宣告当时的 turnId 与 phase `{ id, owner, kind }`，没有对应的实际活动领域时为 null。按有序的 turn.started、phase.before、phase.started、lifetime.ended 事实解析最近边界：

- 内层回合阻止继承暂停的外层阶段；内层阶段尚未开始或已结束时，也不会穿透到外层阶段。
- 出牌阶段开始前和生存期结束后的用牌没有活动阶段；回合结束后的后效也不伪装成仍在回合内。
- 普通 Flow 即使命名为 play 或 turn，也不是领域开始事实。
- 结束事实只改变之后的归属，不能修改已经发生的活动。查询返回冻结数据，可直接由事实列表重建，不需要 HistoryReader、当前 World、Scope 活对象或可恢复的协程。
- withinScope 仍只表示因果后代过滤。祖先开始记录可能在过滤范围之外，因此传入完整事实列表，由查询解析边界后返回该因果范围的活动，不能预先裁掉祖先记录。

克己只选择实际 turnId 等于本回合、实际 phase 为本人 play、实际使用/打出者为本人的杀；真正嵌套在本回合内的出牌阶段仍计入，嵌套其他回合则不计入。普通响应和鬼才改判的打出都保留真实主体。

[活动归属场景](../tests/scenarios/activity-periods.test.ts)覆盖内外回合与阶段恢复、普通响应、鬼才改判、独立阶段与根用牌、普通命名 Flow、关闭边界、窄因果查询及纯事实历史。
