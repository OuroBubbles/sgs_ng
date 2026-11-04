# 当前状态

更新：2026-11-04（P0 边界落钉）。单一写入者。

## 已有

- **规则**：World / Flow / 时点 / Decision / Fact 运行核；标准＋EX 25 将 40 技能、32 种 108 张牌；身份模式；机制演武（额外武将与演练牌组）。契约见 [ARCHITECTURE](ARCHITECTURE.md)，裁定见 [RULINGS](RULINGS.md)。
- **内容**：普通 TypeScript 源码组合是唯一内容路径；标准武将一将一文件，由 glob 收集。包格式、安装与持久内容库已删除；未来扩展只保留 `ContentDefinition` / `createContent` / 目录注入。
- **协议边界（P0）**：`src/protocol` 聚合线协议与展示视图；`client/**` 只从 protocol 取值；eslint 禁止 client→rules/content/offline。握手携带 `protocolHash`（强制相等）与 `contentHash`（脚手架）。`pnpm smoke:bun` 可对现入口做 Bun hello 探针（宿主迁移仍为 P1）。
- **客户端**：Svelte 大厅与 Pixi 牌桌；固定本人席位＋基础 AI，可托管；手动演练用于内容调试；FreeKill 面板、卡面与音频已接入。LocalSession 仍在 App（P2 再迁出浏览器）。
- **联机**：Node 主持端与 WebSocket 协议，逐席投影、构建摘要核对、断线重连、同房间连续开局。
- **平台**：浏览器；Tauri 桌面壳（Windows 可随包主持房间）。Android 已移除。

## 验证

| 检查                               | 结果         |
| ---------------------------------- | ------------ |
| `pnpm typecheck`                   | （本轮填写） |
| `pnpm lint`                        | （本轮填写） |
| `pnpm format:check`                | （本轮填写） |
| `pnpm docs:check`                  | （本轮填写） |
| `pnpm test`                        | （本轮填写） |
| `pnpm build` + `CI=1 pnpm test:ui` | （本轮填写） |
| `pnpm smoke:bun`                   | （本轮填写） |

## 未完成与下一步

1. **P1**：Bun 宿主迁移（`bun run` 源码入口，旁路 server esbuild→node）。
2. **P2**：宿主独占内核；LocalSession 图退出浏览器。
3. Windows 桌面需在装有 Rust + MSVC 的机器上用 `pnpm tauri build` 重新构建与实机验证。
