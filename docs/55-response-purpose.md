# 55 · 响应中的使用与打出

更新：2026-10-18。接续 [54](54-named-response-blocks.md)，修正标准闪的现有语义缺口。规则内核没有增加牌名、武将或响应用途特判，使用与打出继续复用规则标准库各自的支付、处理区和完成流程。

## 由实际用途决定活动

本地 [FreeKill 的 SlashOffsetFunc](../../freekill/lua/core/util.lua) 在抵消杀时执行 askToUseCard/useCard，[万箭齐发](../../freekill/packages/standard_cards/pkg/skills/archery_attack.lua) 则执行 askToResponse/responseCard；[noname 的标准牌](../../noname/resources/app/card/standard.js) 也分别请求 chooseToUse 和 chooseToRespond。之前项目将两者统一记为打出，导致禁止打出闪也错误阻止抵消杀。

现在 [CardBook](../src/rules/cards/book.ts) 提供两项明确操作：

```ts
// 万箭齐发、决斗等要求实际打出牌。
const played = await book.respond(ctx, actor, names, effect);

// 杀要求使用闪；保留供牌窗口，并执行完整 use 管线。
const used = await book.useResponse(ctx, actor, names, effect);
```

两项仍共用 responseRequested。机会的 purpose 为 use 或 response，canProvide、菜单、转换配方、最终支付按实际用途检查；具名效果禁令先过滤 names。普通使用检查 prohibitUse，实际打出检查 prohibitResponse。本人使用闪不会产生 card.responded 或 responseFinished，而会产生独立 card.used、card.finished 与 useFinished。万箭齐发仍只产生实际打出。

[resolveAttack](../src/rules/combat/attack.ts) 的请求参数明确为 `{ name, purpose }`，命中后伤害仍可由普通函数替换。标准杀请求使用闪，万箭/南蛮请求打出闪/杀；不从攻击牌名猜测用途。

## 使用资格与候选

使用闪带有 `UseTiming.kind = 'response'`，opportunity 固定 actor、names、效果引用、response 生存期及实时 available。最终使用检查 World、祖先作用域、存活请求、指定角色和名称。关闭后的机会、另一 World 或冒用其他角色都不能继续使用；历史只保存普通时机快照和效果引用，不保存函数或挂起调用栈。

`UseRules.timings` 可列出牌支持的用牌时机，省略时不额外限制。闪仅接受 response，无懈仅接受 counter。候选生成和最终验证共用该限制；`book.offers(ctx, actor, timing, names?)` 同时过滤实体和配方的可能名称。出牌阶段传入自己的 playTiming，避免把只有响应/反制用途的牌留成空等待。只传 use/response 字符串仍是按活动种类查询潜在候选，不提供具体时机资格。

动态禁令和完整条件仍是普通查询/函数；timings 不代替 canUse、目标合法性、费用或最终重查。作者可用普通零/多材料配方使用闪，也可限定配方只用于使用或打出。标准倾国、龙胆、八卦和无双的说明已同步。

## 护驾：先由队友打出，再由主公使用

delegate 创建的子请求始终要求实际打出；它不会把主公的使用禁令错放到队友身上，也不会把主公自己的禁止打出误认为队友禁令。

当父请求需要使用时，代打者的 responseFinished 结束后，在其处理区仍存活的回调内，由原请求者使用 generated 语义牌。材料从代打处理区进入本次用牌处理区，origin 保留实际供牌者和原转换来源。两项活动分别支付和提交，但只有一次真实失去供牌者的手牌；没有为主公伪造第二次打出。

使用前重新检查原请求、主公资格、使用禁令及全部材料仍在本次供牌处理区。打出后材料被取走、主公死亡或新使用禁令出现，不能追回材料或伪造使用；实际打出和已付费用仍保留。主公已经完整使用后发生死亡，也不撤销提交结果。两层委托保持末端实际打出者和最初使用者，按各自实际角色确定支付与完成时点的主体。

ResponseResult 的成功分支现在分别是 responded（实际打出者、id、card）与 used（实际使用者、id、card、完整 use，委托时另附 supplied）。`isResponseSatisfied(result)` 可判断两者；用于向祖先完成交接的子请求可以传回最终 used 结果，其中 supplied 保留实际打出。这些结果不意味着再次宣告。response.delegated 同时记录供牌者、真实打出 id 和最终结果。

待决请求与忙碌仍分开；成功使用/打出后收束其他候选，失败委托仍可回退。局部中止默认沿调用链传播，不被转换成“缺少闪”造成假伤害；已提交材料按原处理区善后。

## 行为证据与范围

[24 项专项](../tests/scenarios/response-purpose.test.ts) 覆盖普通闪的两种活动、独立禁令、真实倾国/护驾、八卦无效时不判定、关闭/外局/角色资格、连续两闪、两层委托、已发动后禁令变化、材料被取走、主公前后死亡、取消、局部中止，以及实体/多名称配方的出牌候选过滤。每项完成后核对事实重建、决策关闭与处理区清理。

首批三个场景中两个在修复前失败，原始报告为 `.artifacts/validation/response-purpose-before.json`。全量迁移前报告另存为 `response-purpose-full-before-adaptation.json`：旧完成类型断言、未限定牌名的测试观察者和出牌空候选问题分别处理，不把更新断言当成新增规则覆盖。基础 AI 私有响应测试改为订阅实际请求，避免用 50 毫秒轮询观察只存在 30 毫秒的请求；默认 AI 延迟和信息边界不变。

标准/演武为 0.1.13，渡口仍为 0.1.0 且精确依赖 standard@0.1.13，应用壳仍为 0.1.0。牌、武将、实体与演武牌组数量不变。最终完整验证统一见 [STATUS](STATUS.md)。

最终完整单元/行为 1222 项通过，其中规则/主持侧 1215 项从同次报告分类计数，记录原报告哈希且不另算独立运行。桌面/触控浏览器 174 项一次通过，无跳过或重试通过；Windows Debug/Release 各通过 66 组实际 WebView2 检查及不同 PID 的内容重启恢复，控制台无错误。界面和原生核对八卦、护驾、双闪等真实日志，新增失效分支由规则专项证明。类型、ESLint、Prettier、文档链接及两种原生构建通过，链接器仍有一条 import library 提示性 warning。ZIP 4,620,031 字节，实际四成员/哈希/模块依赖/清单与原生证明审计为 `.artifacts/validation/response-purpose-package-audit.json`，测试进程、端口与隔离目录已清理。

复杂替代响应额度、长期独立效果、完整标准分支审计和作者资源交付仍需继续。默认固定人类甲席，其余基础 AI；Android 等桌面完成后开展，完整智能托管与联机仍后置。
