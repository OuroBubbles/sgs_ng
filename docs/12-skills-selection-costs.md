# 12 · 技能来源、联合选择与支付

受限分组的动态接收者、角色额度、逐项条件与失效刷新见后续 [59](59-constrained-assignment.md)，仍使用普通纯函数及既有 Decision，不另设技能 DSL。

日期：2026-10-16。本文记录第二批规则机制；后续用牌/转换和阶段实现见 [13](13-card-use.md) / [14](14-turn-draw.md)。完整对局与离线客户端仍未完成。

## 定义、实例与来源

[SkillBook](../src/rules/skills/skills.ts) 保存固定定义，局内数据全部在 World。`defineSkill` + `on` 实现触发效果，后续已加入 viewAs 配方；主动技能动作与查询修正的完整声明/组合仍待继续。

后续已接入普通主动函数与具名查询；装配期 `register` 可原子追加定义，第一次挂接后封口。需要牌规则的技能可通过显式工厂闭包取得 CardBook；独立回合效果后续已使用 [56](56-independent-effects.md) 的普通数据实例与闭包，裸衣不再手写专用 Provider。这些入口仍不是完整的内容包加载系统。

同一角色同一技能只有一个实例，多个来源分别授予。最后一个来源移除才结束实例；之后重新获得创建新 ID，不能复活开窗快照中的旧候选。单个来源可以关闭；多个有效来源不会使技能重复触发。定义目录可跨 Room 共享，不在定义中存局内计数。

开窗时，核心通过 TriggerSource 从权威状态收集候选，不导入技能包。候选保留实例 ID，执行前重查授予和失效；新获得技能从下一窗口开始。常规效果检查角色存活；死亡后效果显式声明 allowDead，该声明不绕过技能所有权。

实际签名是 `run(ctx, payload, self)`，self 提供 id/owner/skill/origin 与 effective(world)。一个效果开始后，不自动截断所有后续；选择/费用等关键节点按规则重查。装备来源派生与离场 retain 已实现，见 [18 · 装备与查询](18-equipment-queries.md)；allowDead 本身不表示来源保留。

历史来源现在可以普通 invoke/pay，规则与当前所有权分开：`effective(world)` 不恢复，`skillAvailable(ctx, self)` 只授权本次后效及子流程。撤销、到期与实际埋葬快照，以及自定义窗口登记见 [43](43-retained-effects.md)。

动态 Provider 登记与卸载已补齐，见 [44](44-provider-lifecycle.md)：旧候选和支付引用只属于原登记，retain 不绕过卸载，同对象重新登记不复活旧引用。装配期 `addProvider(provider)`；运行期 `addProvider(provider, ctx)` 与 `remove(ctx)`，Context 必须属于该目录唯一挂接的 Room。通常仍采用固定 Provider 从 World 派生能力。

## 状态与生存期

[StateKey](../src/rules/state/state.ts) 组合 key、默认值和类型校验，状态身份由 key/owner/source/lifetime 确定。值为普通数据，读取在类型与运行时都深只读。stateChange 可与其他费用变更组成一次提交；setState 单独提交变化。

[withLifetime](../src/rules/scopes/lifetime.ts) 管理明确的阶段/回合等生存期。普通子 Flow 不自动拥有回合语义；额外阶段获得新 ID。正常完成和 body 中止均原子清除到期状态、授予，再开放 lifetime.ended；代码故障和整局结束保留规则现场。

开始结束的生存期拒绝新增状态，避免到期后效制造永不到期的状态。失去技能不自动清除它已产生的独立效果，状态按自身生存期失效。

次数来源由规则明确选择：按技能定义计数可防止同阶段失去/再获得重置；确实需要按实例计数时用实例 ID。不同分支使用不同 key，不按界面点击累加。

标准包的结姻、制衡、青囊、反间、离间统一以 `self.skill` 作为阶段计数来源；支付事实仍保留实际旧实例。重新授予、启停或替换来源不刷新阶段次数，嵌套阶段则有独立额度；真实内容反例见 [42](42-skill-identity-audit.md)。这不是内核强制所有扩展共用计数身份。

## 联合选择

[JointSelection](../src/core/decisions/selection.ts) 覆盖牌与目标联合选择，支持零/多材料、动态候选和数量范围。只有数量限制时直接计算完成可能；复杂约束提供三个普通函数：

- partial 检查前缀是否合法。
- canComplete 判断是否存在合法完成。
- complete 检查最终组合。

例如点数和最终为 13，不能因此禁用第一张 5 点牌。核心不隐式枚举子集；作者可用普通算法、闭包或合法见证计算可完成性。

inspect 返回前缀合法性、最终可提交性、候选状态、原因和移除失效候选后的 refreshed 值，不替玩家猜测复杂组合的修复方案。选中项允许取消；预览与最终验证共用同一约束。

Decision.describe 生成描述，feedback 生成部分反馈。revision 改变或显式 invalidate 时更新描述/token，提交时重新读取候选。请求只携带数据，闭包留在执行侧。后续已接入 Svelte 联合选择面板，顺手/拆桥使用 opaque 选项；有序分组已由 ArrangementSelection 实现并接入排序面板，见 [37](37-arrangement-astrology.md)；带角色额度的分配与复杂参数仍待继续。

## 支付与宣告

[pay](../src/rules/costs/pay.ts) 返回 paid/unavailable，最终检查角色、技能、次数、材料归属/区域及调用者的 legal 条件。材料移动、次数和宣告在同一 cost.paid 提交中生效，然后才开放移牌后效和 cost.paid 窗口。零材料宣告也能记次数，不虚构移动。

支付后效完整结束后返回。后效令角色死亡或失去技能，不自动退还已付费用；作者按文本决定是否继续。取消选择、材料被取走或最终条件失效，不产生支付。

执行侧待决意图可作为 PaymentIntent 传入：纯 available 在提交前重查，committed 同步确定承诺，先于移牌/支付后效，不能 await。稳定 declaration 与执行闭包分开；护盾/转移的实际例子及故障边界见 [46](46-shield-transfer.md)。

## 可运行例子与证据

[周济源码](../src/content/examples/relief.ts) 仅依赖 SDK：受伤后询问、取牌、检查继续条件、联合选择、赠牌。它是作者接口探针，不冒充历史版本遗计；只从现有牌堆取至多两张，尚无洗牌。

[作者测试](../tests/scenarios/authoring.test.ts) 覆盖完整链路、两种取消节点、摸牌后失去技能不再询问。其他反例见 [技能](../tests/scenarios/skills.test.ts)、[选择](../tests/scenarios/selection.test.ts)、[支付](../tests/scenarios/payment.test.ts)。第二批当时新增 34 项，总计 87 项；当前累计范围见 STATUS 与第三批记录。

本地 FreeKill 参考：`packages/standard/pkg/skills/wusheng.lua` 将转换与牌执行分开；`standard_cards/pkg/skills/slash.lua` 独立检查次数/目标；`ltk/server/events/skill.lua:206`、`ltk/core/player.lua:996` 提供来源/失效/存活参考；`standard/pkg/skills/yiji.lua` 展示循环和联合选择需求。没有复制代码或兼容接口。

后续已实现语义牌/材料分离、用牌/目标效果身份、转换、基本响应、阶段驱动、反制链、席位投影与装备派生能力。[源码包登记](39-source-packages.md)、[模式顺序策略](41-action-order.md)、[显式历史来源后效](43-retained-effects.md)、[本地内容模块](47-local-content-modules.md) 与 [持久安装](48-content-persistence.md) 也已接入。[窗口中新来源显式加入](51-window-admission.md) 可通过 SkillBook.include 按实际技能实例请求，继续使用普通 on/invoke/pay。独立效果基础登记见 [56](56-independent-effects.md)；复杂组合、资源交付和完整离线验收仍需继续，当前还不是完整作者 SDK。

稳定 ID/可读文本的具名选择使用 chooseOne + ctx.ask；客户端与最终校验复用同一决策，见 [35](35-response-blocks-intrigue.md)。

有限多次发动使用 on.times，when/run 可读取独立 occurrence；同组同席位按实时资格交错，源身份与次数不随后效自动扩张。已处理身份不会复活，新来源不自动补入；契约见 [38](38-window-occurrences.md)。
