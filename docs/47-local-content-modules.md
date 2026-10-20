# 47 · 可导入的本地内容模块

更新：2026-10-18。内容作者仍写普通 TypeScript，复用现有 definePackage/技能/牌/武将接口。主程序现在能从开局页载入单独构建的本地模块，不需要为了每个内容修改重新构建 Windows 程序。标准与内置演武版本保持 `0.1.6`。

## 作者工作流

本篇记录单文件模块的初始边界；[66](66-content-resource-bundles.md) 已新增 `.sgs` ZIP 独立资源和 Blob 持久保存。下文“独立资源待实现”属于本篇当时范围。

[完整示例](../examples/content/harbor/index.ts) 使用类型与普通函数，SDK 可按如下方式导入：

```ts
import { definePackage, defineSkill, on, useDeclared, invoke, draw } from '@sgs/sdk';
import type { CardDefinition } from '@sgs/sdk';
```

项目 tsconfig 已为 `@sgs/sdk` 配置类型路径，示例纳入 typecheck、ESLint 和 Prettier。现有 `src/content/<id>/index.ts` 使用的相对 SDK 导入也可以直接构建；入口中的其他命名导出不影响默认包导出。作者自己的多个文件仍按普通相对 import 组织。

```sh
pnpm content:build examples/content/harbor/index.ts .artifacts/content/harbor.sgs.mjs
pnpm content:example
```

第一条命令允许指定任意作者入口和输出文件，第二条只是示例的固定快捷方式。构建工具复用当前 Vite，没有引入另一套编译器或技能语言。TypeScript 在开发机编译，玩家端只加载生成的 `.sgs.mjs`；主程序不携带 TypeScript 编译器。

开局页点“导入内容包”，选择生成文件。可一次选择多个模块，文件顺序不决定依赖顺序。成功后自动启用新包，武将/牌组/说明使用同一份目录；取消勾选、移除与重新开局都不修改原文件。本批最初仅保留当前窗口；后续持久安装已接入 [48](48-content-persistence.md)，刷新或重启后会恢复保存的源码与选择。

单文件输出支持普通模块代码和编译器内联的资源。独立 CSS/资源等产生额外输出时构建失败，不悄悄交付一个缺文件的模块。外部 Spine/图片/音频目录、完整资源包与路径解析仍在后续范围内。

后续 [57](57-portraits-content-images.md) 已提供真实静态图片示例：渡客通过普通图片 import 和 `generalViews` 声明立绘，单个生成模块包含原始图片字节；随源码保存和恢复，不依赖原文件。当前示例版本为 `harbor@0.1.1`，依赖 `standard@0.1.15`。下文 `0.1.0`/`0.1.6` 是本篇初始实施时的历史版本。

## 身份由宿主提供

[build-content.mjs](../scripts/build-content.mjs) 把作者代码构建成单个模块工厂，格式标记为 `sgs-content/1`。SDK 被保留为宿主参数，因此 useDeclared、cardsMoved、QueryType、运行期类等对象不被复制进内容文件。构建器也识别相对 SDK 路径；误导入包目录之外的宿主实现时直接诊断，避免意外打包另一套内核。

这解决了一个普通打包错误：两份代码里即使 Window.id 相同，只要对象不同，就不是同一个时点。示例测试不仅检查牌名，还检查外部技能的 Window 对象确实等于宿主 useDeclared，再用真实牌触发技能。

工厂由 [content-modules.ts](../src/app/offline/content-modules.ts) 加载并传入真实 SDK。普通闭包、分支、循环与 await 都留在 JavaScript 中，没有序列化函数或用配置重新解释技能。浏览器和 WebView2 使用 blob 模块 URL，导入结束后释放 URL；CSP 的 script-src 因此允许 blob，不需要 eval。

这是可信内容代码，与宿主在同一执行环境运行，不是隔离沙箱。模块级变量遵循普通 JavaScript 生命周期；局内规则状态仍应放在 World/显式 Lifetime 中。移除目录不会撤销已经执行的模块顶层代码。

## 暂存、选择与对局的边界

一批导入先读取和执行模块工厂，再组合临时目录，调用既有 resolvePackages、createBooks 和各牌组构建器。重复 ID、缺依赖、精确版本冲突、命名空间、未知技能/牌等在装配前报错；全部成功后才替换开局目录。错误不会留下半安装的选项，但不承诺回滚可信模块自行产生的全局副作用。

导入只允许在开局页进行，加载期间不能开始对局。每局仍创建独立 CardBook/SkillBook/GeneralBook，记录实际内容版本；后续开局目录变化不改写已经创建的对局。没有热替换正在执行的规则、旧技能引用或悬停函数。

依赖通过原 manifest.requires 声明。选中上层包会显示其依赖也已启用；取消一个包时同步停用显式选择中依赖它的包。移除外部包会连同依赖它的已加载外部包移出目录，避免留下一串不能启用的选项。重复 ID 不隐式升级或覆盖现有包。

这里的依赖共享内容 ID，并不等于两个分别构建的外部模块可以任意 import 对方的 JavaScript API。跨外部模块共享自定义 Window/Query 对象、规则模式包和长期独立效果交付仍需要后续协议；不要把同名但分别构造的窗口当成同一个对象。

## 可运行的渡口示例

渡口 `harbor@0.1.0` 精确依赖 `standard@0.1.6`：

- 备航：对自己使用的普通可反制锦囊，摸两张牌。
- 渡客：潮声与标准武圣组合。潮声通过该局真正的 CardBook 判断锦囊类型，使用锦囊时可先摸一张牌。
- 渡口演练：40 张实体，8 备航、12 杀、8 闪、4 桃、4 决斗、4 无中生有。

仅启用标准和渡口时共 33 种牌、26 名将；再启用内置作者演武则为 38 种牌、28 名将。默认标准＋EX 的 32 种牌、25 将、108 张实体不变。

自然复现：导入模块，选择渡客、两人、AI 关羽、渡口演练、种子 2。甲席起手有 `harbor-card-6` 备航，使用并发动潮声后手牌净增两张，实际材料进入弃牌区，公共日志记录真实发动，无需交接设备。

基础 AI 继续只使用受限观察与正式决策，不因载入模块获得额外信息。它能回答这里的通用发动/响应，但尚不理解任意新牌的主动价值。示例整局通过标准牌和潮声验证加载后的规则组合，不把它说成任意扩展的策略求解器。

首版示例只有杀/闪/桃和备航时，seed 4 的残局经历 539 回合、2401 次决策仍未结束，实际用牌为 471 杀/155 桃。诊断记录在 `.artifacts/validation/content-game-stall.json`，它是已替换的开发牌组记录，不是当前验证结果。示例加入决斗/无中生有并调整回复配比后，在原 2400 次决策预算内完成四人局；没有放宽预算或把未结束的局算作成功。

## 验证与交付

[14 项场景](../tests/scenarios/content-modules.test.ts) 使用真正构建出的模块，覆盖宿主身份、相对 SDK 导入、宿主实现误导入诊断、错误格式/异步声明、重复包/依赖/未知引用、每局隔离、自然起手真实发动、四人 AI 至胜负、牌守恒、处理区清理与事实重建。

[浏览器驱动](../tests/browser/client.spec.ts) 增加三组桌面/触控场景：实际文件导入至技能生效、错误/重复批次不半安装、批内依赖和级联移除及窄屏开局可见。Windows 驱动覆盖同样的加载与运行边界。截图为 `.artifacts/ui/imported-content-*.png`、`imported-content-lobby-*.png` 及 native 前缀版本。最新全量结果见 [STATUS](STATUS.md)。

Windows 打包脚本同时核对 exe 与演示模块的原生证明哈希。ZIP 新增 `harbor.sgs.mjs`，归档后重新读取实际成员和两份文件的字节哈希；玩家无需 Node 即可从开局页选择它。源码、单元测试使用的模块与发布模块分目录，避免并行验证互相覆盖。

对局版本事实不等于保存内容源码或悬停函数，事实重建仍不恢复协程。

持久安装后续已接入 [48](48-content-persistence.md)。资源目录交付、跨模块代码 API、完整作者 SDK 或完整离线版验收仍待继续。Android、完整智能托管和联机仍按既定顺序后置。
