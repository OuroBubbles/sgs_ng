# 当前状态

更新：2026-11-04（R0 清仓之后）。单一写入者。

## 已有

- **规则**：World / Flow / 时点 / Decision / Fact 运行核；标准＋EX 25 将 40 技能、32 种 108 张牌；身份模式；机制演武（额外武将与演练牌组）。契约见 [ARCHITECTURE](ARCHITECTURE.md)，裁定见 [RULINGS](RULINGS.md)。
- **内容**：普通 TypeScript 源码组合是唯一内容路径；标准武将一将一文件，由 glob 收集。包格式、安装与持久内容库已删除；未来扩展只保留 `ContentDefinition` / `createContent` / 目录注入。
- **客户端**：Svelte 大厅与 Pixi 牌桌；固定本人席位＋基础 AI，可托管；手动演练用于内容调试；FreeKill 面板、卡面与音频已接入。
- **联机**：Node 主持端与 WebSocket 协议，逐席投影、构建摘要核对、断线重连、同房间连续开局。
- **平台**：浏览器；Tauri 桌面壳（Windows 可随包主持房间）。Android 已移除。

## 验证

| 检查                               | 结果                   |
| ---------------------------------- | ---------------------- |
| `pnpm typecheck`                   | 0 错误                 |
| `pnpm lint`                        | 通过                   |
| `pnpm format:check`                | 通过                   |
| `pnpm docs:check`                  | 通过                   |
| `pnpm test`                        | 82 文件 / 1418 项通过  |
| `pnpm build` + `CI=1 pnpm test:ui` | 桌面 / 触控 182 项通过 |

本轮没有在 Linux 上编译 Rust 壳，也没有重建或重验 Windows 安装包；此前的候选包与验证记录已随打包脚本一起删除。

## 未完成与下一步

1. 按设计评估路线继续：R1 拆分 CardBook，R2 收敛状态键与生存期，R3 收窄 SDK 导出，之后再处理客户端与测试结构。
2. Windows 桌面需在装有 Rust + MSVC 的机器上用 `pnpm tauri build` 重新构建与实机验证；跨机器联机尚未验收。
3. Spine 播放、完整录像与任意时点续局仍后置。
