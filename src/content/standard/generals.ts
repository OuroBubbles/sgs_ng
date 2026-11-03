import {
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
} from '../../sdk';
import type {
  Context,
  SkillHandle,
  PhaseView,
  MoveResult,
  ActiveInput,
  GeneralDefinition,
} from '../../sdk';
import { wusheng } from './wusheng';
import { longdan, paoxiao, qixi } from './martial';
import { ganglie, luoyi, qingguo, luoshen } from './wei';
import { guicai, fankui, tiandu, yiji } from './strategists';
import { jianxiong, hujia, tuxi } from './commanders';
import { rende, jijiang, qingnang, jijiu } from './benevolence';
import { zhiheng, jiuyuan, keji, qianxun, lianying } from './wu';
import { jizhi, qicai, wushuang, guose, liuli } from './tacticians';
import { mashu, tieqi, yingzi, fanjian, lijian, biyue } from './intrigue';
import { guanxing, kongcheng } from './astrology';
import type { SkillDefinition } from '../../sdk';

/** 标准版苦肉：不限次数；失去体力完整经过濒死与救援，存活才摸牌。 */
export const kurou = {
  id: 'standard:kurou',
  name: '苦肉',
  description:
    '出牌阶段，你可以失去 1 点体力，然后摸两张牌。不限次数；濒死时先完成救援，存活才摸牌。',
  active: [
    {
      id: 'lose-hp-draw',
      async run(ctx, { self }) {
        const paid = await pay(ctx, {
          skill: self,
          reason: self.skill,
          factKind: 'skill.invoked',
          declaration: { label: self.name },
        });

        if (paid.kind !== 'paid') return;
        await loseHp(ctx, { player: self.owner, amount: 1, reason: self.skill });

        await draw(ctx, { player: self.owner, count: 2, reason: self.skill });
      },
    },
  ],
} satisfies SkillDefinition;

const jieyinLimit = (self: SkillHandle, phase: PhaseView) => ({
  key: 'jieyin',
  source: self.skill,
  lifetime: phase.lifetime,
  max: 1,
});
function jieyinSelection(ctx: Context, { self, book }: ActiveInput): JointSelection {
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
        .map((player) => player.id),
    cardCount: { min: 2, max: 2 },
    targetCount: { min: 1, max: 1 },
  });
}
/** 标准版结姻：两张手牌、一名受伤男性；不要求本人受伤；出牌阶段一次。 */
export const jieyin = {
  id: 'standard:jieyin',
  name: '结姻',
  description:
    '出牌阶段限一次，弃置两张手牌，令一名受伤的其他男性角色和你各回复 1 点体力。你无需处于受伤状态。',
  active: [
    {
      id: 'discard-heal',
      available: (ctx, { self, phase }) =>
        used(ctx.world, self.owner, jieyinLimit(self, phase)) === 0,
      selection: jieyinSelection,
      async run(ctx, { self, phase, book, choice, selection: model }) {
        const paid = await payDiscard(ctx, book, {
          skill: self,
          cards: choice.cards,
          areas: ['hand'],
          reason: self.skill,
          limit: jieyinLimit(self, phase),
          legal: () => !phase.turn?.ended && model.validate(choice).ok,
          factKind: 'skill.invoked',
          declaration: { label: self.name, targets: choice.targets },
        });

        if (paid.kind !== 'paid') return;
        // 支付后效可能移走技能、杀死来源或目标；宣告不回滚，两个回复各自按当前状态结算。
        const target = choice.targets[0]!;
        await recover(ctx, { from: self.owner, to: target, amount: 1 });
        await recover(ctx, { from: self.owner, to: self.owner, amount: 1 });
      },
    },
  ],
} satisfies SkillDefinition;

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
export const xiaoji = {
  id: 'standard:xiaoji',
  name: '枭姬',
  description: '当你失去装备区里的一张牌后，你可以摸两张牌。一次失去多张时，逐张选择是否发动。',
  triggers: [
    on(cardsMoved, {
      times: (_ctx, { payload: moved, self }) => lostEquipment(moved, self.owner).length,
      order: 'choose',
      when: (_ctx, { payload: moved, self }) => lostEquipment(moved, self.owner).length > 0,
      async run(ctx, { self, occurrence }) {
        const progress =
          occurrence.total > 1 ? `（第 ${occurrence.index}/${occurrence.total} 次）` : '';
        const answer = await invoke(ctx, self, `是否发动【枭姬】摸两张牌？${progress}`);

        if (answer) await draw(ctx, { player: self.owner, count: 2, reason: self.skill });
      },
    }),
  ],
} satisfies SkillDefinition;

/** 静态定义与目录工厂并列；每局装配时绑定实际 CardBook，局内不重建目录。 */
export const standardGeneralSkills = [
  wusheng,
  kurou,
  jieyin,
  xiaoji,
  longdan,
  paoxiao,
  qixi,
  ganglie,
  luoyi,
  qingguo,
  luoshen,
  guicai,
  fankui,
  tiandu,
  yiji,
  jianxiong,
  hujia,
  tuxi,
  rende,
  jijiang,
  qingnang,
  jijiu,
  zhiheng,
  jiuyuan,
  keji,
  qianxun,
  lianying,
  jizhi,
  qicai,
  wushuang,
  guose,
  liuli,
  mashu,
  tieqi,
  yingzi,
  fanjian,
  lijian,
  biyue,
  guanxing,
  kongcheng,
] as const;
export const standardGenerals = [
  {
    id: 'standard:guanyu',
    name: '关羽',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 4,
    skills: [wusheng.id],
  },
  {
    id: 'standard:huanggai',
    name: '黄盖',
    kingdom: '吴',
    gender: 'male',
    maxHp: 4,
    skills: [kurou.id],
  },
  {
    id: 'standard:sunshangxiang',
    name: '孙尚香',
    kingdom: '吴',
    gender: 'female',
    maxHp: 3,
    skills: [xiaoji.id, jieyin.id],
  },
  {
    id: 'standard:zhaoyun',
    name: '赵云',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 4,
    skills: [longdan.id],
  },
  {
    id: 'standard:zhangfei',
    name: '张飞',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 4,
    skills: [paoxiao.id],
  },
  {
    id: 'standard:ganning',
    name: '甘宁',
    kingdom: '吴',
    gender: 'male',
    maxHp: 4,
    skills: [qixi.id],
  },
  {
    id: 'standard:xiahoudun',
    name: '夏侯惇',
    kingdom: '魏',
    gender: 'male',
    maxHp: 4,
    skills: ['standard:ganglie'],
  },
  {
    id: 'standard:xuchu',
    name: '许褚',
    kingdom: '魏',
    gender: 'male',
    maxHp: 4,
    skills: ['standard:luoyi'],
  },
  {
    id: 'standard:zhenji',
    name: '甄姬',
    kingdom: '魏',
    gender: 'female',
    maxHp: 3,
    skills: ['standard:luoshen', qingguo.id],
  },
  {
    id: 'standard:simayi',
    name: '司马懿',
    kingdom: '魏',
    gender: 'male',
    maxHp: 3,
    skills: ['standard:guicai', 'standard:fankui'],
  },
  {
    id: 'standard:guojia',
    name: '郭嘉',
    kingdom: '魏',
    gender: 'male',
    maxHp: 3,
    skills: [tiandu.id, yiji.id],
  },
  {
    id: 'standard:caocao',
    name: '曹操',
    kingdom: '魏',
    gender: 'male',
    maxHp: 4,
    skills: [jianxiong.id, hujia.id],
  },
  {
    id: 'standard:zhangliao',
    name: '张辽',
    kingdom: '魏',
    gender: 'male',
    maxHp: 4,
    skills: ['standard:tuxi'],
  },
  {
    id: 'standard:liubei',
    name: '刘备',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 4,
    skills: [rende.id, jijiang.id],
  },
  {
    id: 'standard:huatuo',
    name: '华佗',
    kingdom: '群',
    gender: 'male',
    maxHp: 3,
    skills: [qingnang.id, jijiu.id],
  },
  {
    id: 'standard:sunquan',
    name: '孙权',
    kingdom: '吴',
    gender: 'male',
    maxHp: 4,
    skills: [zhiheng.id, jiuyuan.id],
  },
  {
    id: 'standard:lvmeng',
    name: '吕蒙',
    kingdom: '吴',
    gender: 'male',
    maxHp: 4,
    skills: [keji.id],
  },
  {
    id: 'standard:luxun',
    name: '陆逊',
    kingdom: '吴',
    gender: 'male',
    maxHp: 3,
    skills: [qianxun.id, lianying.id],
  },
  {
    id: 'standard:huangyueying',
    name: '黄月英',
    kingdom: '蜀',
    gender: 'female',
    maxHp: 3,
    skills: ['standard:jizhi', 'standard:qicai'],
  },
  {
    id: 'standard:lvbu',
    name: '吕布',
    kingdom: '群',
    gender: 'male',
    maxHp: 4,
    skills: [wushuang.id],
  },
  {
    id: 'standard:daqiao',
    name: '大乔',
    kingdom: '吴',
    gender: 'female',
    maxHp: 3,
    skills: [guose.id, 'standard:liuli'],
  },
  {
    id: 'standard:machao',
    name: '马超',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 4,
    skills: [mashu.id, 'standard:tieqi'],
  },
  {
    id: 'standard:zhouyu',
    name: '周瑜',
    kingdom: '吴',
    gender: 'male',
    maxHp: 3,
    skills: [yingzi.id, fanjian.id],
  },
  {
    id: 'standard:diaochan',
    name: '貂蝉',
    kingdom: '群',
    gender: 'female',
    maxHp: 3,
    skills: [lijian.id, biyue.id],
  },
  {
    id: 'standard:zhugeliang',
    name: '诸葛亮',
    kingdom: '蜀',
    gender: 'male',
    maxHp: 3,
    skills: ['standard:guanxing', kongcheng.id],
  },
] as const satisfies readonly GeneralDefinition[];
