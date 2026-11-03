# 协作约定

遵守上级 [工作区约定](../WORKSPACE.md)。项目位于 `C:/workspace/sgs-ng`。

- 先读 [STATUS](docs/STATUS.md)；架构与结算边界见 [03](docs/03-architecture.md)、[04](docs/04-resolution.md)。按任务阅读相关契约。
- 小而明确的运行核、可组合规则库、普通 TypeScript 内容代码。UI / AI 消费规则与视图，不另写一套合法性判据。
- 在项目目录安装：`pnpm install --frozen-lockfile`（pnpm 11.25.0）；开发：`pnpm dev`。
- 类型检查：`pnpm typecheck`；收尾执行完整检查 `pnpm check`。网页渲染、交互或前端资源变化另跑 `pnpm test:ui`；仅原生壳/打包变化按[平台入口](docs/08-development-guide.md)验收对应实际程序。
- 同一时间仅一个代码写入者；在 STATUS 记录任务范围、验收与剩余边界。参考源码保持只读。
