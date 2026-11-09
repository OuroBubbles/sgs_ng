# 当前状态

更新：2026-11-09（P6 作者层收口：单一 SDK 入口、一将一技一牌各一文件、持续效果即带技能的标记）。单一写入者。

## 已有

- **规则**：World / Flow / 时点 / Decision / Fact 运行核；用牌为自由函数管线（无 CardBook），多目标牌用有序目标元组；标准＋EX 26 将 42 技能、32 种 108 张牌；身份模式；机制演武（额外武将与演练牌组）。契约见 [ARCHITECTURE](ARCHITECTURE.md)，裁定见 [RULINGS](RULINGS.md)。
- **内容**：普通 TypeScript 源码组合是唯一内容路径，只有一种写法（`skill` / `general` / `card` / `equipment` / `delayedCard` 位置参数作者层），只从 [SDK](../src/sdk/index.ts) 导入（110 个值）；主持端启动时扫描 `src/content/<包>/`（`package.ts` 只描述牌组与顺序，`generals/*.ts`、`skills/*.ts`、`cards/*.ts` 各一文件一定义），放入文件、重启即生效，无登记表；持续效果（裸衣）是带技能的回合标记；标准武将原包顺序由 `order` 固定，新文件按文件名追加，牌与技能按文件名；牌的规则说明写在定义上，武将与牌的媒体按 `public/<包>/` 约定发现，载入时校验重复 ID、文件名与导出形状。安装与持久内容库已删除。
- **前后端分离（P0–P2）**：`src/protocol` 是线协议与展示视图的唯一定义；规则、内容、投影、AI 与会话只在 `src/host`（Bun 主持端）运行，网页包只含界面与素材（eslint 禁令、导入图测试、构建产物标记扫描三道检查）。大厅目录经 `GET /catalog` 获取。握手携带 `protocolHash`（强制相等）；主持端 hello 与 `/catalog` 附运行时计算的 `contentHash`（P3）。`pnpm smoke:bun` 用 Bun 从源码起宿主并完成 hello 入座（已并入 `pnpm check`）。
- **客户端**：Svelte 大厅与 Pixi 牌桌；固定本人席位＋基础 AI，可托管；手动演练用于内容调试；FreeKill 面板、卡面与音频已接入。单机经本机 Bun 主持端开局（`pnpm dev` 自动拉起），与联机共用 RemoteSession。
- **联机**：Bun 主持端（`pnpm server` 直接跑 TypeScript 源码，无 server 构建产物）与 WebSocket 协议，逐席投影、构建摘要核对、断线重连、同房间连续开局。
- **平台**：浏览器；Tauri 桌面壳（Windows 可随包主持房间；随包主持端仍是 Node + Vite SSR 产物，改 Bun 留待 P8；打包后单机暂缺本机主持端，`pnpm tauri dev` 可用）。Android 已移除。

## 验证

| 检查                               | 结果                                        |
| ---------------------------------- | ------------------------------------------- |
| `pnpm typecheck`                   | 0 错误                                      |
| `pnpm lint`                        | 通过                                        |
| `pnpm format:check`                | 通过                                        |
| `pnpm docs:check`                  | 通过                                        |
| `pnpm test`                        | 85 文件 / 1406 项通过（含 32 局回放金标准） |
| `pnpm build` + `CI=1 pnpm test:ui` | 桌面 / 触控 182 项通过                      |
| `pnpm smoke:bun`                   | 通过（Bun 1.4.4）                           |
| `pnpm build` 产物标记扫描          | 无主持端标记                                |

## 未完成与下一步

2. 内核（rules + core）现 11292 行（299a289 时 12073）；行数只作参照，后续以结构为准。回放头（尚无回放格式）记录 `contentHash`。
3. **P8**：Tauri 随包主持端改 Bun（`bun.exe` + 源码或 `bun build --compile`）；启动时拉起回环主持端，补齐打包后桌面单机（P2 缺口，见 [ARCHITECTURE](ARCHITECTURE.md#现有适配边界)）。
4. Windows 桌面需在装有 Rust + MSVC 的机器上用 `pnpm tauri build` 重新构建与实机验证。
