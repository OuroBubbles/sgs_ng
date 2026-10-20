import {
  defineGeneral,
  defineSkill,
  JointSelection,
  ownedCards,
  pay,
  payDiscard,
  used,
  loseHp,
  draw,
  recover,
  genderOf,
  on,
  cardsMoved,
  invoke,
  isGameOver,
} from '../../sdk';
import type { Context, SkillHandle, PhaseView, MoveResult, CardBook } from '../../sdk';
import { wusheng } from './wusheng';
import { longdan, paoxiao, qixi } from './martial';
import { ganglie, luoyi, luoyiAftereffect, qingguo, luoshen } from './wei';
import { guicai, fankui, tiandu, yiji } from './strategists';
import { jianxiong, hujia, tuxi } from './commanders';
import { rende, jijiang, qingnang, jijiu } from './benevolence';
import { zhiheng, jiuyuan, keji, qianxun, lianying } from './wu';
import { jizhi, qicai, wushuang, guose, liuli } from './tacticians';
import { mashu, tieqi, yingzi, fanjian, lijian, biyue } from './intrigue';
import { guanxing, kongcheng } from './astrology';

/** 标准版苦肉：不限次数；失去体力完整经过濒死与救援，存活才摸牌。 */
export const kurou = defineSkill({
  id: 'standard:kurou',
  name: '苦肉',
  description:
    '出牌阶段，你可以失去 1 点体力，然后摸两张牌。不限次数；濒死时先完成救援，存活才摸牌。',
  effects: [],
  active: [
    {
      id: 'lose-hp-draw',
      label: '苦肉',
      available: () => true,
      async run(ctx, self) {
        const paid = await pay(ctx, {
          actor: self.owner,
          skill: self,
          cards: [],
          to: 'discard',
          reason: self.skill,
          factKind: 'skill.invoked',
          declaration: { label: self.name },
        });
        if (paid.kind === 'aborted') return ctx.abort(paid.reason);
        if (paid.value.kind !== 'paid') return;
        const loss = await loseHp(ctx, { player: self.owner, amount: 1, reason: self.skill });
        if (loss.kind === 'aborted') return ctx.abort(loss.reason);
        if (ctx.world.player(self.owner).alive && !isGameOver(ctx.world))
          await draw(ctx, { player: self.owner, count: 2, reason: self.skill });
      },
    },
  ],
});

const jieyinLimit = (self: SkillHandle, phase: PhaseView) => ({
  key: 'jieyin',
  source: self.skill,
  lifetime: phase.lifetime,
  max: 1,
});
function jieyinSelection(ctx: Context, self: SkillHandle, book: CardBook): JointSelection {
  return new JointSelection({
    cards: () =>
      ownedCards(ctx.world, self.owner)
        .filter((card) =>
          book.canDiscard(ctx, { actor: self.owner, owner: self.owner, card, reason: self.skill }),
        )
        .map((id) => ({ id, label: ctx.world.card(id).name })),
    targets: () =>
      ctx.world.snapshot.players
        .filter(
          (player) =>
            player.id !== self.owner &&
            player.alive &&
            player.hp < player.maxHp &&
            ['male', 'dual'].includes(genderOf(ctx.world, player.id)),
        )
        .map((player) => ({ id: player.id, label: player.id })),
    cardCount: { min: 2, max: 2 },
    targetCount: { min: 1, max: 1 },
  });
}
/** 标准版结姻：两张手牌、一名受伤男性；不要求本人受伤；出牌阶段一次。 */
export const jieyin = defineSkill({
  id: 'standard:jieyin',
  name: '结姻',
  description:
    '出牌阶段限一次，弃置两张手牌，令一名受伤的其他男性角色和你各回复 1 点体力。你无需处于受伤状态。',
  effects: [],
  active: [
    {
      id: 'discard-heal',
      label: '结姻',
      available: (ctx, self, phase, book) =>
        used(ctx.world, self.owner, jieyinLimit(self, phase)) === 0 &&
        jieyinSelection(ctx, self, book).inspect({ cards: [], targets: [] }).valid,
      async run(ctx, self, phase, book) {
        const model = jieyinSelection(ctx, self, book);
        const answer = await ctx.ask(
          model.decision(self.owner, '结姻：弃置两张手牌，选择一名受伤男性角色', true, {
            cancelLabel: '取消发动',
            reason: self.skill,
          }),
        );
        if (answer.kind !== 'chosen') return;
        const paid = await payDiscard(ctx, book, {
          actor: self.owner,
          skill: self,
          cards: answer.value.cards,
          areas: ['hand'],
          reason: self.skill,
          limit: jieyinLimit(self, phase),
          legal: () => !phase.turn?.ended && model.validate(answer.value).ok,
          factKind: 'skill.invoked',
          declaration: { label: self.name, targets: answer.value.targets },
        });
        if (paid.kind === 'aborted') return ctx.abort(paid.reason);
        if (paid.value.kind !== 'paid') return;
        // 支付后效可能移走技能、杀死来源或目标；宣告不回滚，两个回复各自按当前状态结算。
        const target = answer.value.targets[0]!;
        if (ctx.world.player(target).alive)
          await recover(ctx, { from: self.owner, to: target, amount: 1 });
        if (ctx.world.player(self.owner).alive)
          await recover(ctx, { from: self.owner, to: self.owner, amount: 1 });
      },
    },
  ],
});

function lostEquipment(moved: MoveResult, owner: string): readonly string[] {
  const after = new Set(
    moved.after
      .filter((zone) => zone.kind === 'equipment' && zone.owner === owner)
      .flatMap((zone) => zone.cards),
  );
  return moved.before
    .filter((zone) => zone.kind === 'equipment' && zone.owner === owner)
    .flatMap((zone) => zone.cards.filter((id) => !after.has(id)));
}
export const xiaoji = defineSkill({
  id: 'standard:xiaoji',
  name: '枭姬',
  description: '当你失去装备区里的一张牌后，你可以摸两张牌。一次失去多张时，逐张选择是否发动。',
  effects: [
    on(cardsMoved, {
      id: 'lost-equipment',
      times: (_ctx, moved, self) => lostEquipment(moved, self.owner).length,
      order: 'choose',
      when: (_ctx, moved, self) => lostEquipment(moved, self.owner).length > 0,
      async run(ctx, _moved, self, occurrence) {
        const progress =
          occurrence.total > 1 ? `（第 ${occurrence.index}/${occurrence.total} 次）` : '';
        const answer = await invoke(ctx, self, `是否发动【枭姬】摸两张牌？${progress}`);
        if (answer.kind === 'aborted') return ctx.abort(answer.reason);
        if (answer.value) await draw(ctx, { player: self.owner, count: 2, reason: self.skill });
      },
    }),
  ],
});

/** 显式注入牌规则；定义工厂只在装配期调用，局内不重新构建目录。 */
export function standardGeneralSkills(book: CardBook) {
  book.effects.register([luoyiAftereffect]);
  return [
    wusheng,
    kurou,
    jieyin,
    xiaoji,
    longdan,
    paoxiao,
    qixi,
    ganglie(book),
    luoyi(book),
    qingguo,
    luoshen(book),
    guicai(book),
    fankui(book),
    tiandu,
    yiji,
    jianxiong,
    hujia,
    tuxi(book),
    rende,
    jijiang,
    qingnang,
    jijiu,
    zhiheng,
    jiuyuan,
    keji,
    qianxun,
    lianying,
    jizhi(book),
    qicai(book),
    wushuang,
    guose,
    liuli(book),
    mashu,
    tieqi(book),
    yingzi,
    fanjian,
    lijian,
    biyue,
    guanxing(book),
    kongcheng,
  ] as const;
}
export const standardGenerals = [
  defineGeneral({
    id: 'standard:guanyu',
    name: '关羽',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 4,
    skills: [wusheng.id],
  }),
  defineGeneral({
    id: 'standard:huanggai',
    name: '黄盖',
    kingdom: '吴',
    gender: 'male',
    maxHp: 4,
    skills: [kurou.id],
  }),
  defineGeneral({
    id: 'standard:sunshangxiang',
    name: '孙尚香',
    kingdom: '吴',
    gender: 'female',
    maxHp: 3,
    skills: [xiaoji.id, jieyin.id],
  }),
  defineGeneral({
    id: 'standard:zhaoyun',
    name: '赵云',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 4,
    skills: [longdan.id],
  }),
  defineGeneral({
    id: 'standard:zhangfei',
    name: '张飞',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 4,
    skills: [paoxiao.id],
  }),
  defineGeneral({
    id: 'standard:ganning',
    name: '甘宁',
    kingdom: '吴',
    gender: 'male',
    maxHp: 4,
    skills: [qixi.id],
  }),
  defineGeneral({
    id: 'standard:xiahoudun',
    name: '夏侯惇',
    kingdom: '魏',
    gender: 'male',
    maxHp: 4,
    skills: ['standard:ganglie'],
  }),
  defineGeneral({
    id: 'standard:xuchu',
    name: '许褚',
    kingdom: '魏',
    gender: 'male',
    maxHp: 4,
    skills: ['standard:luoyi'],
  }),
  defineGeneral({
    id: 'standard:zhenji',
    name: '甄姬',
    kingdom: '魏',
    gender: 'female',
    maxHp: 3,
    skills: ['standard:luoshen', qingguo.id],
  }),
  defineGeneral({
    id: 'standard:simayi',
    name: '司马懿',
    kingdom: '魏',
    gender: 'male',
    maxHp: 3,
    skills: ['standard:guicai', 'standard:fankui'],
  }),
  defineGeneral({
    id: 'standard:guojia',
    name: '郭嘉',
    kingdom: '魏',
    gender: 'male',
    maxHp: 3,
    skills: [tiandu.id, yiji.id],
  }),
  defineGeneral({
    id: 'standard:caocao',
    name: '曹操',
    kingdom: '魏',
    gender: 'male',
    maxHp: 4,
    skills: [jianxiong.id, hujia.id],
  }),
  defineGeneral({
    id: 'standard:zhangliao',
    name: '张辽',
    kingdom: '魏',
    gender: 'male',
    maxHp: 4,
    skills: ['standard:tuxi'],
  }),
  defineGeneral({
    id: 'standard:liubei',
    name: '刘备',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 4,
    skills: [rende.id, jijiang.id],
  }),
  defineGeneral({
    id: 'standard:huatuo',
    name: '华佗',
    kingdom: '群',
    gender: 'male',
    maxHp: 3,
    skills: [qingnang.id, jijiu.id],
  }),
  defineGeneral({
    id: 'standard:sunquan',
    name: '孙权',
    kingdom: '吴',
    gender: 'male',
    maxHp: 4,
    skills: [zhiheng.id, jiuyuan.id],
  }),
  defineGeneral({
    id: 'standard:lvmeng',
    name: '吕蒙',
    kingdom: '吴',
    gender: 'male',
    maxHp: 4,
    skills: [keji.id],
  }),
  defineGeneral({
    id: 'standard:luxun',
    name: '陆逊',
    kingdom: '吴',
    gender: 'male',
    maxHp: 3,
    skills: [qianxun.id, lianying.id],
  }),
  defineGeneral({
    id: 'standard:huangyueying',
    name: '黄月英',
    kingdom: '蜀',
    gender: 'female',
    maxHp: 3,
    skills: ['standard:jizhi', 'standard:qicai'],
  }),
  defineGeneral({
    id: 'standard:lvbu',
    name: '吕布',
    kingdom: '群',
    gender: 'male',
    maxHp: 4,
    skills: [wushuang.id],
  }),
  defineGeneral({
    id: 'standard:daqiao',
    name: '大乔',
    kingdom: '吴',
    gender: 'female',
    maxHp: 3,
    skills: [guose.id, 'standard:liuli'],
  }),
  defineGeneral({
    id: 'standard:machao',
    name: '马超',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 4,
    skills: [mashu.id, 'standard:tieqi'],
  }),
  defineGeneral({
    id: 'standard:zhouyu',
    name: '周瑜',
    kingdom: '吴',
    gender: 'male',
    maxHp: 3,
    skills: [yingzi.id, fanjian.id],
  }),
  defineGeneral({
    id: 'standard:diaochan',
    name: '貂蝉',
    kingdom: '群',
    gender: 'female',
    maxHp: 3,
    skills: [lijian.id, biyue.id],
  }),
  defineGeneral({
    id: 'standard:zhugeliang',
    name: '诸葛亮',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 3,
    skills: ['standard:guanxing', kongcheng.id],
  }),
] as const;
