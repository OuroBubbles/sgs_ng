# 59 · 受限分组与角色分配

状态：受限分组的当前契约，使用既有 ArrangementSelection 与普通纯函数。内容版本、平台与实际验证范围以 [STATUS](STATUS.md) 为准。

## 一套分组语义

[ArrangementSelection](../src/core/decisions/arrangement.ts) 仍表示“每件当前物品恰好进入一个具名组，组内顺序保留”。原有上下限不变，新增动态组和逐项接收条件：

```ts
const model = new ArrangementSelection({
  items: () => pool.remaining().map((id) => ({ id, label: labelOf(id) })),
  groups: () =>
    recipients().map((player) => ({
      id: player.id,
      label: player.name,
      count: { min: 0, max: player.quota },
    })),
  canPlace: (item, group) => canReceive(item, group),
});
const result = await ctx.ask(
  model.decision(actor, '分配牌', {
    presentation: 'distribution',
    reason: skillId,
  }),
);
```

`groups` 仍可传只读数组，也可传返回当前组与额度的纯函数。可选 `canPlace(itemId, groupId)` 是普通纯函数，省略时全部兼容。物品/组 ID 必须稳定且唯一；额度和布尔返回值会检查。静态声明复制冻结，动态列表每次读取均取得独立快照。模型不认识角色、手牌或阵营，也不移动实体；未分出的部分可由作者显式定义“保留”组。

初始方案、描述和最终验证均读取当前物品、组及允许矩阵。结果按当前组顺序归一化，保留用户的组内顺序。普通观星仍按原候选顺序全部留在牌顶。

## 可完成性需要真实方案

总容量足够不代表有解：两组各要一件，却都只接受同一件物品时，第二件无处可放。不能把这种情况发布为无法完成的必选菜单。

[内部匹配](../src/core/decisions/assignment.ts) 先满足组下限，再通过增广重配剩余物品。初始方案本身证明可完成性；需要换走先前物品才能满足后一个接收者时，会尝试重配。没有隐式枚举分组幂集或添加通用搜索运行时。

有解时 `available()` 为真且 `initial` 可通过同一最终验证；无解或动态组为空时不开放初始必选等待。基础 AI 复用合法初始方案，这保证合法性，不代表高级分配策略。已证明的范围是完整分组、逐组上下限与逐项接收条件；任意跨组关联或加权数值不是本算法已经支持的能力，作者仍可用普通代码编排专用决策。

## 失效刷新也要重查可用性

动态分组反例发现原 [DecisionHub](../src/core/decisions/hub.ts) 只在失效时更新描述/令牌，接收组全部消失后仍保留必选请求。现在显式 invalidate 或 World revision 引发的刷新会先重查 available；无解即按 unavailable 关闭，不继续描述旧候选。

pending、preview、submit、cancel 触发版本刷新时不再返回已经关闭的请求。关闭后的回复拒绝为 closed；仍有解时更新令牌，旧令牌仍拒绝，最终验证仍读最新条件。外部普通变量改变仍需作者显式 invalidate；World 使用既有 revision。回调异常仍是内容错误，纯回调内写状态仍会被拒绝。没有把闭包存入 World 或增加并行写入入口。

## 实际内容与操作

[分筹](../src/content/workshop/allotment.ts) 是普通技能：筹策客准备阶段可观看牌堆顶四张并分配，每名其他存活角色至多一张，红牌仅能交给受伤的其他角色，其余留给自己。牌池不是手牌，条件与面板都读取牌池的当前牌面，不伪装成判定查询。

拒绝不看牌、不支付；发动后失去技能不撤回已宣告后续，主体死亡/终局则不继续看牌。回复后再次校验，与批量移牌提交之间无可插入的异步后效。各组在同一次 moveCards 提交后才开放后效；已完成获得不因后续死亡回滚。公共 `cards.distributed` 只叙述各接收者数量，不公开私有牌名/ID；权威移动事实仍用于重建，不直接透传公共 UI。标准遗计保留逐批交牌及后效交错，没有被改为一次移动。

`presentation: 'distribution'` 只选择呈现，仍共用 arrange、preview 和 submit。destinations 仅向当前授权操作者描述各物品可进入的组；执行闭包留在规则侧。面板标注额度、禁用不兼容转移并隐藏排序箭头。允许草案临时超额以便交换，超额无法确认，移回可修正；确认前无实际移牌或重复支付。普通排序保留原操作。

暂停隐藏私有面板/手牌，恢复按当前请求取得合法初始草案。人类固定甲席，非主控筹策客由基础 AI 自行完成，不交接其私有面板。

复现：启用作者演武，筹策客、两人、AI 关羽、标准＋EX、种子 4。四张恰为两黑两红；黑牌可交乙席，红牌不能交未受伤乙席。两黑都放乙席会超额，移回一张可确认，正常摸牌后甲席 9 张、乙席 5 张。种子 2 的这四张全红，不能当作“必有黑牌”的夹具。

## 验证入口与边界

- [模型](../tests/scenarios/assignment.test.ts)：增广/上下限/动态条件/顺序/纯查询；512 种三物品三组矩阵乘 8 组额度，共 4096 问题，与独立穷举比较。
- [刷新](../tests/scenarios/decision-refresh.test.ts)：五条读取/回复/失效路径不返回关闭请求，且只关闭一次。
- [真实技能](../tests/scenarios/allotment.test.ts)：拒绝、合法/非法分配、原子后效、接收者/主体死亡和终局、来源撤销、权限与两局基础 AI 至胜负。
- [外部模块](../tests/scenarios/content-examples.test.ts)：实际构建/导入演武，使用宿主模型与 Window，真实私取和分配。
- [界面](../tests/browser/allotment.spec.ts) 与 [Windows](../scripts/smoke-native.mjs)：接收限制、超额修正、暂停恢复、真实手牌/材料及非主控 AI。

最终全量检查、原生运行与交付包的范围见 [STATUS](STATUS.md)。
