# 57 · 立绘与作者图片

2026-10-18，标准与演武内容版本 `0.1.15`。渡口为 `0.1.1`，精确依赖 `standard@0.1.15`。

二十五名标准武将已有静态立绘。图片来自用户提供的本地 noname，原始字节复制；对应来源、大小与 SHA-256 见 [资源清单](../src/content/standard/portraits/provenance.json)。许褚在参考素材中名为 `xuzhu.jpg`，在本项目中按现有武将 ID 使用 `xuchu.jpg`。参考项目没有被修改。渡客示例的图片来源另见 [ASSETS](../examples/content/harbor/ASSETS.md)。

## 作者接口

规则武将定义不含图片，包单独声明展示资源：

```ts
import { definePackage, defineGeneral } from '@sgs/sdk';
import portrait from './guest.jpg';

export default definePackage({
  manifest: { id: 'my_pack', name: '我的包', version: '1' },
  generals: [
    defineGeneral({
      id: 'my_pack:guest',
      name: '来客',
      kingdom: '群',
      gender: 'male',
      maxHp: 4,
      skills: [],
    }),
  ],
  generalViews: [{ id: 'my_pack:guest', portrait }],
});
```

`GeneralPresentation` 通过 SDK 导出，字段为 `id` 与 `portrait` URL。省略展示声明时仍可对局，牌桌绘制轮廓。包声明复制并冻结，展示 ID 必须属于本包、不可重复，且必须引用选中内容中的已定义武将；空路径在装配前报错。图片能否解码由客户端处理，不作为规则合法性条件。

宿主标准包的图片由 Vite 输出为带哈希的本地资源；只在席位实际需要时加载。外部作者使用既有 `pnpm content:build <entry.ts> <output.sgs.mjs>`，普通静态图片 import 已验证内联为 data URL，原始字节保持一致。导入后，源码与启用选择沿用 [持久安装](48-content-persistence.md) 的同次写入和版本检查，图片也包含在这份源码中。无需分别选择图片、安装资源服务或保持原文件路径。

这是一条自包含图片交付路径，尚不是通用资源目录或大资源包格式。动态字符串路径不会自动收集文件；作者应使用静态 import。多文件 CSS、Spine atlas/纹理目录、音频和跨模块代码 API 没有因此获得完整交付支持。大量图片内联会增加模块和存储大小，后续独立资源设计仍保留在路线中。

## 投影与绘制

`ResolvedContent.generalViews` 只包含已选择包的展示。离线投影按当前公开武将 ID 提供 `PlayerView.portrait`；当前玩家身份、手牌及私有决策仍使用原有权限。图片不写入 World、事实、规则 GeneralBook 或基础 AI 的 AgentObservation。事实重建依旧重建规则状态，完整 UI 需要原内容包及其展示资源。

`PortraitTextures` 由每张牌桌独占，不使用 Pixi 的全局纹理缓存。相同 URL 的多个席位共用当前纹理；移除最后一个使用者时释放纹理与纹理源；关闭牌桌先销毁场景，再释放纹理。等待解码时移除又重新加入同一路径，旧异步结果也不能覆盖新登记。解码失败保留轮廓，当前登记不反复请求，离开后重新加入允许重试。图片加载不等待规则推进。

原生验收曾发现：牌桌使用 Graphics stencil mask 裁剪立绘时，关闭独立 Spine 渲染器后恢复画面会读取失效的 `geometry`；桌面和触控均可通过反复开关复现。仅重绘场景仍出现失效批次，不能视为修复。最终改为共享纹理源上的 UV frame 裁取，无需 stencil mask；每个 Sprite 销毁时只释放自己的纹理视图。新增 [三次连续开关](../tests/browser/portrait-lifecycle.spec.ts) 回归与实际 Windows 同一路径检查。失败前、仅重绘尝试、修复后专项报告分别保存在 `.artifacts/validation/portrait-lifecycle-before.json`、`portrait-lifecycle-after.json` 与 `portrait-lifecycle-fixed.json`。修复后专项桌面/触控均通过。

图片在原席位框内按比例覆盖，从顶部开始裁取显示区域；没有改写图片文件。角色信息及姓名有独立暗色信息带，体力、目标、连环/护盾、装备和点击区域仍使用原布局。高度小于 64 像素的席位保留简洁文字，优先显示武将名并按宽度收缩，不挤占决策和手牌区域。本人右下、手牌左下、确认在上、牌堆右上与记录左侧的关系保持原样。

静态 canvas 的 `data-portraits` 只列出当前场景中已解码并添加立绘的公开席位，供浏览器/原生验收读取，不含图片源、纹理或规则写入入口。

## 验证与边界

- [展示场景](../tests/scenarios/general-presentation.test.ts)：声明隔离与冻结、装配错误、图片不进入 AI/状态/历史，以及二十五张原始文件与来源清单哈希。
- [纹理生命周期](../src/client/table/portraits.test.ts)：同图多席、释放、旧异步结果、坏图与重新加入。
- [真实作者模块](../tests/scenarios/content-modules.test.ts)：实际 Vite 构建后导入宿主，对内联图片逐字节比对源文件；既有真实技能与基础 AI 对局继续验证。
- [浏览器](../tests/browser/client.spec.ts) 与 [持久安装](../tests/browser/content-storage.spec.ts)：标准及外部图片真实进入场景，坏图仍可选择，刷新后恢复并真实发动潮声；同时保存桌面/触控截图供人工检查。
- [原生重启](../scripts/smoke-content-restart.mjs)：不同 Windows 进程恢复后，渡客与关羽立绘均进入场景，继续真实使用备航/潮声。

这批仅补静态武将展示和自包含作者图片。标准包全部技能分支、复杂内容、高级托管、联机和 Android 构建不在本批完成范围。完整回归与当前 Windows 构建结果以 [STATUS](STATUS.md) 为准。
