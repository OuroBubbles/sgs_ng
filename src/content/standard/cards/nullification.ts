import { card, resolveCounter } from '../../../sdk';

export default card({
  id: 'standard:nullification',
  type: 'trick',
  label: '无懈可击',
  description:
    '在锦囊效果即将生效时使用，抵消该效果；也可以反制一张无懈可击。反制按目标效果分别结算。',
  use: {
    count: { min: 0, max: 0 },
    target: () => false,
    timings: ['counter'],
    execute: (ctx, { use }) => resolveCounter(ctx, use),
  },
});
