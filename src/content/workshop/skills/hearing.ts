import { cardDef, draw, on, skill, Use } from '../../../sdk';

/** 按本局目录判定真实牌类型，因此其他内容与转换锦囊同样适用。 */
export default skill(
  'workshop:hearing',
  '闻策',
  '当你使用锦囊牌时，你可以摸一张牌。',
  on(Use.declared, {
    when: (ctx, use, self) =>
      use.actor === self.owner && cardDef(ctx, use.card.name).type === 'trick',
    ask: '闻策：是否摸一张牌？',
    effect: (ctx, _event, self) => draw(ctx, { player: self.owner, count: 1, reason: self.skill }),
  }),
);
