import { rulesOf } from '../skills/skills';
import type { Card, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineState, readState, stateChange } from '../state/state';
import { assertLifetime, withLifetime } from '../scopes/lifetime';
import type { Lifetime } from '../scopes/lifetime';
import { isGameOver } from '../game/end';
import type { SemanticCard } from './types';
import type { CardBook } from './book';
import type { CardColor } from './types';
import { withProcessing } from './processing';
import { reshuffle } from './draw';
import { moveCards, declared } from './move';
import type { Declared } from './move';
import type { SkillHandle } from '../skills/skills';
import type { PaymentReceipt } from '../costs/pay';
import { Response } from './response';
import { Cost } from '../costs/pay';
import { defineEvent, timing } from '../../core/runtime/event';

export interface JudgmentCard extends Card {
  readonly color: CardColor;
}
export interface JudgmentInput {
  readonly player: string;
  readonly reason: string;
  readonly match: (ctx: Context, card: JudgmentCard) => boolean;
  /** 结果封口及公共后效后、处理区善后前执行；允许取得仍在此处的判定牌。 */
  readonly onResult?: (ctx: Context, result: JudgmentResult) => unknown;
}
export interface JudgmentResult {
  readonly kind: 'judged' | 'unavailable';
  readonly id: string;
  readonly player: string;
  readonly reason: string;
  readonly processing: string;
  readonly card: JudgmentCard | null;
  readonly matched: boolean | null;
}
export interface RetrialInput {
  readonly card: string;
  readonly from: string;
  readonly reason: string;
  readonly previousTo?: string;
  /** 有技能宣告时，与新旧材料和判定牌面同次提交；不先支付再尝试改判。 */
  readonly skill?: SkillHandle;
  readonly legal?: (ctx: Context) => boolean;
  /** 以打出方式提供这一张实体材料时，复用通用打出完成窗口。需同时指定 skill。 */
  readonly response?: SemanticCard;
}
export interface Judgment {
  readonly id: string;
  readonly player: string;
  readonly reason: string;
  readonly processing: string;
  readonly card: JudgmentCard | null;
  replace(ctx: Context, input: RetrialInput): Promise<'replaced' | 'unavailable'>;
}

export const Judgment = defineEvent('judgment', {
  revealed: timing<
    Judgment,
    Declared<
      Pick<JudgmentInput, 'player' | 'reason'> & {
        readonly id: string;
        readonly processing: string;
        readonly card: JudgmentCard;
      }
    >
  >(),
  retrial: timing<Judgment>(),
  finished: timing<JudgmentResult>(),
  replaced: declared<{
    readonly id: string;
    readonly player: string;
    readonly reason: string;
    readonly processing: string;
    readonly before: JudgmentCard | null;
    readonly card: JudgmentCard;
    readonly invocation?: PaymentReceipt;
    readonly response?: SemanticCard;
  }>(),
  cardObtained: declared<{
    readonly judgment: string;
    readonly player: string;
    readonly reason: string;
    readonly card: string;
  }>(),
});
const currentCard = defineState<JudgmentCard | null>(
  'core:judgment-card',
  null,
  (value): value is JudgmentCard | null =>
    value === null ||
    (typeof value === 'object' &&
      'id' in value &&
      typeof value.id === 'string' &&
      'color' in value &&
      ['red', 'black', 'none'].includes(String(value.color))),
);

/** 判定牌面和材料位置分离：牌被获得不抹掉结果，改判则原子替换牌面与持有材料。 */
export function judge(ctx: Context, request: JudgmentInput): Promise<JudgmentResult> {
  const book = rulesOf(ctx);
  const input = immutable({ player: request.player, reason: request.reason });
  const match = request.match;
  const onResult = request.onResult;
  if (!input.reason) throw new Error('Judgment requires a reason.');
  return withLifetime(ctx, 'judgment', async (host, lifetime) => {
    const result = await withProcessing<JudgmentResult>(host, [], async (at, processing) => {
      const target = { owner: input.player, source: lifetime.id, lifetime };
      let open = true;
      let sealed: JudgmentResult | null = null;
      at.defer(() => {
        open = false;
      });
      const live = () => at.world.player(input.player).alive && !isGameOver(at.world);
      const control: Judgment = Object.freeze({
        id: lifetime.id,
        ...input,
        processing: processing.zone,
        get card() {
          if (sealed) return sealed.card;
          const current = readState(at.world, currentCard, target);
          return current ? book.face(at, current.id, input.player) : null;
        },
        replace: (child: Context, replacement: RetrialInput) =>
          replaceJudgment(child, control, replacement, {
            lifetime,
            world: at.world,
            target,
            open: () => open,
            book,
          }),
      });
      if (live()) {
        if (!at.world.zone('draw').cards.length && at.world.zone('discard').cards.length) {
          await reshuffle(at);
        }
        const id = live() ? at.world.zone('draw').cards[0] : undefined;
        if (id) {
          const card = book.face(at, id, input.player);
          await moveCards(
            at,
            [{ cards: [id], from: 'draw', to: processing.zone, place: 'bottom' }],
            input.reason,
            {
              kind: Judgment.revealed,
              data: { id: control.id, ...input, processing: processing.zone, card },
              changes: [stateChange(at, currentCard, target, card)],
            },
          );

          // 这些仍是待决判定窗口：候选后效可能令判定者死亡或结束整局，
          // 必须在同一窗口内持续收束，不能只在两个窗口之间检查一次。
          if (live())
            await at.window(Judgment.revealed, control, { subject: input.player, active: live });
          if (live())
            await at.window(Judgment.retrial, control, { subject: input.player, active: live });
        }
      }
      open = false;
      const card = control.card;
      const matched = live() && card ? at.query(() => match(at, card)) : null;
      if (matched !== null && typeof matched !== 'boolean')
        throw new Error('Judgment match must return a boolean.');
      sealed = immutable({
        kind: matched === null ? 'unavailable' : 'judged',
        id: control.id,
        ...input,
        processing: processing.zone,
        card,
        matched,
      });
      at.commit(Judgment.finished, [], sealed);
      await at.window(Judgment.finished, sealed, { subject: input.player });
      if (onResult) await onResult(at, sealed);
      return sealed;
    });

    return result;
  });
}

async function replaceJudgment(
  ctx: Context,
  judgment: Judgment,
  request: RetrialInput,
  control: {
    readonly lifetime: Lifetime;
    readonly world: WorldReader;
    readonly target: {
      readonly owner: string;
      readonly source: string;
      readonly lifetime: Lifetime;
    };
    readonly open: () => boolean;
    readonly book: CardBook;
  },
): Promise<'replaced' | 'unavailable'> {
  const input = immutable({
    card: request.card,
    from: request.from,
    reason: request.reason,
    ...(request.previousTo === undefined ? {} : { previousTo: request.previousTo }),
  });
  const skill = request.skill;
  const legal = request.legal;
  const response = request.response ? immutable(request.response) : null;
  if (response && !skill) throw new Error('A retrial response requires its declaring skill.');
  assertLifetime(ctx, control.lifetime);
  if (ctx.world !== control.world || !control.open() || !input.reason)
    throw new Error('Judgment is sealed or outside this flow.');
  return ctx.flow('judgment.replace', async (child) => {
    if (
      !child.world.player(judgment.player).alive ||
      isGameOver(child.world) ||
      child.world.position(input.card) !== input.from ||
      input.card === judgment.card?.id ||
      (response !== null &&
        (response.materials.length !== 1 || response.materials[0] !== input.card))
    )
      return 'unavailable';
    if (
      (skill && (!skill.active(child) || child.world.zone(input.from).owner !== skill.owner)) ||
      (legal && !child.query(() => legal(child)))
    )
      return 'unavailable';
    const previous = judgment.card;
    const card = control.book.face(child, input.card, judgment.player);
    const displaced =
      previous && child.world.position(previous.id) === judgment.processing ? [previous.id] : [];
    const invocation: PaymentReceipt | null = skill
      ? immutable({
          actor: skill.owner,
          cards: [input.card],
          reason: input.reason,
          skill: skill.skill,
          instance: skill.id,
          declaration: { label: skill.name, judgment: judgment.id },
        })
      : null;
    await moveCards(
      child,
      [
        ...(displaced.length
          ? [
              {
                cards: displaced,
                from: judgment.processing,
                to: input.previousTo ?? 'discard',
                place: 'bottom' as const,
              },
            ]
          : []),
        { cards: [input.card], from: input.from, to: judgment.processing, place: 'bottom' },
      ],
      input.reason,
      {
        kind: Judgment.replaced,
        data: {
          id: judgment.id,
          player: judgment.player,
          reason: input.reason,
          processing: judgment.processing,
          before: previous,
          card,
          ...(invocation ? { invocation } : {}),
          ...(response ? { response } : {}),
        },
        changes: [stateChange(child, currentCard, control.target, card)],
      },
    );

    if (invocation) await child.window(Cost.paid, invocation, { subject: invocation.actor });
    if (response && skill)
      await child.window(
        Response.finished,
        immutable({
          id: child.cause.flowId,
          actor: skill.owner,
          card: response,
          subject: { kind: 'judgment', id: judgment.id, player: judgment.player },
        }),
        { subject: skill.owner },
      );
    return 'replaced';
  });
}
