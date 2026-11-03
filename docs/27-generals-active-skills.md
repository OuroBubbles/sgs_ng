# 27 · 武将目录与主动技能

本文维护武将装配与主动接口；开发入口见 [05](05-authoring.md)，选择与支付见 [12](12-skills-selection-costs.md)，当前内容和验收范围只在 [STATUS](STATUS.md) 维护。

## 定义与局内状态

[GeneralDefinition / GeneralBook](../src/rules/characters/general.ts) 保存 ID、名称、势力、性别、基础体力与技能 ID。目录拒绝重复武将、非法数值和未登记技能，定义冻结，局内血量与次数保存在 World。

RoleMatch 玩家可指定 `{ id, general }`，不能同时用 maxHp/gender/skills 隐式覆盖武将目录；机制夹具可以不带 general。初始化提交选将 ID 和性别，再按武将 ID 授予技能来源。generalOf(world, owner) 从事实状态读取选将，展示由目录解释名称与势力。

## 主动技能是普通流程

`SkillDefinition.active` 是动作列表，每项声明 id、label、可选 available / selection 和 run；同技能内部动作 ID 不可重复，名称与说明属于 SkillDefinition。可直接使用普通对象与 satisfies SkillDefinition。

- available / selection 使用 `(ctx, { self, phase, book })`。available 只表达次数等额外条件；selection 返回 JointSelection，未使用的维度可省略。零选择技能可只写 run。
- run 使用 `(ctx, { self, phase, book, choice, selection })`。choice 是已验证的材料与有序目标；selection 是本次执行重查使用的模型，可在支付前继续验证当前候选。

共享选择函数可直接标注 `(ctx: Context, input: ActiveInput)`，按需解构 self / phase / book，再用 `selection: 函数名` 接入动作；无需另写 lambda 转接位置参数。仁德、青囊、结姻、反间、离间与制衡均采用这一写法，候选、阶段资格与支付后的继续条件仍由原来的普通函数表达。

[主动入口](../src/rules/skills/active.ts) 检查当前实例、来源、席位、正在执行的出牌阶段、World / scope、存活及终局状态。预览与资格查询保持同步，不支付、不记次数。执行进入 skill.active 子流程，重新验证后，将同次取得的来源、动作、模型与选择交给 run。

普通代码继续组织 pay / payDiscard、draw、loseHp、recover、CardBook、嵌套操作和 await。run 可直接返回一个规则操作，也可按结果分支；不需要重建同一选择模型，支付仍自行声明费用、次数和 legal。模型候选实时读取；将 selection.validate(choice) 用作 legal 后，跨 await 的目标或材料变化仍会阻止支付。

主持侧使用同一 play-action 请求；主动值包含技能实例、动作、材料和目标。actor 与 phase 由主持侧固定。界面在同一草稿中选择技能、材料和目标，最后一次提交；得到新信息后的选择仍由 run 按规则时点询问。客户端与 AI 接收数据描述，执行侧模型与函数不进入协议或 World。

实际写法见 [制衡](../src/content/standard/generals/)、[结姻](../src/content/standard/generals/sunshangxiang.ts)、[仁德与青囊](../src/content/standard/generals/liubei.ts)、[反间与离间](../src/content/standard/generals/)。

## 三个流程约束

苦肉先宣告，再经 loseHp 完整执行失去体力、濒死、救援与死亡。救援成功后才摸两张；死亡或终局后不摸，不额外增加阶段次数限制。

结姻不要求本人受伤，选择两张当前手牌与一名受伤的其他男性角色。弃牌、次数和宣告同次提交；次数按技能定义与阶段生存期计数，独立阶段各有额度。支付后先回复目标、再回复本人，各自读取当前存活状态；已宣告效果不会因技能失去而统一撤销。

枭姬按移牌前后快照计算实际失去装备的数量，区内重排不算失去。批量离场固定次数，逐次询问并重查当前资格；不按当前装备数量倒推，不重新解释后续嵌套移动。

## 验证

[主动场景](../tests/scenarios/active-skills.test.ts) 覆盖异步资格拒绝、执行模型交付、跨 await 后的动态校验、装备来源离场、阶段与实例限制、零牌动作、支付后效及事实重建。

[浏览器](../tests/browser/client.spec.ts) 验证正式选择、一次提交、费用、回复、次数和 AI 整局。平台程序及容量证据以 [STATUS](STATUS.md) 为准，不在专题中重复保存批次计数或后续计划。
