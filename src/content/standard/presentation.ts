import type { CardKind } from '../../protocol';
import type { CardPresentation } from '../catalog';
import { standardCardMedia } from './media';

const descriptions: Readonly<
  Record<string, { readonly kind: CardKind; readonly description: string }>
> = {
  'standard:double_swords': {
    kind: 'equipment',
    description:
      '武器，攻击范围 2。使用杀指定异性目标时，可令其弃置一张手牌，否则你摸一张牌。双性与有性别角色可构成异性，无性别不构成异性。',
  },
  'standard:ice_sword': {
    kind: 'equipment',
    description:
      '武器，攻击范围 2。你的杀将造成伤害时，可防止该伤害，依次弃置目标至多两张手牌或装备。每次选择都按当前区域重新生成。',
  },
  'standard:blade': {
    kind: 'equipment',
    description:
      '武器，攻击范围 3。你的杀被闪抵消后，可对原目标再使用一张杀，忽略距离与出牌阶段次数。',
  },
  'standard:axe': {
    kind: 'equipment',
    description: '武器，攻击范围 3。你的杀被闪抵消后，可弃置两张其他手牌或装备，使此杀仍造成伤害。',
  },
  'standard:halberd': {
    kind: 'equipment',
    description:
      '武器，攻击范围 4。使用杀的材料包含全部手牌时，可额外选择至多两个目标；零材料且空手不满足条件。',
  },
  'standard:kylin_bow': {
    kind: 'equipment',
    description: '武器，攻击范围 5。你的杀造成伤害时，可弃置受伤角色的一张坐骑。',
  },
  'standard:collateral': {
    kind: 'trick',
    description:
      '选择一名有武器的其他角色，再指定其攻击范围内一个合法杀目标。前者对后者使用一张杀，否则你获得其武器。',
  },
  'standard:eight_diagram': {
    kind: 'equipment',
    description:
      '防具。当你需要使用或打出闪时，可进行判定。若结果为红色，视为按当前用途使用或打出一张闪。',
  },
  'standard:qinggang_sword': {
    kind: 'equipment',
    description: '武器，攻击范围 2。你使用杀时，此杀的目标防具失效。',
  },
  'standard:nioh_shield': {
    kind: 'equipment',
    description: '防具。黑色杀对你无效。',
  },
  'standard:indulgence': {
    kind: 'trick',
    description:
      '放入一名其他角色的判定区。其判定阶段进行判定，若不为红桃，跳过本回合下一个出牌阶段；生效时可被无懈。',
  },
  'standard:lightning': {
    kind: 'trick',
    description:
      '放入自己的判定区。判定黑桃 2–9 时受到无来源的 3 点雷电伤害；否则或被无懈时传给下一名合法角色。',
  },
  'standard:crossbow': {
    kind: 'equipment',
    description: '武器，攻击范围 1。你的出牌阶段使用杀没有次数限制。作为杀的材料时不能借用此能力。',
  },
  'standard:spear': {
    kind: 'equipment',
    description: '武器，攻击范围 3。你可将两张手牌当杀使用或打出。',
  },
  'standard:chitu': {
    kind: 'equipment',
    description: '进攻坐骑。你计算与其他角色的距离时减 1，至少为 1。',
  },
  'standard:dayuan': {
    kind: 'equipment',
    description: '进攻坐骑。你计算与其他角色的距离时减 1，至少为 1。',
  },
  'standard:zixing': {
    kind: 'equipment',
    description: '进攻坐骑。你计算与其他角色的距离时减 1，至少为 1。',
  },
  'standard:jueying': {
    kind: 'equipment',
    description: '防御坐骑。其他角色计算与你的距离时加 1。',
  },
  'standard:dilu': {
    kind: 'equipment',
    description: '防御坐骑。其他角色计算与你的距离时加 1。',
  },
  'standard:zhuahuangfeidian': {
    kind: 'equipment',
    description: '防御坐骑。其他角色计算与你的距离时加 1。',
  },
  'standard:nullification': {
    kind: 'trick',
    description:
      '在锦囊效果即将生效时使用，抵消该效果；也可以反制一张无懈可击。反制按目标效果分别结算。',
  },
  'standard:savage_assault': {
    kind: 'trick',
    description: '对所有其他角色使用，各目标须打出杀，否则受到你造成的 1 点伤害。',
  },
  'standard:archery_attack': {
    kind: 'trick',
    description: '对所有其他角色使用，各目标须打出闪，否则受到你造成的 1 点伤害。',
  },
  'standard:god_salvation': {
    kind: 'trick',
    description: '对所有角色使用，各目标回复 1 点体力。未受伤者跳过效果。',
  },
  'standard:amazing_grace': {
    kind: 'trick',
    description: '按目标数展示牌堆顶牌，各目标依次选择一张获得。未被获得的余牌置入弃牌堆。',
  },
  'standard:snatch': {
    kind: 'trick',
    description: '对距离为 1 的一名其他角色使用，获得其手牌、装备或判定区的一张牌。手牌只能暗选。',
  },
  'standard:dismantlement': {
    kind: 'trick',
    description: '对一名有牌的其他角色使用，弃置其手牌、装备或判定区的一张牌。手牌只能暗选。',
  },
  'standard:slash': {
    kind: 'slash',
    description:
      '出牌阶段限一次，对攻击范围内一名其他角色使用。其须使用闪抵消，否则受到你造成的 1 点伤害。',
  },
  'standard:jink': {
    kind: 'dodge',
    description:
      '响应杀时使用，抵消一次杀的效果；万箭齐发要求打出时可以打出。不能在出牌阶段主动使用。',
  },
  'standard:peach': {
    kind: 'peach',
    description: '出牌阶段回复自己 1 点体力；救援时可对濒死角色使用，使其回复 1 点体力。',
  },
  'standard:duel': {
    kind: 'duel',
    description: '对一名其他角色使用。从目标开始轮流打出杀，首先未打出者受到对方造成的 1 点伤害。',
  },
  'standard:ex_nihilo': {
    kind: 'draw',
    description: '出牌阶段对自己使用，摸两张牌。',
  },
};

export const standardCardViews: readonly CardPresentation[] = Object.entries(descriptions).map(
  ([id, view]) => ({
    id,
    kind: view.kind,
    description: view.description,
    ...standardCardMedia(id),
  }),
);
