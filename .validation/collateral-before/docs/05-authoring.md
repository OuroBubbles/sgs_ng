# 05 · 内容作者入口

本文使用当前 [SDK](../src/sdk/index.ts)，不再保留不能直接执行的早期示意接口。系统能力与未验收边界以 [STATUS](STATUS.md) 为准；流程、时点和故障的完整契约见 [04](04-resolution.md)。

## 写一个可以载入的包

内容是普通 TypeScript。声明放在 `src/content/<包名>/index.ts`，默认导出 `definePackage(...)`，重新启动开发服务后可在开局页勾选；也可以独立编译，再从开局页导入。ID 使用 `包名:局部名`，依赖可以指定精确内容版本。

下面的完整示例沿用 [渡口](../examples/content/harbor/index.ts) 的触发方式：使用锦囊时可摸一张牌。定义通过工厂取得本局的 CardBook，不依赖全局对象。

```ts
import { definePackage, defineGeneral, defineSkill, on, useDeclared, invoke, draw } from '@sgs/sdk';
import type { CardBook } from '@sgs/sdk';

function study(book: CardBook) {
  return defineSkill({
    id: 'demo:study',
    name: '研习',
    description: '当你使用锦囊牌时，你可以摸一张牌。',
    effects: [
      on(useDeclared, {
        id: 'draw',
        order: 'choose',
        when: (_ctx, use, self) =>
          use.actor === self.owner && book.definition(use.card.name).type === 'trick',
        async run(ctx, _use, self) {
          if (await invoke(ctx, self, '是否发动【研习】摸一张牌？'))
            await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
        },
      }),
    ],
  });
}

export default definePackage({
  manifest: {
    id: 'demo',
    name: '作者示例',
    version: '1',
    requires: [{ id: 'standard', version: '0.1.21' }],
  },
  skills: (book) => [study(book)],
  generals: [
    defineGeneral({
      id: 'demo:scholar',
      name: '学士',
      kingdom: '群',
      gender: 'male',
      maxHp: 3,
      skills: ['demo:study'],
    }),
  ],
});
```

例如保存为 `examples/content/demo/index.ts` 后，在项目目录执行：

```sh
pnpm typecheck
pnpm content:build examples/content/demo/index.ts .artifacts/content/demo.sgs.mjs
```

在开局页导入生成文件，启用“作者示例”，选将后仍可使用标准牌堆。`examples/` 不会自动加入内置目录；`src/content/` 的同层包才会被构建入口发现。构建工具负责编译和保留宿主 SDK 身份，不代替类型检查。上述示例不需要自建牌堆、模式或 UI。

## ctx、self 与普通函数

`on(window, { when, run })` 的实际签名是 `run(ctx, payload, self)`。`self.owner` 是技能拥有者，`self.id` 是本次技能实例，`self.skill` 是定义 ID；`ctx` 携带本次结算的状态读取、原因、历史和作用域。没有 `ctx.owner`、`ctx.draw` 或隐藏的全局“当前事件”。

规则操作直接调用 `await draw(ctx, input)`、`await damage(ctx, input)` 等普通函数。分支、循环和局部变量由 TypeScript 表达；父流程等待所有嵌套后效结束才恢复。不要并行写同一局；直接 await 或返回子操作的 Promise。

`ctx.flow(...)` 返回领域值，中止默认向外传播。只有确实允许局部中止并继续的边界才使用 `ctx.attempt(...)`；故障和整局关闭不能因此恢复。无需给每个技能包一层 attempt，或逐层检查 aborted。

## 选哪种能力入口

| 需求                         | 当前入口                                                    | 可运行源码                                                                             |
| ---------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 在时点参与结算               | `on`；`when` 为纯查询，`run` 可等待                         | [集智等](../src/content/standard/tacticians.ts)                                        |
| 出牌阶段主动发动             | `active` 中的 `available` / `selection` / `run`             | [制衡](../src/content/standard/wu.ts)                                                  |
| 将材料解释为另一张牌         | `viewAs`；用牌与响应规则继续由 CardBook 处理                | [武圣](../src/content/standard/wusheng.ts)、[龙胆](../src/content/standard/martial.ts) |
| 修正牌面、距离或限制         | `modify` + 具名 `cardQueries`；自定义组合可用 `defineQuery` | [谦逊](../src/content/standard/wu.ts)                                                  |
| 创建失去技能后仍可存在的效果 | `defineEffect` / `EffectBook`，实例数据存 World             | [裸衣](../src/content/standard/wei.ts)                                                 |
| 定义新的规则时点             | `defineWindow<T>` + `ctx.window`，跨包直接共享对象          | [渡口](../examples/content/harbor/index.ts)                                            |

一个技能可以组合这些入口，也可直接编排公开规则函数；没有要求复杂技能翻译成配置 DSL。新 helper 应来自真实重复的语义，而不是为隐藏一个循环建立通用框架。

## 选择、费用与继续条件

稳定 ID / 可读选项使用 `chooseOne`；材料与目标的联合选择使用 `JointSelection`；有序分组使用 `ArrangementSelection`。模型提供动态候选、前缀检查、最终验证和预览，UI 消费同一决策，不重写合法性。复杂约束提供普通 `partial` / `canComplete` / `complete` 函数，不能靠无界穷举或只检查最终组合。

`invoke` 负责自愿发动的询问与零费用宣告。支付材料时使用 `payDiscard` 或 `pay`；支付入口重新检查角色、来源、次数与材料，返回 `paid/unavailable`。费用与次数提交后，移牌及支付后效完整结束才返回，取消后效不自动退款。不要按 UI 点击计次。

需要在费用确定时同步修改待决草案，可使用 `PaymentIntent`。它的 `available` 是纯查询，`committed` 必须同步，先于支付后效；异步宣告属于代码故障。普通技能通常无需直接使用此入口，实际例子见 [伤害转移](../src/content/workshop/defense.ts)。

“后续还需要什么条件”由技能文本决定。来源在发动前必须有效；已经宣告的效果不因为来源消失而统一回滚，也不应在每个 await 后机械添加 `self.effective(...)`。确实要求目标仍存活、当前阶段未结束或仍持有技能时，用动态候选及 `available` 表达，并由实际操作最终校验。区分草案、按发动时固定的来源与已经提交的结果。

直接调用 `draw` / `recover` 即复用规则操作对受益者存活与终局的重查；技能只表达是否接受发动、支付是否成功、材料/目标选择和文本特有的继续条件。多目标后效仍逐个 await，每个目标在实际操作时独立校验。

## 状态、只读值与生存期

局内计数和标记用 `defineState` / `readState` / `setState`，不要放在共享定义或模块级可变变量中。`stateChange` 可与费用组成同一提交。`UsageLimit` 的 source 由规则选择：按技能定义计数可防止同阶段重新授予重置，按实例计数则区分每次获得。

阶段、回合等使用有身份的 `Lifetime`，嵌套阶段和额外回合各自独立。普通 Flow 不自动变成回合生存期。独立效果使用自己的到期条件，失去创建它的技能不代表效果一律消失；具体契约见 [独立效果](56-independent-effects.md)。

World、事实和接纳后的决策值在类型与运行时均只读；需要本地修改数组时先复制。领域草案通过其公开方法修改，封口后不能继续改写。`ctx.query` 与所有合法性查询不能写状态、取随机数或 await；违规异步规则查询立即冻结本局。

具名 Query 的开始值、贡献与合并函数、来源资格、retain 与独立效果行为工厂都必须同步。主动技能的 `available` / `selection`、转换的候选/资格/数量/构牌函数，以及选择模型的候选与约束也遵循此约定；用牌目标和响应资格的最终重查仍是纯查询。

分发层在组合前逐项检查其直接调用的回调，避免 Promise 被布尔运算、数组或行为对象访问隐藏。执行侧查询违规时立即冻结；本地投影、预览或回复出错则由主持侧停止本局并显示错误。普通内容继续直接使用现有入口，无需自行包裹守卫；异步后效仍放在 run / onEnd 中。作者函数内部的普通表达式仍由作者负责，类型检查不能省略。

## 扩展与验证的边界

源码包可以导出普通函数、Window 和 Query，其他包通过 `@sgs/content/<包名>` 导入同一加载实例；资源可以独立放入 `.sgs`，见 [模块 API](39-source-packages.md#跨模块代码共享) 与 [资源包](39-source-packages.md#资源与所有权)。包在下一局装配，不在挂起技能中途热换定义；本项目使用可信代码，不引入签名或沙箱体系。

当前客户端支持已登记的选择形态。自定义 `ctx.ask` 类型能在规则层运行，不代表 UI 和基础 AI 已自动具备该交互；不支持的必选决策会中止基础 AI 对局。先复用现有选择模型，确有新交互需求时再补完整执行、投影和客户端路径。

改动后先运行 `pnpm typecheck`、`pnpm lint` 与对应领域场景；交付前运行 `pnpm check`，界面改动另跑 `pnpm test:ui`。检查领域结果、取消/失效与嵌套路径，不为每个实现细节追加测试。轨迹从 `ctx.history` 的事实和原因链读取，随机数使用 `ctx.randomInt`；不依赖真实时间、动画或 `Math.random` 决定规则。
