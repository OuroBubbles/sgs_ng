import { expect, it } from 'vitest';
import { createRoleMatch } from '../../src/host/content';
import { standardCardViews } from '../../src/content/standard/presentation';
import { standardCards } from '../../src/content/standard/cards';

it(
  '练习牌组包含所有已实现定义与显示说明，各种牌均能通过确定性初始化到达起手',
  async () => {
    expect(standardCardViews.map((view) => view.id).sort()).toEqual(
      standardCards.map((card) => card.id).sort(),
    );
    const fixtures: Record<string, { seed: number; first: string; hand: readonly string[] }> = {};
    const logging = process.env.SGS_FIXTURE_LOG === '1';
    const cases: Record<
      string,
      {
        seed: number;
        first: string;
        hand: readonly string[];
        target: string;
        judge: object;
        weapon?: string;
      }
    > = {};
    for (let seed = 1; seed <= (logging ? 8192 : 32); seed++) {
      const game = createRoleMatch({ count: 4, seed, preset: 'standard:mechanics' });
      await game.prepare();
      const first = game.progress!.next;
      const hand = [
        ...game.room.world.zone(`${first}:hand`).cards,
        ...game.room.world.zone('draw').cards.slice(0, 2),
      ].map((id) => game.room.world.card(id).name);
      for (const name of hand) fixtures[name] ??= { seed, first, hand };
      if (logging) {
        const players = game.room.world.snapshot.players.map((player) => player.id);
        const target = players[(players.indexOf(first) + 1) % players.length]!;
        const top = game.room.world.card(game.room.world.zone('draw').cards[2]!);
        const sample = {
          seed,
          first,
          hand,
          target,
          judge: { name: top.name, suit: top.suit, rank: top.rank },
        };
        if (seed === 42) cases.baseline42 = sample;
        if (seed === 19) cases.baseline19 = sample;
        if (first === '丙席' && hand.includes('standard:slash')) cases.baseline ??= sample;
        for (const [key, name] of Object.entries({ grace: 'amazing_grace', snatch: 'snatch' }))
          if (first === '甲席' && hand.includes(`standard:${name}`)) cases[key] ??= sample;
        if (
          first === '甲席' &&
          hand.includes('standard:savage_assault') &&
          hand.includes('standard:nullification')
        )
          cases.counter ??= sample;
        if (first === '甲席' && hand.includes('standard:archery_attack')) cases.archery ??= sample;
        const nextHand = [
          ...game.room.world.zone(`${target}:hand`).cards,
          ...game.room.world.zone('draw').cards.slice(2, 4),
        ].map((id) => game.room.world.card(id));
        const armorJudge = game.room.world.card(game.room.world.zone('draw').cards[4]!);
        if (hand.includes('standard:double_swords') && hand.includes('standard:slash'))
          cases.doubleSwords ??= sample;
        if (hand.includes('standard:ice_sword') && hand.includes('standard:slash'))
          cases.iceSword ??= sample;
        const targetHand = game.room.world
          .zone(`${target}:hand`)
          .cards.map((id) => game.room.world.card(id).name);
        if (
          hand.includes('standard:axe') &&
          hand.includes('standard:slash') &&
          targetHand.includes('standard:jink')
        )
          cases.axe ??= sample;
        if (
          hand.includes('standard:blade') &&
          hand.filter((name) => name === 'standard:slash').length >= 2 &&
          targetHand.includes('standard:jink')
        )
          cases.blade ??= sample;
        if (
          hand.filter((name) => name === 'standard:halberd').length === 1 &&
          hand.filter((name) => name === 'standard:slash').length === 1 &&
          hand.every(
            (name) =>
              name === 'standard:slash' ||
              standardCards.find((definition) => definition.id === name)?.equipment,
          )
        )
          cases.halberd ??= sample;
        const horse = hand.find((name) =>
          standardCards
            .find((definition) => definition.id === name)
            ?.equipment?.slot.endsWith('horse'),
        );
        if (
          horse &&
          nextHand.some((card) => card.name === 'standard:kylin_bow') &&
          nextHand.some((card) => card.name === 'standard:slash')
        )
          cases.bow ??= { ...sample, weapon: horse };
        const weapon = ['standard:crossbow', 'standard:qinggang_sword', 'standard:spear'].find(
          (name) => hand.includes(name),
        );
        if (
          first === '甲席' &&
          weapon &&
          hand.includes('standard:slash') &&
          nextHand.some((card) => card.name === 'standard:collateral')
        )
          cases.collateral ??= { ...sample, weapon };
        if (
          first === '甲席' &&
          hand.includes('standard:eight_diagram') &&
          nextHand.some((card) => card.name === 'standard:slash') &&
          ['heart', 'diamond'].includes(armorJudge.suit)
        )
          cases.armorRed ??= { ...sample, judge: armorJudge };
        if (
          first === '甲席' &&
          hand.includes('standard:nioh_shield') &&
          nextHand.some(
            (card) => card.name === 'standard:slash' && ['spade', 'club'].includes(card.suit),
          ) &&
          nextHand.some((card) => card.name === 'standard:qinggang_sword')
        )
          cases.swordShield ??= sample;
        if (
          hand.includes('standard:spear') &&
          hand.includes('standard:crossbow') &&
          (!cases.equipmentPair || (first === '甲席' && cases.equipmentPair.first !== '甲席'))
        )
          cases.equipmentPair = sample;
        if (
          hand.includes('standard:indulgence') &&
          top.suit !== 'heart' &&
          (!cases.indulgenceMiss || (first === '甲席' && cases.indulgenceMiss.first !== '甲席'))
        )
          cases.indulgenceMiss = sample;
        if (
          hand.includes('standard:spear') &&
          (!cases.spear || (first === '甲席' && cases.spear.first !== '甲席'))
        )
          cases.spear = sample;
        if (
          hand.includes('standard:lightning') &&
          (!cases.lightning || (first === '丁席' && cases.lightning.first !== '丁席'))
        ) {
          const next = game.room.world.card(game.room.world.zone('draw').cards[8]!);
          if (!(next.suit === 'spade' && next.rank >= 2 && next.rank <= 9))
            cases.lightning = {
              ...sample,
              judge: { name: next.name, suit: next.suit, rank: next.rank },
            };
        }
      }
      if (
        logging &&
        seed >= 256 &&
        [
          'baseline',
          'counter',
          'archery',
          'grace',
          'snatch',
          'equipmentPair',
          'spear',
          'indulgenceMiss',
          'lightning',
          'armorRed',
          'swordShield',
          'collateral',
          'blade',
          'axe',
          'halberd',
          'bow',
          'doubleSwords',
          'iceSword',
        ].every((key) => cases[key])
      )
        break;
    }
    expect(Object.keys(fixtures).sort()).toEqual(standardCardViews.map((view) => view.id).sort());
    if (logging) console.info(JSON.stringify({ cards: fixtures, cases }));
  },
  process.env.SGS_FIXTURE_LOG === '1' ? 120_000 : 5_000,
);
