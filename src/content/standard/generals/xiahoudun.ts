import { askDiscard, damage, general, judge, skill, trigger, Damage } from '../../../sdk';

export const ganglie = skill({
  id: 'standard:ganglie',
  name: '刚烈',
  description:
    '受到一次伤害后，你可以判定。若不为红桃，伤害来源须弃置两张手牌，否则受到你造成的 1 点伤害。',
  triggers: [
    trigger(Damage.received, {
      who: (hit) => hit.input.to,
      ask: '是否发动【刚烈】进行判定？',
      async effect(ctx, hit, self) {
        const source = hit.input.from;
        const result = await judge(ctx, {
          player: self.owner,
          reason: self.skill,
          match: (_at, card) => card.suit !== 'heart',
        });
        if (!result.matched || source === null) return;
        const discarded = await askDiscard(ctx, source, {
          count: 2,
          prompt: '刚烈：弃置两张手牌，否则受到 1 点伤害',
          cancel: '承受伤害',
          reason: self.skill,
        });
        if (!discarded)
          await damage(ctx, { from: self.owner, to: source, amount: 1, nature: 'normal' });
      },
    }),
  ],
});

export default general({
  id: 'standard:xiahoudun',
  name: '夏侯惇',
  kingdom: '魏',
  hp: 4,
  skills: [ganglie],
});
