# 协作约定

- 先读 [STATUS](docs/STATUS.md)；模块与结算边界见 [ARCHITECTURE](docs/ARCHITECTURE.md)，写内容见 [AUTHORING](docs/AUTHORING.md)，规则裁定见 [RULINGS](docs/RULINGS.md)。
- 小而明确的运行核、可组合规则库、普通 TypeScript 内容代码。UI / AI 消费规则与视图，不另写一套合法性判据。
- 安装：`pnpm install --frozen-lockfile`（pnpm 11.25.0，Bun 见 `engines.bun`）；开发：`pnpm dev`（Vite + 自有 Bun 主持端；规则、内容、AI 只在 `src/host` / `src/server` 运行，网页端 `app`/`client`/`platform` 只经 `src/protocol` 取视图，三道边界检查会拦截越界导入）；主持端：`pnpm server`（Bun 直接跑 `src/server/main.ts` 源码，不打包，类型由 typecheck 保证）。
- 收尾执行 `pnpm check`（typecheck、lint、format:check、test、smoke:bun）。网页渲染、交互或前端资源变化另跑 `pnpm build && pnpm test:ui`；文档改动跑 `pnpm docs:check`。
- 同一时间仅一个代码写入者；在 STATUS 记录当前范围与剩余边界。FreeKill / noname 只作只读参考，不是构建输入。
- 写武将/技能：一将一文件放 `src/content/<包>/generals/<名>.ts`（`export default general('<包>:<名>', name, kingdom, hp, skills)`；主持端启动时扫描，无登记表，重启即生效；标准包的原包顺序在 `standard/package.ts` 的 `order`，新文件按文件名追加；立绘与语音按约定放 `public/<包>/portraits|audio/`，见 [AUTHORING](docs/AUTHORING.md#添加武将)），触发统一用 `on(Event.timing, { who, when, ask/cost, effect })`（技能与独立效果共用），新时点用 `defineEvent`，历史按事件类型查询（`ctx.history.facts(Event.timing)` / `isFact`）；主动与转换用 `action` / `convert` 与自带存活/终局处理的动词，见 [AUTHORING](docs/AUTHORING.md)。技能回调经 `rulesOf(ctx)` 取本局目录，不写 `(book) =>` 工厂；作者不写任何 AI：托管 AI（`src/host/ai`）只靠推演内核语义自己定权重，内容与 SDK 里没有 AI 字段，AI 里也没有牌、武将或技能 ID。
