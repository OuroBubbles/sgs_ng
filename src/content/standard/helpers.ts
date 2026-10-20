import type { Context } from '../../sdk';

/** 按本局政策取得其他席位，不预先过滤后效中仍可能改变的存活/势力等资格。 */
export function otherSeats(ctx: Context, owner: string): readonly string[] {
  return ctx.actionOrder(owner).filter((id) => id !== owner);
}
