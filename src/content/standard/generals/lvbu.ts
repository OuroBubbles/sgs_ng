import { general, skill, trigger, Target } from '../../../sdk';

export const wushuang = skill({
  id: 'standard:wushuang',
  name: '无双',
  description: '锁定技，你使用杀需要目标连续使用两张闪；与你决斗的角色每次需连续打出两张杀。',
  triggers: [
    trigger(Target.specified, {
      locked: true,
      who: ({ effect }) => effect.actor,
      when: (_ctx, { effect }) =>
        effect.state === 'targeting' &&
        ['standard:slash', 'standard:duel'].includes(effect.card.name),
      effect: (ctx, { effect }, self) => effect.requireResponses(ctx, effect.target, 2, self.skill),
    }),
    trigger(Target.confirmed, {
      locked: true,
      who: ({ effect }) => effect.target,
      when: (_ctx, { effect }) =>
        effect.state === 'targeting' && effect.card.name === 'standard:duel',
      effect: (ctx, { effect }, self) => effect.requireResponses(ctx, effect.actor, 2, self.skill),
    }),
  ],
});

export default general({
  id: 'standard:lvbu',
  name: '吕布',
  kingdom: '群',
  hp: 4,
  skills: [wushuang],
});
