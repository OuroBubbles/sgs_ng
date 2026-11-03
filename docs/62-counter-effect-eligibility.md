# 62 · 嵌套反制复用本次效果资格

本页说明[目标持续资格](61-target-pending-windows.md)如何传入嵌套反制。

## 外层检查不能代替内层资格

effectStarting 在各候选边界检查目标存活、终局、禁止和 canResolve。[反制安装器](../src/rules/cards/counter.ts)必须关联这些条件，仅看 effect.state 为 ready 不能覆盖以下变化：

- 桃园目标在反制开窗中被治满，效果依旧 ready，旧机会仍可继续征询和消耗无懈。
- 顺手/拆桥目标的最后一张牌离场，或来源死亡，牌体已经不可执行，内部机会仍未关闭。
- 动态禁止目标同样不改 ready，不能只靠状态名称发现失效。

这不是把外层 active 再检查一次就能解决的：窗口不能在普通异步候选函数执行到一半时强行返回。内部反制机会须自己继承正确的持续资格。

## 一个普通纯函数，共用真实规则

[effectStarting](../src/rules/cards/book.ts) 的运行期负载现在为 `{ use, effect, available }`。available(ctx) 关联本次实际 resolver 的规则，查询原 World、仍活跃的执行作用域、ready 身份、目标实时资格及本次 canResolve。它与该窗口 active 是同一个函数。

反制安装器把 available 原样交给 contestCounter.relevant；后续无懈通过已有父机会 available 继续继承，覆盖反制开窗、逐席菜单、最终用牌支付和结果封口。没有按牌名列例外、复制标准牌条件、扫描额外状态，或添加可序列化条件 DSL。

这里必须使用本次结算规则。延时牌后续生效经过 resolveDelayed 的独立 resolver，不能重新查牌定义的初次放置 canResolve；即使放置条件已不满足，后续生效仍可以拥有正常反制机会。新增作者延时牌场景证明这一点。

available 是纯运行期查询，既不是状态快照，也不是支付能力。原 World 之外和效果/作用域结束后返回 false；不会写入 World、事实、展示描述或传输数据。扩展可在启动期间的嵌套请求中复用它，仍由正常 Decision/pay/use 管线接纳输入和提交事实；实际 resolver 开始后已不再 ready，不把此查询误当作生效中响应的资格。

## 不扩大取消和回滚语义

已使用的无懈仍是实际用牌，材料不退回；机会后来失效时，结果为 unavailable，并保留实际 by。新的无效征询不再开放，后续候选不再运行。未发生的用牌不能补记为事实。

决斗没有“目标必须受伤”“目标必须有牌”“来源必须存活”这些条件，不能因为类似桃园或顺手而统一收紧。先治满再失去体力发生在同一个运行中候选内时，候选返回处按当前条件判断，不缓存中途的 false 为永久取消。

结果封口之后仍按 [60](60-counter-pending-windows.md) 的公共完成语义处理。counterFinished 的后效把桃园目标治满，不倒改已经确定的 countered，也不返还无懈；仍可取消尚为 ready 的原效果。没有把公共完成后效降格成可以追溯撤销的预览。

## 验证入口

[反制效果资格场景](../tests/scenarios/counter-effect-eligibility.test.ts)核对牌体与禁令变化、内层机会、临时恢复、延时后续 resolver 和封口后的公共结果，检查牌守恒、处理区清理及事实重建。检查方法见[标准验收入口](53-standard-semantics.md#行为清单与检查)，当前结果见 [STATUS](STATUS.md)。
