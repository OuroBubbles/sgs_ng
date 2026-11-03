import type { ContentDefinition } from '../../../src/content/catalog';
import { modify, on, invoke, recover } from '../../../src/sdk';
import { Provision, provisionBy, tideDrawBonus } from '../harbor';
import portrait from '../harbor/guest.jpg';
import type { SkillDefinition } from '../../../src/sdk';

const ink = {
  id: 'gallery:ink',
  name: '墨韵',
  description: '你的潮声额外摸一张。你的备航结算结束后，若你已受伤，可以回复1点体力。',
  modifiers: [
    modify(tideDrawBonus, (_ctx, { input, self }) => (input.actor === self.owner ? 1 : undefined)),
  ],
  triggers: [
    on(Provision.finished, {
      when: (ctx, event, self) =>
        provisionBy(event, self.owner) &&
        ctx.world.player(self.owner).hp < ctx.world.player(self.owner).maxHp,
      async effect(ctx, _event, self) {
        if (await invoke(ctx, self, '是否发动【墨韵】回复1点体力？'))
          await recover(ctx, { from: self.owner, to: self.owner, amount: 1 });
      },
    }),
  ],
} satisfies SkillDefinition;

/** 普通 import 共享依赖的 Window/Query/函数，图片由常规构建工具处理。 */
export default {
  skills: [ink],
  generals: [
    {
      id: 'gallery:guest',
      name: '画阁客',
      kingdom: '群',
      gender: 'male',
      maxHp: 4,
      skills: ['harbor:tide', 'standard:wusheng', 'gallery:ink'],
    },
  ],
  generalViews: [{ id: 'gallery:guest', portrait }],
} satisfies ContentDefinition;
