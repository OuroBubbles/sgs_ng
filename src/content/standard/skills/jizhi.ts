import { cardDef, draw, skill, on, Use } from '../../../sdk';

/** 跟随实体/零材料虚拟牌；有材料的转换牌不发动标准集智。 */
export default skill(
  'standard:jizhi',
  '集智',
  '当你使用非转化的普通锦囊牌时，你可以摸一张牌。',
  on(Use.declared, {
    who: (use) => use.actor,
    when: (ctx, { card }) => {
      const def = cardDef(ctx, card.name);
      return (
        def.type === 'trick' &&
        !def.delayed &&
        (card.source === null || card.materials.length === 0)
      );
    },
    ask: '集智：是否摸一张牌？',
    effect: (ctx, _use, self) => draw(ctx, { player: self.owner, count: 1, reason: self.skill }),
  }),
);
