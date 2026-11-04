# sgs_ng

从零设计的三国杀项目：个人开发、AI 辅助迭代，用简洁、可组合的规则语义承载复杂技能。

内容直接用普通 TypeScript 定义，以 `ContentDefinition` / `createContent(...)` 组合；不需要包清单、版本登记或专用编译器。现有标准＋EX（25 将、108 张牌）、身份模式、固定本人席位＋基础 AI、机制演武，以及浏览器 / Windows 桌面的局域网联机。

技术栈：TypeScript + PixiJS 8（含官方 Spine runtime）+ Svelte 5 + Tauri 2；Vite、pnpm、Vitest、Playwright、ESLint、Prettier。

## 运行

Node.js 24、pnpm 11.25.0：

```sh
pnpm install --frozen-lockfile
pnpm dev            # http://127.0.0.1:1420
```

启动页选择“单机演武”开局。默认控制甲席，其余角色由基础 AI 行动；“手动演练”供内容调试。按 1–9 选牌、Enter 确认、Esc 清除草稿。

联机：`pnpm online` 构建页面与 Node 主持端并监听 `127.0.0.1:1422`，环境变量见 [ARCHITECTURE](docs/ARCHITECTURE.md#联机)。Windows 桌面程序也可在开局页直接创建或加入房间。

## 检查

```sh
pnpm check          # typecheck + lint + format:check + test
pnpm docs:check     # README 与 docs/ 的本地链接
pnpm build && pnpm test:ui   # 浏览器场景（首次需 pnpm exec playwright install chromium）
```

`pnpm test:ui` 用 `pnpm preview` 服务已有的 `dist/`，不会自动构建；改动界面后先 `pnpm build`，且不要与使用 `dist/` 的验收并行。联机两端比对 [构建摘要](scripts/network-build.mjs)，改源码后两端都要重新构建。

## 桌面程序

`pnpm tauri dev` / `pnpm tauri build` 构建 Tauri 桌面壳（需要 Rust 与平台 C/C++ 工具链在 PATH 上，版本见 [rust-toolchain.toml](rust-toolchain.toml)）。Windows 配置会额外执行 `pnpm host:build`，把 Node 与主持脚本作为 `host/` 资源随包，让桌面程序能创建房间。Android 与专用打包 / 验证脚本已移除。

## 文档

| 文档                                 | 内容                                                |
| ------------------------------------ | --------------------------------------------------- |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 模块、依赖、所有权、数据流、联机与结算契约          |
| [AUTHORING](docs/AUTHORING.md)       | 写武将、技能、牌与独立效果；[SDK](src/sdk/index.ts) |
| [RULINGS](docs/RULINGS.md)           | 标准内容的规则裁定与对应场景测试                    |
| [STATUS](docs/STATUS.md)             | 当前完成情况、验证结果与下一步                      |

设计原则：**小而明确的运行核心，足够丰富的规则标准库，自由的普通代码。** 不把技能压进配置表，不为尚未发生的需求建立通用框架。
