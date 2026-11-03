# 54 · 具名响应禁令与唯一供牌

更新：2026-10-18。接续 [标准目录核对](53-standard-semantics.md)，修正铁骑的禁止范围，并统一普通响应、转换、委托供牌和八卦阵的名称过滤。本批只扩展规则标准库，内核仍不认识铁骑、闪或供牌者。

## 禁止哪个角色，以什么牌响应

之前效果只有“禁止该角色所有响应”的记录，铁骑红判也使用它。标准杀只要求闪时看不出区别，但作者若在同一效果下另行请求杀，会被不必要地拦截。

现在 [ResponseBlock](../src/rules/cards/types.ts) 包含 actor、names、reason：actor 是需要响应该效果的角色，即 ResponseOpportunity.beneficiary；实际代打者仍是 request.actor。names=null 禁止全部响应牌，非空列表只禁止这些语义牌名。

```ts
// 铁骑只禁止目标以闪响应本次效果。
effect.blockResponses(ctx, effect.target, self.skill, ['standard:jink']);

// 作者也可明确禁止该角色对本次效果的一切响应。
effect.blockResponses(ctx, target, 'my-package:silence');
```

列表声明时复制到权威宣告并冻结，多条禁令取并集。空数组、空白名称、重复名称和非字符串名称拒绝整次改写，不留下半条记录。纯查询、其他局/不相关上下文和效果封口后的改写仍由原有计划/生存期守卫拒绝。

铁骑的项目说明同步为“不能以闪响应这次杀”。[FreeKill 参考](../../freekill/packages/standard/pkg/skills/tieqi.lua) 使用 disresponsive 实现，[noname 文本](../../noname/resources/app/character/standard/translate.js) 使用“不可被闪避”措辞；本项目在开放响应名称的规则接口中按闪明确限制，不把标准杀的默认响应类型当成所有扩展请求的类型。

## 请求先收窄，所有实际供牌走同一入口

[requestResponse](../src/rules/cards/response.ts) 在入口固定效果引用及请求牌名，排除受益者被禁止的名称，然后才开放 responseRequested、技能供牌和普通菜单。

- 只禁闪的“闪或杀”请求只开放杀。菜单、offers、最终回复、opportunity.canProvide/provide 都使用这个允许集合。
- 名称按打出的语义牌判断。倾国把黑色实体杀当闪时仍是闪，不能借材料原名绕过；八卦生成的零材料闪同样受限。
- 没有剩余名称便不开放供牌窗口或普通询问，八卦与护驾也没有额外绕过入口。
- 委托只能收窄当前允许集合，不能重新加入已被过滤的闪。禁令仍归属最初受益者，不因为换一个实际代打者而消失。
- 实际代打者自己的禁止打出查询仍在 build、选择和支付时重查。禁止 c 自己响应当前效果，与禁止 c 替 b 打出牌是两项不同的规则。

请求事实同时保留 requestedNames 与过滤后的 names；实际 card.responded、支付者、beneficiary 和原因链各自保留，不伪造第二次响应。效果引用仍是请求入口快照，不恢复挂起执行，也不追踪调用方之后对普通输入对象的改写。

## 次数必须知道响应的牌名

[CardBook.responseTimes](../src/rules/cards/book.ts) 现在明确接收响应名称：

```ts
const count = book.responseTimes(ctx, effect, responder, 'standard:slash');
```

攻击骨架传入自己的 responseName，标准决斗传入杀。CardPolicy.responseTimes 和 cardQueries.responseCount 同样收到 name，作者可用普通纯函数区分不同响应牌，不必从攻击牌名称猜测。

具名或全部禁令先于次数政策、查询修正与效果追加的最低次数；被禁止的名称直接返回零，不被无双的最低要求重新开放。无懈属于用牌/反制管线，仍由 prohibitedCounters 处理；不把反制用牌与普通打出合并。

这里没有新增“多种可替代牌共享额度”的通用模型，已有最低次数仍属于明确的效果/角色要求；复杂替代组合继续由普通规则代码与后续反例验证。

## 请求待决与供牌忙碌分开

之前一次 request.provide 已成功支付并完成打出后，窗口仍可能执行其他候选；它们即使不能再供牌，仍可能先索取发动费用。本批复用了 Window.active：实际结果已确定、目标失效或终局便收束剩余供牌候选。

一次提供/委托正在运行时的 busy 只禁止并发提供，不等于窗口永久失效。失败委托返回后，原请求继续，其他合法提供者或本人仍可响应。忙碌期间的合法子流程仍可显式接纳新候选；如果当前提供随后成功，这些候选便随供牌窗口收束，不再运行或收费。

responseFinished 仍是已经提交的打出完成事件，费用、材料与后效不会因为等待供牌窗口关闭而回滚。想处理成功打出后果的技能应监听完成事件，而不是利用待决供牌候选继续收取费用。

## 行为证据与边界

[20 项新增场景](../tests/scenarios/named-response-blocks.test.ts) 覆盖：

- 真实铁骑红判、混合名称请求、普通菜单的非法回复拒绝、八卦不判已禁闪。
- 倾国语义名、委托不能扩张、受益者与实际代打者区分、代打者禁令及失败回退。
- 全部禁止、多个具名禁令并集、不收集供牌来源/不计算被禁次数。
- 非法声明原子拒绝、名称复制/冻结、纯查询/封口守卫、多目标隔离。
- 具名次数政策/纯查询与最低要求、唯一支付、忙碌期间的合法接纳与结果确定后的候选收束。

首批三个具名反例在修复前均失败，报告为 `.artifacts/validation/named-response-before.json`。随后供牌窗口场景在 18 项中单独失败，报告为 `named-response-window-before.json`；最终新增 20 项通过，报告为 `named-response-after.json`。原有相关 180 项定向场景也已通过；最新完整验证统一见 [STATUS](STATUS.md)。所有新增完成场景均核对事实重建、决策关闭和处理区清理。

标准与演武内容更新为 0.1.12，渡口仍为 0.1.0 且精确依赖 standard@0.1.12，应用壳仍为 0.1.0。默认标准 32 种牌、25 将、108 实体，演武目录及现有布局保持原样。内容模块依赖与恢复按 [持久恢复](39-source-packages.md#持久安装与恢复) 处理。

最终完整单元/行为 1198 项通过，其中 1191 项规则/主持侧从同次报告分类计数，不另算独立执行；桌面/触控浏览器 174 项一次通过。Windows Debug/Release 各通过 66 组实际 WebView2 检查和不同 PID 的内容重启恢复，控制台无错误，隔离目录及进程已清理。新的权限与供牌分支由规则场景验证，界面回归覆盖现有正式操作。类型、ESLint、Prettier、文档链接及两种原生构建均通过；链接器保留一条 import library 提示性 warning。发布 ZIP 4,617,306 字节、精确四个成员，实际字节/哈希、依赖、清单及两构建原生证明核对结果为 `.artifacts/validation/named-response-package-audit.json`。

该批发现抵消杀与万箭齐发都提交打出事实；后续 [55](55-response-purpose.md) 已区分使用/打出请求、禁令和完整完成流程，护驾在代打处理区回调内将材料交接给原角色使用。此文描述 0.1.12 的响应禁令修复，当前用途契约以 55 为准。复杂替代额度、长期独立效果、完整标准分支审计与离线体验验收仍需继续。默认人类甲席、其余基础 AI；Android 在桌面完成后，完整智能托管与联机仍后置。
