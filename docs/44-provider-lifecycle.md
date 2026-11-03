# 44 · 动态来源登记与卸载

本文说明动态来源的声明、登记与卸载契约。技能与效果仍使用普通 TypeScript，当前验证与平台边界见 [STATUS](STATUS.md)。

`collect` 返回的 binding.definition 可直接是普通 SkillDefinition 对象或类。SkillBook 用与静态登记相同的入口固定每次收集的声明字段与方法入口，保留原接收者；改名或替换列表不会改写旧结果，下次收集仍反映新声明。候选函数继续读取当前 World，已规范化的声明直接复用，CardBook 不再补做配方规范化。

## 一次登记就是一个执行身份

SkillBook 与底层 TriggerSource 均记录本次登记的对象身份。卸载只结束对应的那一次登记，重复卸载幂等；重新安装同一 Provider 对象产生新的登记，旧候选和旧引用不会恢复。重复安装当前仍在登记的同一对象会明确报错。

窗口默认候选和次数仍在入口时固定。中途新装来源可以立即贡献当前查询、转换和主动动作，但触发效果默认从下一个窗口参与。顺序菜单选中旧候选后仍重查登记；旧项被跳过，其他来源继续结算。不再提供补入当前窗口的入口（阶段 3 删除了 include/windowOf）；同对象重新安装也不能复活旧候选。

## 当前所有权、登记与本次后效

[SkillHandle](../src/rules/skills/skills.ts) 只有一项资格 `active(ctx)`；SkillBook 给 Provider 来源包装时把本次登记并入其中，卸载后旧引用不再可用，等待中的旧询问也不能支付。`retain` 是作者谓词，不自动叠加登记检查。旧引用不进入新登记，新的当前引用应从目录重新取得。

卸载不回滚已经宣告的技能和已付费用，也不强行中止正在执行的普通函数。作者已接受的效果可以继续摸牌等普通后续；之后若再次以该技能支付，则返回 unavailable。来源自身的失效、材料和终局规则继续分别检查。历史来源的回调范围见 [43](43-retained-effects.md)。

包装在原始 self 上调用 `active`，class 来源的接收者保持不变。

## 装配与运行期写入

装配期原有写法保持简洁：

```ts
const remove = skills.addProvider(provider);
```

第一次挂接后，安装和卸载必须传入正在使用的 Context：

```ts
const remove = skills.addProvider(provider, ctx);

// 可以在之后的规则回调中卸载；传入该回调的当前 Context。
remove(ctx);
```

Context 必须存活、允许规则写入，并属于本目录唯一挂接的 Room。省略、关闭、其他局或多局共享目录的 Context 均不能改变运行期登记。静态目录仍可跨 Room 共享；运行期需要独立变化的对局应各自装配 SkillBook，避免改动另一局的来源。

挂接通过 `Room.onClose` 登记同步清理。正常结束、立即中止和故障均自动移除该 Room 的挂接记录；已结束的一局不会继续阻塞另一局的运行期来源变更。显式 detach 同时取消自己的清理回调，旧 detach 不影响新挂接。挂接因纯查询或已结束的 Room 而失败，也不会提前封口尚未装配完的目录。

纯查询不能安装/卸载；Provider 或历史快照正在收集时也不能改变 Provider 集合。收集抛错后守卫正常退出，不遗留永久只读状态。原先在装配期取得的 remove，在挂接后调用也需要当前 Context。`ctx.defer` 的关闭清理没有活跃 Context，不应拿这份运行期 API 代替作用域清理；一次作用域的临时监听写作 `ctx.defer(room.on(Event.timing, trigger))`。

登记属于执行侧，不写成 World 授予，不序列化 Provider 或闭包，也不构成挂起执行恢复。登记持续到显式卸载或目录释放，不因安装它的 Flow 返回而自动卸载；Room.onClose 在这里管理的是目录挂接。通常应在装配期安装普通 Provider，再从 World 状态和生存期派生能力，例如标准裸衣；动态安装只用于确实需要改变来源集合的流程。

## 验证与边界

[生命周期场景](../tests/scenarios/provider-lifecycle.test.ts) 覆盖剩余次数、retain、同对象重新登记、旧卸载函数、底层 TriggerSource 与 SkillBook 重新挂接、过期顺序选项、等待中的 invoke、真实材料支付和普通后续、查询/转换/主动动作、class 方法、重复安装、收集与纯查询守卫、Context/多局边界，以及正常结束/中止/故障清理和挂接失败原子性。实际规则费用与后续包含事实重建和无遗留选择检查；事实不恢复执行侧登记。

内容通过 [普通源码组合](39-source-packages.md) 装配，新来源统一从下一个时点参与。独立效果的登记、触发、查询与到期后效见 [56](56-independent-effects.md)；验证结果、原生包与平台边界统一以 [STATUS](STATUS.md) 为准。
