# 53 · 标准目录与活动的领域归属

更新：2026-10-18。本批为已实现的标准＋EX 目录建立逐项核对入口，并修正克己将嵌套回合、非出牌阶段及阶段边界动作混入本回合统计的问题。目录不是完成证明；完整离线验收继续按 [路线](11-offline-roadmap.md) 推进。

## 先固定来源，再判断行为

```sh
pnpm audit:standard
```

[审阅工具](../scripts/audit-standard.mjs) 只读取当前项目与本地 freekill/noname，通过 TypeScript AST 和 Lua 字面文本生成 `.artifacts/validation/standard-semantics-inventory.json`。报告包含当前 25 名武将的技能装配、40 个技能和 32 种牌的项目说明、两份参考说明、源码位置以及输入文件 SHA-256。该批初次清单为 standard@0.1.11，共记录 101 个输入文件。报告随每次显式执行刷新，以报告实际版本和输入哈希为准。

工具不执行参考代码，不自动导入它们的架构，也不判断文本等价或技能分支已经通过。报告明确标记 static-reference-inventory 与 behaviorVerified=false；常规构建、测试不读取参考项目。坐骑只解析本目录明确的 horse 工厂调用，不尝试解释任意作者函数。

后续 [63](63-standard-behavior-review.md) 开始逐条条件与具名断言的人工绑定，[64](64-standard-skills-review.md) 补齐技能，[65](65-standard-card-review.md) 再补齐 32 种牌，合计 72 对象、172 条条件、480 条去重通过断言。`pnpm audit:standard:behavior --complete` 当前通过有限清单的完整登记，仍不证明所有分支或完整离线产品验收，不与本页的静态参考清单混同。

规则依据优先读取项目实际定义与说明；参考分别记录，不能把不同项目、不同模式的文本拼成一套规则。当前目录见 [武将/技能装配](../src/content/standard/generals.ts)、[牌定义](../src/content/standard/cards.ts)、[实体牌表](../src/content/standard/deck.ts) 与 [牌面说明](../src/content/standard/presentation.ts)。本地参考入口为 [FreeKill 标准文本](../freekill/packages/standard/i18n/zh_CN.lua)、[牌文本](../freekill/packages/standard_cards/i18n/zh_CN.lua)、[noname 标准文本](../noname/resources/app/character/standard/translate.js) 与 [牌包](../noname/resources/app/card/standard.js)。它们不代表上游最新版本。

## 武将目录：基线与行为证据入口

下表登记现有目录的完整 25 将/40 技能。专项链接用于继续逐条阅读断言，不能仅凭文件存在或一局完成就关闭整项审计。共同的重新授予、计次、失效、死亡、嵌套边界还需结合 [身份审计](42-skill-identity-audit.md)、[有限次数](38-window-occurrences.md) 与相关机制场景。

| 武将   | 技能与项目采用的基线                                                                    | 专项证据入口                                                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 关羽   | 武圣：红色手牌/装备作杀，真实距离/次数/支付保留                                         | [转换](../tests/scenarios/view-as.test.ts)、[当前牌面](../tests/scenarios/card-faces.test.ts)                                                                      |
| 黄盖   | 苦肉：不限次数，失去体力先完整救援，存活才摸二                                          | [主动技能](../tests/scenarios/active-skills.test.ts)、[生命](../tests/scenarios/life.test.ts)                                                                      |
| 孙尚香 | 结姻：每阶段一次，两手牌费用、受伤的其他男性；枭姬：每张失去的装备独立机会              | [主动技能](../tests/scenarios/active-skills.test.ts)、[身份](../tests/scenarios/skill-identity.test.ts)、[次数](../tests/scenarios/occurrences.test.ts)            |
| 赵云   | 龙胆：手牌杀/闪互转，继续经过统一使用或响应                                             | [武将转换](../tests/scenarios/martial-generals.test.ts)、[牌面](../tests/scenarios/card-faces.test.ts)                                                             |
| 张飞   | 咆哮：杀次数无限，距离与目标要求仍保留                                                  | [武将转换](../tests/scenarios/martial-generals.test.ts)                                                                                                            |
| 甘宁   | 奇袭：黑色手牌/装备作拆，权限与当前材料重查                                             | [武将转换](../tests/scenarios/martial-generals.test.ts)、[弃置权限](../tests/scenarios/discard.test.ts)                                                            |
| 夏侯惇 | 刚烈：每次伤害一次，非红桃后来源弃二手牌或受伤                                          | [魏将](../tests/scenarios/wei-generals.test.ts)                                                                                                                    |
| 许褚   | 裸衣：阶段少摸一；本人用杀/决斗的直接伤害增加，独立回合效果                             | [魏将](../tests/scenarios/wei-generals.test.ts)、[伤害身份](../tests/scenarios/skill-identity.test.ts)                                                             |
| 甄姬   | 洛神：准备阶段重复黑判取得；倾国：黑色手牌作闪                                          | [魏将](../tests/scenarios/wei-generals.test.ts)、[准备顺序](../tests/scenarios/occurrences.test.ts)                                                                |
| 司马懿 | 鬼才：手牌实际打出改判；反馈：来源手牌/装备，自伤只选装备                               | [谋士](../tests/scenarios/strategists.test.ts)、[响应主体](../tests/scenarios/response-boundaries.test.ts)、[判定牌面](../tests/scenarios/card-faces.test.ts)      |
| 郭嘉   | 天妒：取得仍在处理区的最终判定牌；遗计：每伤害点看二并任意分配                          | [谋士](../tests/scenarios/strategists.test.ts)、[逐次发动](../tests/scenarios/occurrences.test.ts)、[护盾量](../tests/scenarios/shield.test.ts)                    |
| 曹操   | 奸雄：本次伤害牌全部材料仍在处理区才可取得；护驾：实际魏角色供闪，身份模式只授予主公    | [主公与替代](../tests/scenarios/commanders.test.ts)、[行动序](../tests/scenarios/action-order.test.ts)                                                             |
| 张辽   | 突袭：替代默认摸牌体，按座次暗取一至两人各一张，不是跳阶段                              | [主公与替代](../tests/scenarios/commanders.test.ts)                                                                                                                |
| 刘备   | 仁德：每出牌阶段首次累计二张回复；激将：蜀角色供杀，使用者与打出者分开                  | [仁德/供牌](../tests/scenarios/benevolence.test.ts)、[身份](../tests/scenarios/skill-identity.test.ts)、[响应主体](../tests/scenarios/response-boundaries.test.ts) |
| 华佗   | 青囊：每阶段一次，一手牌治疗受伤角色；急救：本人回合外红牌作桃使用                      | [仁德/供牌](../tests/scenarios/benevolence.test.ts)、[身份](../tests/scenarios/skill-identity.test.ts)、[生命](../tests/scenarios/life.test.ts)                    |
| 孙权   | 制衡：每阶段一次，弃手牌/装备摸等量；救援：其他当前吴势力使用桃，回复加一               | [吴将](../tests/scenarios/wu-generals.test.ts)、[身份](../tests/scenarios/skill-identity.test.ts)                                                                  |
| 吕蒙   | 克己：只统计本回合实际本人出牌阶段中本人使用/打出的杀                                   | [吴将](../tests/scenarios/wu-generals.test.ts)、[本批领域归属](../tests/scenarios/activity-periods.test.ts)                                                        |
| 陆逊   | 谦逊：不能被选为顺手/乐目标；连营：批量失去最后手牌一次机会                             | [吴将](../tests/scenarios/wu-generals.test.ts)                                                                                                                     |
| 黄月英 | 集智：非转化普通锦囊；奇才：锦囊豁免距离，保留其他目标条件                              | [目标与谋将](../tests/scenarios/tacticians.test.ts)                                                                                                                |
| 吕布   | 无双：本人杀要求两闪，决斗对方每次两杀，要求按效果身份固定                              | [目标与谋将](../tests/scenarios/tacticians.test.ts)、[响应中止](../tests/scenarios/response-boundaries.test.ts)                                                    |
| 大乔   | 国色：方块手牌/装备作乐；流离：费用与转移意图同次提交，弃装备后重算范围                 | [目标与谋将](../tests/scenarios/tacticians.test.ts)、[目标四层](../tests/scenarios/target-stages.test.ts)                                                          |
| 马超   | 马术：本人距离减一；铁骑：红判禁止本次杀的闪响应，供牌/八卦不绕过                       | [谋略与响应禁令](../tests/scenarios/intrigue.test.ts)                                                                                                              |
| 周瑜   | 英姿：阶段多摸一；反间：每阶段一次，目标猜花色、暗选公开取得后比较当前花色              | [谋略](../tests/scenarios/intrigue.test.ts)、[移动后牌面](../tests/scenarios/card-faces.test.ts)                                                                   |
| 貂蝉   | 离间：每阶段一次，手牌/装备费用，后选男性对先选男性使用不可无懈决斗；闭月：结束阶段摸一 | [谋略](../tests/scenarios/intrigue.test.ts)、[身份](../tests/scenarios/skill-identity.test.ts)                                                                     |
| 诸葛亮 | 观星：存活数至多五，牌顶/底各自有序；空城：空手禁止杀/决斗选为目标                      | [观星](../tests/scenarios/astrology.test.ts)、[准备顺序](../tests/scenarios/occurrences.test.ts)                                                                   |

## 牌目录：每种定义的核对入口

实体表仍为标准＋EX 108 张，32 种定义；实体多重集的本地参考核对见 [23](23-swords-standard-deck.md)。下表没有把三个同类坐骑合成一个已实现定义，也不把机制练习牌组当标准实体表。

| 牌         | 需核对的具体语义                                          | 专项证据入口                                                                                                      |
| ---------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 杀         | 距离/阶段次数、目标身份、完整闪响应/伤害、材料善后        | [用牌](../tests/scenarios/use-card.test.ts)、[目标四层](../tests/scenarios/target-stages.test.ts)                 |
| 闪         | 只进入当前响应用途，独立支付与打出完成事实                | [响应用途](../tests/scenarios/armor-response.test.ts)、[响应边界](../tests/scenarios/response-boundaries.test.ts) |
| 桃         | 普通自救/指定濒死者、实际回复裁剪与材料清理               | [生命](../tests/scenarios/life.test.ts)、[待决边界](../tests/scenarios/life-boundaries.test.ts)                   |
| 决斗       | 从目标轮流打杀、实际胜方伤害、连续要求、局部中止          | [锦囊](../tests/scenarios/tricks.test.ts)、[响应边界](../tests/scenarios/response-boundaries.test.ts)             |
| 无中生有   | 自己摸二，反制、洗牌后资格与当前牌序                      | [锦囊](../tests/scenarios/tricks.test.ts)、[牌堆边界](../tests/scenarios/deck-boundaries.test.ts)                 |
| 无懈可击   | 针对一个目标效果/另一张无懈，嵌套反制层次                 | [反制](../tests/scenarios/counter.test.ts)、[响应禁令](../tests/scenarios/intrigue.test.ts)                       |
| 南蛮入侵   | 全部其他目标依次打杀，目标各自独立后效                    | [锦囊](../tests/scenarios/tricks.test.ts)、[目标四层](../tests/scenarios/target-stages.test.ts)                   |
| 万箭齐发   | 全部其他目标依次打闪，防具/供闪分别核对，不误用杀专属规则 | [锦囊](../tests/scenarios/tricks.test.ts)、[主公供牌](../tests/scenarios/commanders.test.ts)                      |
| 桃园结义   | 全体受伤目标回复，非受伤者不产生实际回复                  | [锦囊](../tests/scenarios/tricks.test.ts)、[回复](../tests/scenarios/wu-generals.test.ts)                         |
| 五谷丰登   | 按目标数公开池、逐目标选牌、剩余牌善后                    | [锦囊](../tests/scenarios/tricks.test.ts)                                                                         |
| 顺手牵羊   | 距离一，暗手牌/公开装备/逻辑判定牌选择与重查              | [锦囊](../tests/scenarios/tricks.test.ts)、[延时牌](../tests/scenarios/delayed.test.ts)                           |
| 过河拆桥   | 效果弃置权限、暗选与逻辑延时牌整体                        | [弃置](../tests/scenarios/discard.test.ts)、[锦囊](../tests/scenarios/tricks.test.ts)                             |
| 借刀杀人   | 宣告前附属目标、真实出杀或交当前武器、取消不支付          | [借刀](../tests/scenarios/collateral.test.ts)、[准备](../tests/scenarios/use-preparation.test.ts)                 |
| 乐不思蜀   | 其他目标判定区、无懈/红桃、跳本回合下个出牌阶段           | [延时牌](../tests/scenarios/delayed.test.ts)、[额外回合](../tests/scenarios/extra-turns.test.ts)                  |
| 闪电       | 自身装入、黑桃二至九无来源雷伤、不命中/无懈传递           | [延时牌](../tests/scenarios/delayed.test.ts)、[连环](../tests/scenarios/chains.test.ts)                           |
| 诸葛连弩   | 范围一，杀次数无限，作为材料时能力剔除                    | [装备](../tests/scenarios/equipment.test.ts)                                                                      |
| 雌雄双股剑 | 范围二，异性目标弃手牌或来源摸牌                          | [双剑](../tests/scenarios/swords.test.ts)                                                                         |
| 青釭剑     | 范围二，仅当前杀效果忽略目标防具                          | [防具](../tests/scenarios/armor-response.test.ts)、[目标四层](../tests/scenarios/target-stages.test.ts)           |
| 青龙偃月刀 | 范围三，闪后对同目标追加独立用杀，豁免距离/阶段次数       | [武器](../tests/scenarios/weapons.test.ts)                                                                        |
| 丈八蛇矛   | 范围三，两手牌作杀，颜色与多材料实际支付                  | [装备](../tests/scenarios/equipment.test.ts)、[牌面](../tests/scenarios/card-faces.test.ts)                       |
| 贯石斧     | 范围三，弃二张其他牌突破防御，费用后效不撤销声明          | [武器](../tests/scenarios/weapons.test.ts)                                                                        |
| 方天画戟   | 范围四，材料含全部非空手牌时至多额外两目标                | [武器](../tests/scenarios/weapons.test.ts)                                                                        |
| 麒麟弓     | 范围五，直接杀伤害中弃目标当前合法坐骑                    | [武器](../tests/scenarios/weapons.test.ts)、[连环](../tests/scenarios/chains.test.ts)                             |
| 寒冰剑     | 范围二，防伤后依次重选目标至多二张可弃手牌/装备           | [双剑](../tests/scenarios/swords.test.ts)、[连环](../tests/scenarios/chains.test.ts)                              |
| 八卦阵     | 判定供闪，红判生成响应；忽略防具和禁响应分别生效          | [防具](../tests/scenarios/armor-response.test.ts)、[鬼才牌面](../tests/scenarios/card-faces.test.ts)              |
| 仁王盾     | 黑杀效果无效，颜色独立于花色，青釭按效果忽略              | [防具](../tests/scenarios/armor-response.test.ts)                                                                 |
| 赤兔       | 进攻距离减一，作为材料不借用离场能力                      | [装备](../tests/scenarios/equipment.test.ts)                                                                      |
| 大宛       | 同类进攻坐骑，与赤兔同槽而非额外叠加                      | [装备](../tests/scenarios/equipment.test.ts)、[实体表](../tests/scenarios/deck.test.ts)                           |
| 紫骍       | 同类进攻坐骑，独立实体/目录身份                           | [装备](../tests/scenarios/equipment.test.ts)、[实体表](../tests/scenarios/deck.test.ts)                           |
| 绝影       | 防御距离加一，失去后立即撤销                              | [装备](../tests/scenarios/equipment.test.ts)                                                                      |
| 的卢       | 同类防御坐骑，与绝影同槽                                  | [装备](../tests/scenarios/equipment.test.ts)、[实体表](../tests/scenarios/deck.test.ts)                           |
| 爪黄飞电   | 同类防御坐骑，独立实体/目录身份                           | [装备](../tests/scenarios/equipment.test.ts)、[实体表](../tests/scenarios/deck.test.ts)                           |

## 已明确的版本选择与仍需关闭的边界

- 仁德以出牌阶段累计。FreeKill 使用 `_rende_cards-phase`，noname 说明使用“回合”措辞；本项目按 [仁德实现](../src/content/standard/benevolence.ts) 的明确阶段生存期与原子交牌累计处理，不从文本相似推断嵌套行为相同。
- 裸衣选择 FreeKill 的本人使用且本人造成直接伤害条件；noname 的 luoyi2 对杀/决斗非连环伤害判断更宽，且其临时技能到期点采用 phaseJieshuBegin。本项目当前按整个回合的独立效果处理，详见 [42](42-skill-identity-audit.md)。
- 方天选择“材料包含全部非空手牌”，和 FreeKill 当前代码一致；不能仅按 noname“最后手牌”短句推断多材料或零材料分支。
- 天妒的公共判定结束机会先于洛神的本次判定后续；最终牌若已被取得，后者不抢回，详见 [29](29-wei-judgment-effects.md) 与谋士专项。判定最终快照与当前牌面分开，见 [50](50-card-faces.md)。
- 该批标准闪统一走打出管线，后续 [55](55-response-purpose.md) 已区分抵消杀时使用与万箭要求打出，并验证独立禁令、完成时点、转换和委托材料交接。依据为：[FreeKill 的 SlashOffsetFunc](../freekill/lua/core/util.lua) 明确 askToUseCard/useCard，[万箭齐发](../freekill/packages/standard_cards/pkg/skills/archery_attack.lua) 则 askToResponse/responseCard；noname 的杀也走 chooseToUse。修复包含完整使用流程，不仅更换事实名称。
- 该批铁骑以效果级禁止响应实现，标准杀只要求闪；后续 [54](54-named-response-blocks.md) 已补具名禁止、混合请求过滤和唯一供牌窗口收束。复杂替代额度仍需单独验证，不能把当前标准分支通过推广到所有作者扩展。
- 身份胜负选择死亡后效/埋葬完成后判胜，未终局才执行击杀奖惩；这属于已声明的项目基线，见 [15](15-life-role-match.md)，不宣称逐时点复制两个参考实现。

上述表格是完整目录索引，下一轮仍需逐项将每条文本条件与具名断言关联，登记缺失的反例和差异处理。完整标准审计、长期独立效果、复杂选择与独立资源交付尚未完成，也没有因此缩小离线版目标。

后续 [58](58-judgment-pending-windows.md) 补齐判定待决资格：翻牌/改判中判定者死亡或终局会收束同窗剩余候选，已交换材料不回滚，嵌套判定各自独立，完成后的事实不倒改。新增 18 项具名断言，包括实际八卦阵；这只关闭判定域的该组缺口，不把所有判定类技能的其他分支视为已覆盖。长期独立效果基础能力已在 [56](56-independent-effects.md) 接入，复杂组合仍需继续。

后续 [60](60-counter-pending-windows.md) 补齐反制开窗持续资格及结果封口检查：原目标死亡/终局/效果取消停止本窗剩余候选，嵌套返回后已失效的机会不再误记 unopposed。16 项具名断言分别保留已付费用、实际无懈的 by、来源死亡后的正常机会和公共完成后效，仍不能代替其他锦囊分支验收。

后续 [61](61-target-pending-windows.md) 补齐四层目标和效果启动同窗资格，51 项具名断言验证六种旧身份失效、来源死亡/局部中止的正常继续，以及真实流离、仁王盾、无懈、桃园和顺手/拆桥。目标声明不使用 canResolve，公共完成后效保留取消结果；作者在一个运行中的回调内部仍须重查 await 后的操作，未承诺任意位置自动中断。

后续 [62](62-counter-effect-eligibility.md) 补齐反制内部与实际 canResolve/目标禁令的持续关联，20 项具名断言覆盖桃园治满、顺手/拆桥失牌或来源死亡、动态禁止及两层无懈；正常决斗、延时后续 resolver 和封口后公共结果另有正例。共享普通纯函数，没有按标准牌名列特殊分支；其他标准分支仍需继续审计。

## 克己修复：因果包含不等于领域归属

旧实现查找本回合后代里的所有出牌阶段，再判断用牌事实路径是否包含其中之一。外层出牌阶段仍在原因链中时，嵌套回合、内层判定阶段甚至阶段开始前/结束后的杀都可能被误算，错误阻止克己。

[cardActivities](../src/rules/cards/activity.ts) 现在仍返回原始 scopePath，另给出宣告当时的 turnId 与 phase `{ id, owner, kind }`，没有对应的实际活动领域时为 null。按有序的 turn.started、phase.before、phase.started、lifetime.ended 事实解析最近边界：

- 内层回合阻止继承暂停的外层阶段；内层阶段尚未开始或已结束时，也不会穿透到外层阶段。
- 出牌阶段开始前和生存期结束后的用牌没有活动阶段；回合结束后的后效也不伪装成仍在回合内。
- 普通 Flow 即使命名为 play 或 turn，也不是领域开始事实。
- 结束事实只改变之后的归属，不能修改已经发生的活动。查询返回冻结数据，可以从纯事实 HistoryReader 重建，不依赖当前 World、Scope 活对象或可恢复的协程。
- withinScope 仍只表示因果后代过滤。祖先开始记录可能在过滤范围之外，因此先从完整历史读取边界，再返回该因果范围的活动。

克己只选择实际 turnId 等于本回合、实际 phase 为本人 play、实际使用/打出者为本人的杀；真正嵌套在本回合内的出牌阶段仍计入，嵌套其他回合则不计入。普通响应和鬼才改判的打出都保留真实主体。

[18 项新增场景](../tests/scenarios/activity-periods.test.ts) 覆盖六个最初失败反例、内外回合/阶段恢复、普通响应、鬼才改判、独立阶段/根用牌、普通命名 Flow、关闭边界、窄因果查询、冻结快照与纯事实历史。原有吴将和额外回合 51 项专项继续通过，报告为 `.artifacts/validation/activity-periods-after.json`；修复前六项失败为 `activity-periods-before.json`。最初超距目标的夹具错误另存 `activity-periods-fixture-error.json`，未作为领域缺陷证据。

本批全部单元/行为 1178 项一次全量通过，其中规则/主持侧 1171 项；分类与原报告 SHA-256 见 `.artifacts/validation/activity-periods-core-coverage.json`，没有另做独立规则全量运行。标准整局 60 秒/2400 决策预算保持不变。桌面/触控浏览器 174 项全量通过，无跳过或重试通过；Windows Debug/Release 各 66 组实际 WebView2 检查及真实不同 PID 重启恢复通过，控制台无错误。新增历史归属分支由规则场景验证。发布 ZIP 4,617,175 字节，实际四个成员、exe/模块及原生证明独立核对见 `.artifacts/validation/activity-period-package-audit.json`；测试目录、进程和端口已清理。

该批标准与演武更新为 0.1.11，渡口仍为 0.1.0 且精确依赖 standard@0.1.11，应用壳仍为 0.1.0。完整测试、浏览器、实际原生运行和发布包以 [STATUS](STATUS.md) 的当前证据为准。默认人类甲席、其他角色基础 AI；Android、完整智能托管与联机继续按既定顺序推进。
