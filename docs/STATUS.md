# 当前状态

更新：2026-11-03。项目 `C:/workspace/sgs-ng`，单一写入者。方向与取舍见[路线](11-offline-roadmap.md)，日常开发从[作者入口](05-authoring.md)阅读。

当前按个人开发、AI 辅助组织源码，持续迭代到 SoTA。源码组合是唯一内容路径；包图、清单、专用编译器、安装平台和持久内容库已删除。未来扩展保留 ContentDefinition / createContent / 目录注入，不预建分发平台。

## 装配与配置所有权

[createContent](../src/content/catalog.ts) 直接组合普通定义，无命名空间要求。技能为静态声明：武将经 `general(id, name, kingdom, hp, skills)` 携带技能对象，createContent 自动登记（同一对象只登记一次），`skills` 列表只放不属于武将的技能；回调经 `rulesOf(ctx)` 取本局目录。标准武将一将一文件，由 glob 自动收集。独立效果显式装配。目录先规范化，再用同一份快照检查重复和建立索引；Window / Query 对象身份保留，方法入口固定并保留原接收者，作者对象不被冻结。

[RoleMatch](../src/app/offline/role-match.ts) 接受普通内容定义或目录，牌组可用 ID 或直接实体牌表；同一份固定牌表用于验证和初始化。[离线入口](../src/app/offline/practice.ts) 的人数与阵容配置互斥，正常界面使用明确阵容，人数入口保留手动演练预设。准备页与开局共用 App 草稿。CardBook 基础策略按需提供，默认策略、技能查询和最终验证仍使用同一规则实现。

## 技能声明与调用接口

内置与示例技能直接声明普通对象，以 triggers / active / viewAs / modifiers 组合能力，回调使用显式 Context 与具名输入；普通分支、循环、闭包与 await 可编排动态选择、支付和嵌套结算。底层 bind / contribution 接口与独立效果 create(self) 闭包保留。主动与转换菜单可省略 label，取当前技能实例名；主动提交的 instance 表示来源实例，菜单的 skill 表示定义 ID。

联合选择、单选和分组选择从选项读取 id / label 后形成快照，支持原型 getter；动态候选每次重读，数量范围统一规范化。Decision 可省略静态 data，Hub 在没有 describe 时补齐 null。UI / AI 共用规则预览和最终验证。支付、次数和宣告原子提交，支付后效完整结束后返回；普通支付和弃牌费用共用实现，原因与继续条件仍显式表达。

具体接口见[作者入口](05-authoring.md)、[技能与支付](12-skills-selection-costs.md)及[用牌](13-card-use.md)。历史来源资格和执行侧登记资格分别见[保留后效](43-retained-effects.md)与[Provider](44-provider-lifecycle.md)，不把已离场来源伪装成当前有效。

## 当前接口与交互

- [启动页与大厅](../src/client/panels/LobbyShell.svelte) 参考 FreeKill 的立绘与菜单分区：快捷开局、人数切换、主控头像换将及单机 / 联机 / 内容导航。小窗口首屏也可开局；单机大厅将常用设置与默认折叠的“演练与复现”分组，错误种子自动展开。武将一览使用当前目录，可检索、选将；切页保留配置与展开状态，原房间可恢复。桌面与小屏触控共用流程，大厅不加载战场实现或 Pixi；开局时按需加载并创建渲染器。
- [本地客户端](16-local-client.md) 固定甲席视角，其余角色由基础 AI 决策；技能、牌、材料和目标共用草稿一次提交，唯一目标自动选择。手动演练单独用于内容调试。FreeKill 面板、卡面和音频已经接入，资源声明与规则分开。
- [联机入口](../src/app/network/) 复用同一对局与逐席投影，支持创建 / 加入、房间配置、托管、断线和关闭。远端只接收展示、媒体与决策，不执行规则源码；媒体由 RemoteAsset 注入，离开时释放。安装与内容库入口均已移除。

## 当前验证

运行源码摘要保持 `9d5365adc7be4bbf50b11c3320cab4027af9e54f138d5a31d6ad9edc9d184303`。本轮合并支付的取消与最终条件失效场景：同一 Room 中先取消，再次真实提交选择后令目标失效，验证费用、次数与手牌均未改变。原条件失效场景没有经过选择提交；现在两条路径连接成完整重试流程，减少一份 Room 初始化与 10 行测试代码。公共技能类型与运行实现保持。

| 项目           | 证据与范围                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完整检查       | `payment-selection-check.log`：pnpm check 通过；82 文件 / 1476 项，类型、lint、文档、构建及标准行为 72/72 主体、172 条语义、479 个独立通过场景，0 pending。支付文件 17 项通过                              |
| 测试减法       | `payment-selection-audit.json`：两项支付场景合并为一项，1477→1476；旧场景 6 处断言的 5 个不同不变量均保留，次数等检查在取消与条件失效后分别执行，新增真实重试提交。其余顶层语句保持，无测试门槛或规则改动  |
| 整局与标准矩阵 | 当前 25 局标准矩阵与改动前相同；运行源码与 `payment-source-audit.json` 完全一致，复用其三种整局 11005 / 674 / 977 条事实逐字节一致、决策数/胜负/末态及重建验证，未重复运行相同源码的采样                   |
| 界面验证边界   | 最近的 `lobby-refresh-ui.log` 与 browser.json 对应 bfd86407：桌面 / 触控 182 项通过，0 失败、跳过或 flaky；`lobby-handoff-layout.json` 覆盖四种尺寸、首屏开局与大厅 0 战场画布。本轮仅改测试，未重跑浏览器 |

日志在 .artifacts/ui/，JSON 在 .artifacts/validation/。不为压缩类型数量改变复杂技能的输入语义；本轮没有运行源码或接口变化，原生候选安装包未重建或重验。

## 离线承载力依据

运行边界见[架构](03-architecture.md)与[结算](04-resolution.md)。AI 观察在一次同步只读边界完成，无跨决策缓存；Scope.path 固定为规范快照。World.prepare 共享未变化的冻结表，批量变更保持原子性；空变更仍推进 revision。查询、预览与最终提交使用当前来源资格。装备仅在移牌事实中合并历史来源，私有牌池的可见者标记直接归 Processing 生存期管理。

当前规则行为证据采用上方验证。早期 CPU 采样、尝试与撤回记录保存在忽略的 validation 产物中。

## 交付与工具

Windows Release 与候选 ZIP 对应已验 bc2be06b；后续源码调整尚未入包。构建目录与独立解压件均通过离线 AI 整局、暂停草稿、战场释放、真实进程重启后开局和本机双客户端验证，0 控制台错误。双客户端覆盖配置、端口冲突、请求保留、同一主持端连续两局、重建与拥有者退出清理；独立解压件实际启动其 host/node.exe。证据为 desktop-bc2b-summary / integrity 和 target / zip 目录。只证明本机 Windows，不证明任意时点续局、跨机器或双端互通。

- 程序：`src-tauri/target/release/sgs-ng.exe`，SHA-256 `f59832c477859d297b29c841e42c9092fd17bba732ca7da8c3c6ef6d34d162c0`。
- 候选 ZIP：`.artifacts/builds/sgs-ng-0.1.0-windows-x64-source-candidate.zip`，55280720 字节，SHA-256 `cdd9136ea25a18bd991ab845436727bcf9978b5e86ec7fa2ddcf1b68fb591a6e`。6 个成员的包内与解压字节均核对通过，清单为 source-candidate-manifest.json；上一已验包按原字节保留，映射见 desktop-bc2b-before.json。
- Android：`.artifacts/builds/sgs-ng-0.1.0-android-arm64-candidate.apk`，37756138 字节，SHA-256 `191982d6098b308cd26b05c584e845e29c42f69e1fd2c1bd6e1fd92f8827504e`。候选源码 bc2be06b、ARM64 Debug、min/target SDK 24/36；完整编译、签名与静态核验通过，证据为 android-bc2b-package.json，交付清单为 android-source-candidate-manifest.json。旧 APK 按原字节保留，映射见 android-bc2b-before.json。accepted 仍为 false，Android 运行、真机、实际 16 KB 运行和双端互通未验；旧 SystemUI ANR / QEMU 崩溃根因仍未确认。

工具复用共享 SDK / JDK / NDK，项目状态独立；命令见[开发入口](08-development-guide.md)。旧 SDK 与此前受阻目录未清理；互通复合探针、Android 软键盘探针和部分旧目录清理被自动审批拒绝，未重试或计为通过，记录保留在 peer-restart-delivery 等产物中。

## 未完成与下一步

1. 继续以真实复杂技能检查选择、支付与来源生存期，保持显式 ctx、动态选择和嵌套结算；只为实际开发摩擦重构，不增加重复规则、包装或框架。测试优先复用与合并独立断言。
2. 现有两端候选同属已验 bc2be06b；后续源码调整尚未入包，稳定后按既有入口重建。Android 运行验收、真机、第二台 Windows 及双端互通仍未验证。
3. 启动大厅与战场继续按实际使用反馈打磨。Spine、完整录像及任意时点续局仍后置。
