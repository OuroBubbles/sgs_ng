import { turnActionAnchor } from '../../src/rules/turn/order';
import { Room } from '../../src/core/runtime/room';
import type { Card } from '../../src/core/model/state';
import { createContent, installDelayedCards, activate, activeOffers } from '../../src/sdk';
import type {
  ActiveChoice,
  CardDefinition,
  CardBook,
  CardPolicy,
  ContentDefinition,
  UseIntent,
  UseResult,
  FlowResult,
  ActionAnchor,
  Context,
  PhaseView,
} from '../../src/sdk';
import { standardCards } from '../../src/content/standard/cards';

// 固定牌声明可共享；每局目录、装备能力及规则状态仍独立创建。
const baseCards = createContent({ cards: standardCards }).cards;

/** 隔离规则场景：先取得作者选择，再调用执行入口；整合交互由 playPhase 场景覆盖。 */
export async function chooseAndActivate(
  ctx: Context,
  book: CardBook,
  phase: PhaseView,
  input: Pick<ActiveChoice, 'instance' | 'action'>,
) {
  const offer = activeOffers(ctx, book, phase).find(
    (offer) => offer.choice.instance === input.instance && offer.choice.action === input.action,
  );
  if (!offer) return;
  const binding = book.skills.binding(ctx.world, input.instance)!;
  const model = ctx.query(() =>
    binding.definition
      .active!.find((action) => action.id === input.action)!
      .selection?.(ctx, { self: binding.self, phase, book }),
  );
  if (!model) return activate(ctx, book, phase, { ...input, cards: [], targets: [] });
  const answer = await ctx.ask(model.decision(phase.owner, offer.label, { optional: true }));
  if (answer.kind === 'chosen') await activate(ctx, book, phase, { ...input, ...answer.value });
}

export function card(id: string, name: string, suit: Card['suit'] = 'spade', rank = 7): Card {
  return { id, name: `standard:${name}`, suit, rank };
}
export const defaultHand = [
  card('slash1', 'slash'),
  card('slash2', 'slash'),
  card('peach', 'peach', 'heart', 3),
  card('duel', 'duel', 'diamond', 1),
];

interface CardSetup {
  readonly hands?: Readonly<Record<string, readonly Card[]>>;
  readonly equipment?: Readonly<Record<string, readonly Card[]>>;
  readonly draw?: readonly Card[];
  readonly discard?: readonly Card[];
}

/** 只生成初始数据；使用自有目录或 World 时不必先创建一局再取 initial。 */
export function cardSeed(options: CardSetup = {}) {
  const hands = { a: defaultHand, b: [], c: [], d: [], ...options.hands };
  const equipment = options.equipment ?? {};
  const zones = ['a', 'b', 'c', 'd'].flatMap((id) => [
    {
      id: `${id}:hand`,
      kind: 'hand' as const,
      owner: id,
      scopeId: null,
      cards: (hands[id as keyof typeof hands] ?? []).map((item) => item.id),
    },
    {
      id: `${id}:equipment`,
      kind: 'equipment' as const,
      owner: id,
      scopeId: null,
      cards: (equipment[id] ?? []).map((item) => item.id),
    },
  ]);
  return {
    players: ['a', 'b', 'c', 'd'].map((id) => ({ id, hp: 4, maxHp: 4, alive: true })),
    cards: [
      ...Object.values(hands).flat(),
      ...Object.values(equipment).flat(),
      ...(options.draw ?? []),
      ...(options.discard ?? []),
    ],
    skills: [],
    states: [],
    zones: [
      ...zones,
      {
        id: 'draw',
        kind: 'draw' as const,
        owner: null,
        scopeId: null,
        cards: (options.draw ?? []).map((item) => item.id),
      },
      {
        id: 'discard',
        kind: 'discard' as const,
        owner: null,
        scopeId: null,
        cards: (options.discard ?? []).map((item) => item.id),
      },
    ],
  };
}

export function cardGame(
  options: CardSetup &
    Pick<ContentDefinition, 'skills' | 'effects'> & {
      readonly definitions?: readonly CardDefinition[];
      readonly policy?: Partial<CardPolicy>;
      readonly actionAnchor?: ActionAnchor;
    } = {},
) {
  const world = cardSeed(options);
  const room = new Room({
    id: 'cards',
    seed: 42,
    world,
    actionAnchor: options.actionAnchor ?? turnActionAnchor,
  });
  installDelayedCards(room);
  const { book, skills } = createContent(
    { cards: [...baseCards, ...(options.definitions ?? [])] },
    options,
  ).createBooks(options.policy);
  skills.attach(room);
  return { room, book, skills, initial: world };
}

export async function use(
  game: ReturnType<typeof cardGame>,
  intent: UseIntent,
): Promise<FlowResult<UseResult>> {
  return game.room.run('action', (ctx) => game.book.use(ctx, intent));
}
