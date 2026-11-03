# 39 · 内容组合与未来扩展接口

内容直接使用普通 TypeScript，由 [createContent](../src/content/catalog.ts) 组合；没有包清单、版本图、安装器、模块胶水或专用编译器。开发写法见 [05](05-authoring.md)，实际完成情况见 [STATUS](STATUS.md)。

## 作者入口

[标准](../src/content/standard/index.ts)、[机制演武](../src/content/workshop/index.ts) 与 [研习示例](../examples/content/study.ts) 都导出 ContentDefinition。开发者显式 import 并组合，不扫描目录，也不要求名称前缀。SDK 导出真实的规则类型和操作，不另造一套解释器。

未来开放扩展保留三处现有接口：ContentDefinition 描述普通定义，createContent 组合目录，RoleMatch / createRoomOptions 接收该目录。以后需要外部加载时可以在这些接口之外实现；当前不预建插件平台。

## 每局装配

RoleMatch 的全部内容统一放在 content 中，可直接传普通 ContentDefinition，也可传 createContent 返回的目录。普通定义在建局时使用同一装配，已有目录直接复用；牌、技能、效果与展示不再展开到对局配置中。组合多份定义仍使用 createContent，无包元数据或部署要求。

ContentCatalog 持有不可变声明，createBooks 每局创建独立 CardBook、SkillBook 和 GeneralBook。skills 是普通 SkillEntry 列表，静态定义在组合时固定，函数条目在每局装配时求值。静态条目与工厂结果按组合后的列表顺序逐项登记；工厂可读取前面已登记的技能，不必把它们拆成另一份 ContentDefinition。工厂返回的一组技能仍以一次批量登记生效，批内错误不会登记其中一部分。技能工厂获得本局真正使用的 CardBook；Window / Query 保留对象身份，函数与闭包仍执行普通 TypeScript。已规范化的技能与转换声明直接共享，不缓存调用者的原始对象或本局工厂结果；局内状态、实例、作用域与随机源不能跨局共享。

组合时复制卡牌结构与静态技能声明，包括目标数量、用途列表和装备能力；不冻结调用者原对象。卡牌的 use、delayed 及装备工厂固定方法入口并保留原接收者，辅助构造函数同样保留接收者。卡牌组合与 CardBook 共用同一规范化函数，已固定的声明直接共享；之后替换原入口不改变新旧目录或牌堆引用。技能的触发、主动、转换及底层 bind / contribution 使用相同方法语义，详见 [技能契约](12-skills-selection-costs.md)。函数内部读取的可变数据及方法间调用仍由开发者管理，不能把局内状态存进共享闭包或定义对象。

牌组的 id / label 与 create 函数在组合时固定；create 保留原接收者，因此普通对象方法和使用私有字段的 class 方法都可直接使用。之后替换原 create 不影响目录；原接收者或闭包中的可变数据仍由开发者管理。每次生成的牌表经同一不可变数据入口复制与校验。

## 构建与导入

使用 pnpm dev、pnpm build 和 pnpm server:build 的常规 TypeScript / Vite 构建。没有 .sgs 或 .sgs.mjs 交付格式，不把源码或模块依赖图传给原生壳。桌面房间只传普通 RoomSetup，其中 practice 选择内置演武内容。

独立主持端可以用 SGS_PRACTICE=1 选择演武；自定义内容直接在普通主持入口中调用 createRoomOptions(setup, content)，再创建 createGameServer。构建脚本允许指定普通 SSR 入口与项目 .artifacts 内的输出目录，测试主持端也使用相同方式。

## 跨模块代码共享

[渡口](../examples/content/harbor/index.ts) 导出 Window、Query 和普通函数，[画阁](../examples/content/gallery/index.ts) 通过普通相对 import 订阅同一对象，并组合其他文件定义的技能。模块身份交给标准 ESM 和常规构建工具，不要求声明依赖、版本、导出注册表或特殊模块 URL。

## 资源与所有权

内置图片、音频和字体通过静态 import 或现有静态目录交给常规构建工具。展示资源不进入 World、事实或 AI。定义中的 URL 可来自内置文件，也可由实际调用者提供。

主持端可以向 createGameServer 传 RemoteAsset 数据；客户端在连接内创建各自 Blob URL，跨局复用，离开释放。调用者只注入目录与媒体数据，不在客户端执行规则源码。真实二进制字节、资源绑定不修改选项 ID、挂起请求与重连见 [主持场景](../tests/scenarios/network-session.test.ts) 与 [浏览器](../tests/browser/network.spec.ts)。

## 持久安装与恢复

旧安装、保存、重载、清空、跨窗口内容库与对应存储已移除；不迁移或删除历史用户数据。这个标题仅保留给历史专题链接，旧恢复说明不再是现行能力。

演武选择是当前会话草稿，刷新后回到标准内容。房间重连使用独立连接凭据；事实重建不等于恢复挂起的函数栈。任意时点存档仍后置。

## 验证与边界

[内容目录](../tests/scenarios/content-catalog.test.ts) 覆盖普通定义、实际目录与混合内容结算；[普通源码示例](../tests/scenarios/content-examples.test.ts) 验证跨文件时点、查询、取消、宣告与来源失效后的后效；[独立效果](../tests/scenarios/effect-content.test.ts) 验证组合、实例隔离与恢复定义；[立绘](../tests/scenarios/general-presentation.test.ts) 验证展示不进入规则状态。

原生验收只验证实际原生程序、离线 AI、暂停与重启、创建/加入房间、两局复用、重连和主持子进程生命周期。已删除的安装和内容恢复不再是原生门槛；平台运行结果只以 STATUS 为准。
