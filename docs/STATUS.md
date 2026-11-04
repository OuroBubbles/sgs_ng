# 当前状态

更新：2026-11-04（P1 Bun 宿主迁移）。单一写入者。

## 已有

- **规则**：World / Flow / 时点 / Decision / Fact 运行核；标准＋EX 25 将 40 技能、32 种 108 张牌；身份模式；机制演武（额外武将与演练牌组）。契约见 [ARCHITECTURE](ARCHITECTURE.md)，裁定见 [RULINGS](RULINGS.md)。
- **内容**：普通 TypeScript 源码组合是唯一内容路径；标准武将一将一文件，由 `generals/index.ts` 显式静态导入登记（无 Vite 专有 API）；标准包媒体在 `public/standard/`，稳定 URL。包格式、安装与持久内容库已删除；未来扩展只保留 `ContentDefinition` / `createContent` / 目录注入。
- **协议边界（P0）**：`src/protocol` 聚合线协议与展示视图；`client/**` 只从 protocol 取值；eslint 禁止 client→rules/content/offline。握手携带 `protocolHash`（强制相等）与 `contentHash`（脚手架）。`pnpm smoke:bun` 用 Bun 从源码起宿主并完成 hello 入座（已并入 `pnpm check`）。
- **客户端**：Svelte 大厅与 Pixi 牌桌；固定本人席位＋基础 AI，可托管；手动演练用于内容调试；FreeKill 面板、卡面与音频已接入。SoloSession 仍在 App（P2 再迁出浏览器）。
- **联机**：Bun 主持端（`pnpm server` 直接跑 TypeScript 源码，无 server 构建产物）与 WebSocket 协议，逐席投影、构建摘要核对、断线重连、同房间连续开局。
- **平台**：浏览器；Tauri 桌面壳（Windows 可随包主持房间；随包主持端仍是 Node + Vite SSR 产物，改 Bun 留待 P8）。Android 已移除。

## 验证

| 检查                               | 结果                   |
| ---------------------------------- | ---------------------- |
| `pnpm typecheck`                   | 0 错误                 |
| `pnpm lint`                        | 通过                   |
| `pnpm format:check`                | 通过                   |
| `pnpm docs:check`                  | 通过                   |
| `pnpm test`                        | 82 文件 / 1418 项通过  |
| `pnpm build` + `CI=1 pnpm test:ui` | 桌面 / 触控 182 项通过 |
| `pnpm smoke:bun`                   | 通过（Bun 1.4.4）      |

## 未完成与下一步

1. **P2**：宿主独占内核；SoloSession 图退出浏览器。
2. **P3**：宿主目录扫描取代 `generals/index.ts` 登记表。
3. **P8**：Tauri 随包主持端改 Bun（`bun.exe` + 源码或 `bun build --compile`）。
4. Windows 桌面需在装有 Rust + MSVC 的机器上用 `pnpm tauri build` 重新构建与实机验证。
