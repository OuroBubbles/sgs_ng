import { general, modify, on, recover, skill, wounded } from '../../../src/sdk';
import type { ContentDefinition } from '../../../src/sdk';
import wusheng from '../../../src/content/standard/skills/wusheng';
import { Provision, provisionBy, tide, tideDrawBonus } from '../harbor';
import portrait from '../harbor/guest.jpg';

const ink = skill(
  'gallery:ink',
  '墨韵',
  '你的潮声额外摸一张。你的备航结算结束后，若你已受伤，可以回复1点体力。',
  modify(tideDrawBonus, (_ctx, { input, self }) => (input.actor === self.owner ? 1 : undefined)),
  on(Provision.finished, {
    when: (ctx, event, self) => provisionBy(event, self.owner) && wounded(ctx, self.owner),
    ask: '是否发动【墨韵】回复1点体力？',
    effect: (ctx, _event, self) => recover(ctx, { from: self.owner, to: self.owner, amount: 1 }),
  }),
);

/** 普通 import 共享依赖的 Window/Query/函数与技能对象，图片由常规构建工具处理。 */
export default {
  generals: [general('gallery:guest', '画阁客', '群', 4, [tide, wusheng, ink])],
  generalViews: [{ id: 'gallery:guest', portrait }],
} satisfies ContentDefinition;
