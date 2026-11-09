import { card } from '../../../sdk';

export default card({
  id: 'standard:jink',
  type: 'basic',
  label: '闪',
  kind: 'dodge',
  description:
    '响应杀时使用，抵消一次杀的效果；万箭齐发要求打出时可以打出。不能在出牌阶段主动使用。',
  response: true,
  use: {
    count: { min: 0, max: 0 },
    target: () => false,
    timings: ['response'],
    execute: () => null,
  },
});
