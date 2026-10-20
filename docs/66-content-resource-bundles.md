# 66 · 独立二进制资源包

更新：2026-10-18。接续 [65](65-standard-card-review.md)，作者可把代码与原始资源分开交付为 `.sgs` ZIP，继续使用普通 TypeScript、相对 import 和既有技能函数。没有向规则内核加入媒体协议或技能语言。桌面优先，Android 构建与设备验收继续后置。

## 构建与使用

```sh
# 单文件：适合小资源，仍可内联图片。
pnpm content:build examples/content/harbor/index.ts .artifacts/content/harbor.sgs.mjs

# 同一份 TS，资源字节与源码分开。
pnpm content:build examples/content/harbor/index.ts .artifacts/content/harbor.sgs

# 构建渡口、画阁两个 ZIP 示例。
pnpm content:bundle
```

作者保持 `import portrait from './guest.jpg'` 和原有 `generalViews`。普通 JSON 仍可作为代码数据导入，原始文件 URL 用 `import dataUrl from './data.json?url'`。图片、音频、字体与显式 `?url` 的其他文件按 MIME 保存字节。

[构建器](../scripts/build-content.mjs) 复用 Vite，把 SDK 保持为宿主引用，将资源 import 转为本模块的 URL 查询；作者不需要手写工厂包装。入口目录内的资源保留相对层级，通过普通 `../` 复用的资源用内容哈希和文件名生成稳定包内路径，不携带开发机绝对路径。

ZIP 包含 `manifest.json`、`content.sgs.mjs` 和 `assets/`，清单记录入口、资源路径与 MIME。加载时检查缺失、重复或未声明文件。文件顺序与 ZIP 日历时间固定，UTC/上海时区子进程构建逐字节相同。固定使用 [fflate](https://github.com/101arrowz/fflate) `0.8.3`，浏览器解压器按需加载，不进入规则执行。

资源保持原始二进制，不再编码图片，也不塞入 base64 源码。渡口 ZIP 为 275,521 字节，原始 JPEG 为 274,000 字节；原单文件渡口为 368,134 字节。它们是两种明确构建选择，不是缺文件时的静默回退。

产物复核发现虚拟资源模块的区域注释携带了绝对路径。构建器改用包内资源 ID 并显式设置打包工作目录，跨目录测试先失败后通过。显式 `?raw` 保留文本语义，避免被独立资源 URL 覆盖。

## Blob 与资源所有权

[资源租期](../src/app/offline/content-assets.ts) 管理不可变 `{ path, blob }` 声明和按需 Blob URL。同路径在一次加载中复用，不同加载实例隔离，释放幂等。Blob 原生不可变，列表和声明另行复制冻结。

资源不进入 World、事实、席位投影或 AI 观察。规则 `immutable` 仍只接受有限纯数据；内容库没有为了二进制放宽通用内核。[存储](../src/app/offline/content-storage.ts) 在模块源码之外保存可结构化克隆的 Blob，与元数据和启用选择在同一 IndexedDB 事务提交，原 revision/CAS 和错误恢复约束不变。

恢复重新执行源码并分配新 URL，不读原文件，不保存上一进程的 URL。牌桌继续用已有纹理管理加载图片，坏图回退轮廓。CSP 允许本地 Blob 图片、媒体与读取，没有引入外部服务依赖。

[加载器](../src/app/offline/content-modules.ts) 等待一批输入全部完成后再交付；若任一失败，其他已加载模块的资源也释放，包括晚于失败完成的解压任务。源码模块 URL 在 import 后立即释放，资源 URL 留到卸载。可信模块自行产生的全局副作用仍不承诺回滚。

[内容库](../src/app/offline/content-library.ts) 对导入失败、重复包、恢复元数据不符和关闭期间丢弃的模块释放本批资源。新目录发布、移除或清空等事务完成后，才释放被替换的旧资源；保存失败保留旧目录/图片。关闭期间已经提交的记录仍可被下一实例恢复，不复活关闭窗口的 URL。

应用仅允许开局页修改内容，进行中对局不会触发卸载。单独使用协调器的调用者须先结束使用旧目录的客户端；协调器不持有 Room，也不通过引用计数猜测游戏所有权。

## 画阁交付示例

[画阁](../examples/content/gallery/index.ts) 精确依赖 `harbor@0.1.1`，通过相对 import 复用渡客原图。画阁客复用渡口潮声与标准武圣，没有复制窗口或改写标准规则。`gallery.sgs` 为 274,886 字节。

开局页同时导入 `harbor.sgs.mjs` 与 `gallery.sgs`，文件顺序不影响依赖解析。选画阁客、两人、AI 关羽、渡口演练、种子 2，使用起手备航并发动潮声，手牌净增两张。普通模块的内联图片与独立资源 Blob 可同时保存和恢复。

Windows ZIP 在原四成员之外增加 `gallery.sgs`。发布前核对实际成员和 exe/普通模块/资源包字节，要求资源包对应当前 exe 的真实进程重启证明。此示例共享的是内容 ID，没有把跨外部模块任意 JavaScript API 或自定义 Window 身份共享说成已实现。

## 验证与当前边界

[16 项主持侧场景](../tests/scenarios/content-assets.test.ts) 使用真正 ZIP，验证原始字节、跨时区/跨目录确定性、显式 raw 文本语义、1 MiB 原始资源、实例隔离、结构化克隆、真实保存失败/重复包/恢复元数据错误的释放、关闭期间提交和恢复后的宿主 Window 身份。Node 不支持浏览器 Blob 模块导入，因此这里用真实产物配合 Node 模块入口；实际 Blob 加载由浏览器验证。

[三组桌面/触控场景](../tests/browser/content-bundle.spec.ts) 共六项，检查 Blob 模块、原图哈希、真实绘制、刷新恢复与宿主技能，以及整批错误/真实 IndexedDB 中止后的释放、再次导入和移除。首次专项 4/6 通过，另两项因 Playwright 不允许混用路径和内存文件而未进入应用；修正夹具后六项通过，不计为运行缺陷。

Windows Debug/Release 使用不同真实进程恢复普通模块和画阁，核对 Blob 字节、源码与归档哈希，再实际绘制画阁客并发动跨包潮声。原有标准技能、基础 AI、暂停和 Spine 场景仍执行。验证仍使用独立数据目录，核对进程/CDP/目录后清理，不触及正常内容库。

首次完整单元与 Rust 构建/浏览器并行时，新资源字节测试在 5 秒、既有牌面整局在 30 秒处超时。原报告保留为 `.artifacts/validation/resource-bundle-full-concurrent.json`，日志同名。随后在其他重任务结束后按原超时和决策预算重新完整执行，不把超时计为规则缺陷或通过结果。最终报告为 `units.json`、`resource-bundle-core-coverage.json`、`browser.json` 和 `resource-bundle-package-audit.json`；通过计数与平台证据见 [STATUS](STATUS.md)。

首轮完整浏览器为 193/194，失败于既有救援场景的日志边界测量；单独复核两端通过。原测试跨两次读取矩形，AI 仍在追加日志，现改为同一浏览器求值并等待布局收敛，仍要求段落顶部/底部完整位于容器内。初始报告为 `resource-bundle-browser-concurrent.json`，trace 为 `.artifacts/ui/resource-bundle-jiuyuan-initial-trace.zip`。

标准/演武仍 `0.1.20`，渡口 `0.1.1`，画阁 `0.1.0`。默认牌/将/实体、固定甲席加其他基础 AI 不变，完整智能托管、联机和 Android 继续后置。

当前支持静态 import 与 `?url` 的独立资源，不自动重写 CSS、SVG 或 Spine atlas 内部的相对媒体依赖，也没有作者 Spine 播放声明。二进制携带不等于这些媒体场景已验收。解压与存储仍以完整包为单位，1 MiB 正确性不是任意大包内存/性能承诺。流式大资源、媒体依赖解析、跨模块代码 API 和复杂作者内容继续推进。
