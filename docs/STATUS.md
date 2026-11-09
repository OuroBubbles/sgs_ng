# 当前状态

更新：2026-11-09（P7 托管 AI 去硬编码：AI 自己推演定权重，作者不写 AI）。单一写入者。

## 已有

- **规则**：World / Flow / 时点 / Decision / Fact 运行核；用牌为自由函数管线（无 CardBook），多目标牌用有序目标元组；标准＋EX 26 将 42 技能、32 种 108 张牌；身份模式；机制演武（额外武将与演练牌组）。契约见 [ARCHITECTURE](ARCHITECTURE.md)，裁定见 [RULINGS](RULINGS.md)。
- **内容**：普通 TypeScript 源码组合是唯一内容路径，只有一种写法（`skill` / `general` / `card` / `equipment` / `delayedCard` 位置参数作者层），只从 [SDK](../src/sdk/index.ts) 导入（110 个值）；主持端启动时扫描 `src/content/<包>/`（`package.ts` 只描述牌组与顺序，`generals/*.ts`、`skills/*.ts`、`cards/*.ts` 各一文件一定义），放入文件、重启即生效，无登记表；持续效果（裸衣）是带技能的回合标记；标准武将原包顺序由 `order` 固定，新文件按文件名追加，牌与技能按文件名；牌的规则说明写在定义上，武将与牌的媒体按 `public/<包>/` 约定发现，载入时校验重复 ID、文件名与导出形状。安装与持久内容库已删除。
- **托管 AI（P7）**：[src/host/ai](../src/host/ai/think.ts) 是独立系统，内容与 SDK 里没有 AI 字段，AI 里没有牌、武将或技能 ID。按本席所知重新洗配看不见的牌与身份，在同一规则的副本里续行本回合推演候选，用只认内核语义的局面估值比较；别人回合里的响应与中途选择用立场反射，反制先推演被反制的效果。新放入的武将/技能零 AI 代码即可被合理使用（[放入测试](../tests/scenarios/ai-drop-in.test.ts)）。
- **前后端分离（P0–P2）**：`src/protocol` 是线协议与展示视图的唯一定义；规则、内容、投影、AI 与会话只在 `src/host`（Bun 主持端）运行，网页包只含界面与素材（eslint 禁令、导入图测试、构建产物标记扫描三道检查）。大厅目录经 `GET /catalog` 获取。握手携带 `protocolHash`（强制相等）；主持端 hello 与 `/catalog` 附运行时计算的 `contentHash`（P3）。`pnpm smoke:bun` 用 Bun 从源码起宿主并完成 hello 入座（已并入 `pnpm check`）。
- **客户端**：Svelte 大厅与 Pixi 牌桌；固定本人席位＋托管 AI，可托管；手动演练用于内容调试；FreeKill 面板、卡面与音频已接入。单机经本机 Bun 主持端开局（`pnpm dev` 自动拉起），与联机共用 RemoteSession。
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

1. **托管 AI 的已知短板**：别人回合里的中途选择（鬼才改判、流离、遗计分牌等）只用立场反射，不推演；不从行为推断身份；每次决策只想象一种隐藏信息；同座位对旧手写 AI 的胜率约为其八成，内奸几乎不赢；演练牌组（护盾、八卦、治疗密集）里约两到三成对局超过 200 回合。改进应落在通用推演与估值上。
2. 内核（rules + core）现 11353 行（P6 时 11292，P7 为局面分叉增加生命周期接管与回合续行）；行数只作参照，后续以结构为准。回放头（尚无回放格式）记录 `contentHash`。
3. **P8**：Tauri 随包主持端改 Bun（`bun.exe` + 源码或 `bun build --compile`）；启动时拉起回环主持端，补齐打包后桌面单机（P2 缺口，见 [ARCHITECTURE](ARCHITECTURE.md#现有适配边界)）。
4. Windows 桌面需在装有 Rust + MSVC 的机器上用 `pnpm tauri build` 重新构建与实机验证。
