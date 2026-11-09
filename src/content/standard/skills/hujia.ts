import { others, alive, kingdomOf, peers, skill, on, Response } from '../../../sdk';
import type { Context, ResponseOpportunity } from '../../../sdk';

const canAskHujia = (ctx: Context, request: ResponseOpportunity): boolean =>
  request.available(ctx) &&
  (request.purpose === 'response' ||
    request.canProvide(ctx, {
      kind: 'generated',
      face: { name: 'standard:jink' },
      materials: [],
      reason: 'standard:hujia',
    }));

export default skill(
  'standard:hujia',
  '护驾',
  '主公技。当你需要使用或打出闪时，可以令其他魏势力角色按座次依次选择是否替你打出闪。供牌者支付并结算打出后效，需要使用时再由你使用。',
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
  { lord: true },
);
