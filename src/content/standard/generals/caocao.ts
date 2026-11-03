import {
  general,
  obtain,
  others,
  alive,
  kingdomOf,
  peers,
  skill,
  on,
  Response,
  Damage,
} from '../../../sdk';
import type { Context, EffectRef, ResponseOpportunity } from '../../../sdk';

const materialsHere = (ctx: Context, card: EffectRef | undefined): card is EffectRef =>
  !!card &&
  card.card.materials.length > 0 &&
  card.card.materials.every((id) => ctx.world.position(id) === card.processing);

export const jianxiong = skill({
  id: 'standard:jianxiong',
  name: '奸雄',
  description:
    '受到一次伤害后，你可以获得造成此伤害的牌。其全部实体材料须仍在此次用牌的处理区中；没有实体材料的牌无法获得。',
  triggers: [
    on(Damage.received, {
      who: (hit) => hit.input.to,
      when: (ctx, hit) => materialsHere(ctx, hit.input.card),
      ask: '是否发动【奸雄】获得造成伤害的牌？',
      keep: (ctx, hit) => materialsHere(ctx, hit.input.card),
      effect(ctx, hit, self) {
        // 材料只认这次用牌的处理区，宣告后被移走的实体不能追回。
        if (!materialsHere(ctx, hit.input.card)) return;
        const { useId, card } = hit.input.card;
        return obtain(ctx, self.owner, card.materials, self.skill, {
          kind: 'use.materials-obtained',
          data: { actor: self.owner, useId, cards: card.materials, reason: self.skill },
        });
      },
    }),
  ],
});

const canAskHujia = (ctx: Context, request: ResponseOpportunity): boolean =>
  request.available(ctx) &&
  (request.purpose === 'response' ||
    request.canProvide(ctx, {
      kind: 'generated',
      face: { name: 'standard:jink' },
      materials: [],
      reason: 'standard:hujia',
    }));

export const hujia = skill({
  id: 'standard:hujia',
  name: '护驾',
  lord: true,
  description:
    '主公技。当你需要使用或打出闪时，可以令其他魏势力角色按座次依次选择是否替你打出闪。供牌者支付并结算打出后效，需要使用时再由你使用。',
  triggers: [
    on(Response.requested, {
      who: (request) => request.actor,
      when: (ctx, request, self) =>
        request.actor === request.beneficiary &&
        request.names.includes('standard:jink') &&
        canAskHujia(ctx, request) &&
        peers(ctx, self.owner, '魏').length > 0,
      ask: '是否发动【护驾】请求其他魏势力角色打出闪？',
      keep: canAskHujia,
      async effect(ctx, request, self) {
        for (const actor of others(ctx, self.owner)) {
          if (!canAskHujia(ctx, request)) return;
          if (!alive(ctx, actor) || kingdomOf(ctx.world, actor) !== '魏') continue;
          const response = await request.delegate(ctx, actor, ['standard:jink']);
          if (response.kind === 'responded' || response.kind === 'used') return;
        }
      },
    }),
  ],
});

export default general({
  id: 'standard:caocao',
  name: '曹操',
  kingdom: '魏',
  hp: 4,
  skills: [jianxiong, hujia],
});
