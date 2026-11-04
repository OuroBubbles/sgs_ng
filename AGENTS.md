# 协作约定

- 先读 [STATUS](docs/STATUS.md)；模块与结算边界见 [ARCHITECTURE](docs/ARCHITECTURE.md)，写内容见 [AUTHORING](docs/AUTHORING.md)，规则裁定见 [RULINGS](docs/RULINGS.md)。
- 小而明确的运行核、可组合规则库、普通 TypeScript 内容代码。UI / AI 消费规则与视图，不另写一套合法性判据。
- 安装：`pnpm install --frozen-lockfile`（pnpm 11.25.0，Bun 见 `engines.bun`）；开发：`pnpm dev`；主持端：`pnpm server`（Bun 直接跑 `src/server/main.ts` 源码，不打包，类型由 typecheck 保证）。
- 收尾执行 `pnpm check`（typecheck、lint、format:check、test、smoke:bun）。网页渲染、交互或前端资源变化另跑 `pnpm build && pnpm test:ui`；文档改动跑 `pnpm docs:check`。
- 同一时间仅一个代码写入者；在 STATUS 记录当前范围与剩余边界。FreeKill / noname 只作只读参考，不是构建输入。
- 写武将/技能：一将一文件放 `src/content/standard/generals/`（`export default general(id, name, kingdom, hp, skills)`，并在 `generals/index.ts` 末尾追加一行静态导入与登记；登记顺序决定大厅列表与按种子抽将，场景测试会检查目录内文件全部登记；立绘与语音放 `public/standard/` 并登记到 `src/content/standard/assets.json`），触发统一用 `on(Event.timing, { who, when, ask/cost, effect })`（技能与独立效果共用），新时点用 `defineEvent`，历史按事件类型查询（`ctx.history.facts(Event.timing)` / `isFact`）；主动与转换用 `action` / `convert` 与自带存活/终局处理的动词，见 [AUTHORING](docs/AUTHORING.md)。技能回调经 `rulesOf(ctx)` 取本局目录，不写 `(book) =>` 工厂；AI 提示写在技能的 `ai` 字段，不在基础 AI 里按技能 ID 分支。
