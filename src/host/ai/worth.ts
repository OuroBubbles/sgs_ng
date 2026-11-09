import type { Room } from '../../core/runtime/room';
import type { Context } from '../../core/runtime/room';
import { counterNames } from '../../rules/cards/counter';
import { handLimit } from '../../rules/cards/rule';
import type { CardDefinition } from '../../rules/cards/types';
import { isChained } from '../../rules/combat/chain';
import { rescueNames } from '../../rules/combat/rescue';
import { shieldOf } from '../../rules/combat/shield';
import { resultOf } from '../../rules/game/end';
import type { SkillBook } from '../../rules/skills/skills';
import { pendingExtraTurns } from '../../rules/turn/extra';
import { activeTurn } from '../../rules/turn/turn';

/**
 * 局面估值：AI 唯一的“价值观”，只认内核语义，不认具体牌名、武将或技能。
 * 每名存活角色的实力 = 体力（越低越珍贵）+ 手牌（超出手牌上限的部分几乎无用）+ 装备
 * + 护甲 − 判定区待生效的牌 − 横置 + 排队中的额外回合；按观察者立场加权求和，终局直接定胜负。
 */
const WIN = 1000;
const hpPoint = (level: number): number => 2 + 12 / level;
const hpWorth = (hp: number): number => {
  let total = 0;
  for (let i = 1; i <= hp; i++) total += hpPoint(i);
  return total;
};
/**
 * 每点护甲替本人挡下下一点伤害，价值等同于此刻将要失去的那点体力；
 * 超过一条满体力的护甲不再计价（够不着的保护没有意义，也避免无止境地叠护甲）。
 */
const shieldWorth = (hp: number, maxHp: number, shield: number): number =>
  Math.min(shield, maxHp) * hpPoint(Math.max(1, hp));
/** 他人手牌：看不到牌面，按一张普通牌的威胁计。 */
const UNSEEN = 3;
const EXCESS = 0;
const BASE = 1.5;

/** 装备在场的价值：武器按攻击范围略增。 */
export function equipWorth(definition: CardDefinition | undefined): number {
  const equipment = definition?.equipment;
  if (!equipment) return 0;
  return 4 + Math.max(0, (equipment.range ?? 1) - 1) * 0.5;
}

/**
 * 一张牌留在手里的价值（也是作为费用的代价）：保底 1.5；能在别人的回合里用的牌更值得留——
 * 可应答 +1.5（也能主动使用的只 +0.5），可反制 +2，内核濒死救援认可的牌 +6；装备牌按装上后的价值。
 * 同名牌边际递减：手里已有 copies 张时，再多一张的额外价值只算 1/copies。
 */
export function keepWorth(rules: SkillBook, name: string, copies = 1): number {
  const definition = rules.cards.get(name);
  if (!definition) return BASE;
  if (definition.equipment) return equipWorth(definition) - 1;
  const timings = definition.use?.timings;
  let bonus = 0;
  // 只能用来应答的牌（闪）全靠留着；也能主动打出的牌（杀）多半会被打出，留作应答的价值小。
  if (definition.response || timings?.includes('response'))
    bonus += !timings || timings.includes('play') ? 0.5 : 1.5;
  if (timings?.includes('counter') || counterNames.includes(name)) bonus += 2;
  if (rescueNames.includes(name)) bonus += 6;
  return BASE + bonus / Math.max(1, copies);
}

/** 一手牌各自的留牌价值（同名第 k 张按边际价值计）。 */
export function handWorths(rules: SkillBook, names: readonly string[]): number[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const copies = (seen.get(name) ?? 0) + 1;
    seen.set(name, copies);
    return keepWorth(rules, name, copies);
  });
}

function strength(ctx: Context, rules: SkillBook, player: string, own: boolean): number {
  const world = ctx.world;
  const seat = world.player(player);
  if (!seat.alive) return 0;
  // 手牌上限在回合结束才生效：本人自己的回合里多出的牌仍可打出，照常计价。
  const limit =
    own && activeTurn.of(world)?.owner === player ? Infinity : Math.max(0, handLimit(ctx, player));
  const hand = world.zone(`${player}:hand`).cards;
  const cards = own
    ? handWorths(
        rules,
        hand.map((id) => world.card(id).name),
      ).sort((a, b) => b - a)
    : hand.map(() => UNSEEN);
  const held = cards.reduce((sum, worth, index) => sum + (index < limit ? worth : EXCESS), 0);
  const equipment = world
    .zone(`${player}:equipment`)
    .cards.reduce((sum, id) => sum + equipWorth(rules.cards.get(world.card(id).name)), 0);
  const pending = world.zone(`${player}:judgment`).cards.length;
  const extra = pendingExtraTurns(world).filter((turn) => turn.owner === player).length;
  return (
    hpWorth(Math.max(0, seat.hp)) +
    held +
    equipment +
    shieldWorth(seat.hp, seat.maxHp, shieldOf(world, player)) -
    pending * 5 -
    (isChained(world, player) ? 1.5 : 0) +
    extra * 10
  );
}

/** 观察者眼中的局面价值；stance 为立场（自己 1、友方正、敌方负）。 */
export function worth(
  room: Room,
  rules: SkillBook,
  viewer: string,
  stance: (player: string) => number,
): number {
  return room.inspect((ctx) => {
    const result = resultOf(ctx.world);
    if (result) return result.winners.includes(viewer) ? WIN : -WIN;
    let total = 0;
    for (const player of ctx.world.snapshot.players) {
      const weight = stance(player.id);
      if (weight) total += weight * strength(ctx, rules, player.id, player.id === viewer);
    }
    return total;
  });
}
