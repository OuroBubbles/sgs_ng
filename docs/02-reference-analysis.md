# 02 · 参考项目分析

范围：本地 `freekill/` 与 `noname/resources/app/` 的定向静态阅读。两处未取得 Git 提交标识；noname 是带扩展的应用分发目录，不能等同于上游仓库某一版本。本文不是完整质量审计，也没有运行这两个游戏。

## FreeKill：保留结算语义，简化承载方式

| 源码证据                                                                                                                       | 值得吸收的设计                                                     | 新项目的取舍                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [GameEvent](../freekill/lua/server/gameevent.lua)，`parent`、`findParent`、`exec`、`addCleaner`                                | 结算具有父子关系；协程承载顺序；清理是明确职责                     | 用普通 async 流程、显式上下文与作用域承载；不要依赖全局 `RoomInstance` |
| [TriggerEvent](../freekill/lua/core/trigger_event.lua)，`exec`                                                                 | 结算和触发时点分离；同一时点内重查技能资格；行动顺序和选择影响结果 | 保留可等待的同步裁决窗口；公开顺序与重查契约                           |
| [SkillSkeleton](../freekill/ltk/core/skill_skeleton.lua)，`effects`、`effect_spec_list`                                        | 一个外在技能可以组合多种效果                                       | 内容身份与效果组合分离；不为每个组合发明新的技能子类                   |
| [Request](../freekill/lua/server/request.lua)，`ask`、`_finish`                                                                | 多参与者请求、取消、超时、竞速有统一承载                           | 先做单人决策；保留协议值与验证函数的分离，未来批量请求再扩展           |
| [RequestHandler](../freekill/lua/core/request_handler.lua) 与 [主动技请求](../freekill/ltk/core/request_type/active_skill.lua) | 候选、已选、可完成性是不同问题；人和机器共用规则有价值             | 合法性模型不持有 Scene，不返回 UI 节点变更；界面自己投影选择状态       |
| [伤害结算](../freekill/ltk/server/events/hp.lua)，`Damage:main`、`Damage:exit`                                                 | 伤害修改、扣血、濒死与连环需要显式顺序                             | 这些阶段属于伤害规则标准库，不上升为所有事件的统一流水线               |

本地 GameEvent 中仍有兼容字段和基类相等适配；RequestHandler 同时管理选择状态与模拟界面；主工程 README 说明 C++/Qt、Lua 及脚本仓库的分工。这些设计有历史原因，但新项目不必复制它们的跨层协调成本。

需要警惕的不是 Lua 本身，而是一个规则修改要同时追踪多少上下文、桥接数据和客户端副本。单语言也不会自动解决这些问题，必须明确唯一状态所有者。

## noname：保留作者自由，解除对象与 UI 的绑定

| 源码证据                                                                                                                           | 值得吸收的设计                                     | 新项目的取舍                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| [标准技能](../noname/resources/app/character/standard/skill.js)，`stdshushen`、`retongji` 等 async 内容                            | 普通控制流直观；复杂技能可自由组合询问与结算       | 直接采用 async 函数；显式传入上下文，效果调用必须 await                       |
| [GameEvent](../noname/resources/app/noname/library/element/gameEvent.js)，`getParent`、`trigger`、`loop`                           | 父子事件、插入事件、完成后追加流程支撑大量复杂内容 | 保留因果链与嵌套流程；避免以名称拼接自动制造所有 Before/Begin/End/After       |
| [ContentCompiler](../noname/resources/app/noname/library/element/GameEvent/compilers/ContentCompiler.ts)                           | 为不同作者年代的内容形式提供统一入口               | 无兼容需求，只支持一种普通 async 写法；不建立 step/yield/array/async 多编译器 |
| [Player](../noname/resources/app/noname/library/element/player.js)、[Card](../noname/resources/app/noname/library/element/card.js) | 前端内容编写能直接操作对象，反馈快速               | 两者继承 `HTMLDivElement`；新模型必须脱离 DOM，UI 根据 ID 映射对象            |
| [神话技能](../noname/resources/app/character/shenhua/skill.js)，`qiaobian`、`guzheng`                                              | 历史查询、阶段干预、移动和多步骤选择都有真实需求   | 历史按作用域和语义查询；选择逻辑不用 `ui.selected` 或 DOM 区域判等            |

不能把无名杀概括为“只会 step 代码”：本地已存在现代 async 技能和编译支持。主要问题是这些新表达仍处在全局 `game/lib/ui/_status` 与历史模型之中。新项目选择 TypeScript，并不意味着沿用 noname 的对象结构。

## 用复杂技能反推原语

| 参考内容                                                                               | 暴露的真实需求                                     | 应形成的原语                                |
| -------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| [巧变](../freekill/packages/shzl/pkg/mountain/skills/qiaobian.lua)                     | 付费、跳过阶段、分支、多次询问、获得手牌、场上迁移 | 普通控制流 + 阶段句柄 + 支付操作 + 联合选择 |
| [遗计](../freekill/packages/standard/pkg/skills/yiji.lua)                              | 一次伤害多次发动、暂存牌、逐批分配、中途死亡       | 触发发生次数 + 处理区作用域 + 可重复选择    |
| [武圣](../freekill/packages/standard/pkg/skills/wusheng.lua)                           | 实体材料转换为虚拟牌，同时支持使用与响应           | 转换配方 + 统一牌语义 + 统一合法性检查      |
| [白银狮子](../freekill/packages/maneuvering/pkg/skills/silver_lion.lua)                | 后续防御时点仍可修改伤害；离开装备区后仍有后效     | 可变草案/已提交事实分离 + 离场快照          |
| [木牛流马](../freekill/packages/standard_ex/pkg/card/skills/role__wooden_ox_skill.lua) | 附属牌归属、转移与交换、中间处理区                 | 有身份的附属区域 + 原子移动批次             |
| noname 的 `guzheng`                                                                    | “本阶段弃置”与“现在仍在弃牌堆”同时成立             | 历史事实查询 + 当前状态检查，不能只查其一   |

上表只作为机制压力样本。两个社区的具体技能版本不完全相同，不能混合成新项目的默认规则；实施时每个技能必须有明确文本、版本和验收场景。

## 不照搬的结构

- 巨型全局 Room/game 服务入口与隐式当前事件。
- 规则实体继承界面对象，或技能直接刷新界面。
- 通过任意魔法优先级、父事件层数或字符串时点拼接修补顺序。
- 为旧技能形式保留多个解释器或编译器。
- 在选牌界面与规则核心分别实现一套合法性判断。

这不是声称旧项目的这些机制全部错误，而是判断其维护成本不应成为新项目的起点。
