# 协作约定

继承 `C:/home/AGENTS.md`。

- 先读 [STATUS](docs/STATUS.md)；架构与结算边界见 [03](docs/03-architecture.md)、[04](docs/04-resolution.md)。按任务阅读相关契约。
- 小而明确的运行核、可组合规则库、普通 TypeScript 内容代码。UI / AI 消费规则与视图，不另写一套合法性判据。
- 安装：`sgs-ng install`（pnpm 11.25.0 冻结锁文件）；开发：`sgs-ng dev`。
- 类型检查：`sgs-ng typecheck`；完整检查：`sgs-ng check`；界面改动另跑 `sgs-ng ui`。原生构建与设备验收按平台文档执行。
- 同一时间仅一个代码写入者；在 STATUS 记录任务范围、验收与剩余边界。参考源码保持只读。
