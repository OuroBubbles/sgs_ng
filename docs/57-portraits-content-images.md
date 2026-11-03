# 57 · 展示资源：立绘、标记与音频

当前版本与平台验收见 [STATUS](STATUS.md)，源码与二进制资源的交付见 [39](39-source-packages.md)。

二十五名标准武将的默认立绘已统一替换为用户提供的本地 FreeKill 原图；来源、大小与 SHA-256 见 [资源清单](../src/content/standard/portraits/provenance.json)。原 noname 默认图不再保留为第二套皮肤，参考项目保持只读。渡客示例仍有独立来源，见 [ASSETS](../examples/content/harbor/ASSETS.md)。

## 作者接口

规则武将定义不含图片，普通内容定义单独声明展示资源。以下示例以 `examples/content/harbor/` 为目录，使用已有的 `guest.jpg`：

```ts
import type { ContentDefinition } from '../../../src/sdk';
import portrait from './guest.jpg';

export default {
  generals: [
    {
      id: 'guest',
      name: '来客',
      kingdom: '群',
      gender: 'male',
      maxHp: 4,
      skills: [],
    },
  ],
  generalViews: [{ id: 'guest', portrait }],
} satisfies ContentDefinition;
```

`GeneralPresentation` 通过 SDK 导出，除 `id` 外可提供 `portrait`、`deathVoice` 和 `voices`。`voices` 按技能定义 ID 对应一组台词 URL；无需立绘即可只提供声音。`CardPresentation` 可提供完整卡面 `image`、区域 `icon` 与按 `male` / `female` 选择的 `voices`。资源使用普通静态 import；省略资源仍可对局。组合时读取声明字段形成冻结快照，再检查展示 ID 唯一且引用已组合的武将或牌；普通对象与原型 getter 使用相同入口，不冻结调用者原对象。显式提供的空立绘路径在装配时报错，解码失败不改变规则合法性。

资源由常规 Vite 构建输出为本地文件，图片与音频不等待规则推进。使用静态 import 或已有静态目录；没有独立内容包格式、安装或持久恢复。接口见 [内容组合](39-source-packages.md)。

FreeKill UI、音效、标准武将台词和阵亡语音的原始来源见 [清单](../src/assets/freekill/provenance.json)。技能、用牌、打出、摸牌、伤害、阵亡和胜负的公开事实提供播放提示；草稿与取消不产生发动语音。播放器按事实序号去重，开局音乐、音效与台词分声道播放，待播队列有界。暂停、后台、静音和关闭会话停止播放并丢弃旧队列，恢复时不补播；自动播放限制和设备静音不影响结算。

## 投影与绘制

`ContentCatalog.generalViews` 只包含实际组合内容的展示。离线投影按当前公开武将 ID 提供 `PlayerView.portrait`；当前玩家身份、手牌及私有决策仍使用原有权限。图片不写入 World、事实、规则 GeneralBook 或基础 AI 的 AgentObservation。事实重建依旧重建规则状态，完整 UI 需要相应的内容定义与展示资源。

`PortraitTextures` 由每张牌桌独占，不使用 Pixi 的全局纹理缓存。相同 URL 的多个席位共用当前纹理；移除最后一个使用者时释放纹理与纹理源；关闭牌桌先销毁场景，再释放纹理。等待解码时移除又重新加入同一路径，旧异步结果也不能覆盖新登记。解码失败保留轮廓，当前登记不反复请求，离开后重新加入允许重试。图片加载不等待规则推进。

原生验收曾发现：牌桌使用 Graphics stencil mask 裁剪立绘时，关闭独立 Spine 渲染器后恢复画面会读取失效的 `geometry`；桌面和触控均可通过反复开关复现。仅重绘场景仍出现失效批次，不能视为修复。最终改为共享纹理源上的 UV frame 裁取，无需 stencil mask；每个 Sprite 销毁时只释放自己的纹理视图。新增 [三次连续开关](../tests/browser/portrait-lifecycle.spec.ts) 回归与实际 Windows 同一路径检查。失败前、仅重绘尝试、修复后专项报告分别保存在 `.artifacts/validation/portrait-lifecycle-before.json`、`portrait-lifecycle-after.json` 与 `portrait-lifecycle-fixed.json`。修复后专项桌面/触控均通过。

立绘在 FreeKill 面板的原始图片区域内按比例覆盖并居中裁取，圆角使用带纹理的直接几何填充；面板底图在其后完整绘制，没有改写原始图片，也不使用 stencil mask。裁取纹理视图与填充几何随当前场景释放，原始纹理源仍由 PortraitTextures 独占。信息、装备、判定和选择区域的布局见 [25](25-table-position.md)。缺图或解码失败使用 FreeKill 默认图；Pixi 底图与立绘仍由当前牌桌独占，切换草稿不再重绘静态牌桌。

静态 canvas 的 `data-portraits` 只列出当前场景中已解码并添加立绘的公开席位，供浏览器/原生验收读取，不含图片源、纹理或规则写入入口。

## 验证与边界

- [展示场景](../tests/scenarios/general-presentation.test.ts)：声明隔离与冻结、装配错误、图片不进入 AI/状态/历史，以及二十五张原始文件与来源清单哈希。
- [纹理生命周期](../src/client/table/portraits.test.ts)：同图多席、释放、旧异步结果、坏图与重新加入。
- [普通源码示例](../tests/scenarios/content-examples.test.ts)：跨文件共享时点、查询及普通函数后实际执行技能；[联机](../tests/browser/network.spec.ts) 对远端图片逐字节核对。
- [浏览器](../tests/browser/client.spec.ts) 检查内置图片真实进入场景与坏图回退；[远端资源](../tests/browser/network.spec.ts) 检查外部图片、真实技能与连接内资源释放。
- [原生验证](../scripts/verify-windows.ps1)：实际程序验证启动、离线 AI、暂停、重启和房间生命周期；当前结果以 STATUS 为准。

资源的字节核对、实际媒体解码和当前 Windows 构建结果以 [STATUS](STATUS.md) 为准。平台播放设备与音量仍受用户系统设置控制；Android 与双端联机的未验收边界同样见 STATUS。
