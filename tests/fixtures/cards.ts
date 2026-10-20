import { turnActionAnchor } from '../../src/rules/turn/order';
import { Room } from '../../src/core/runtime/room';
import type { Card } from '../../src/core/model/state';
import { CardBook, SkillBook, installDelayedCards } from '../../src/sdk';
import type {
  CardDefinition,
  CardPolicy,
  SkillDefinition,
  UseIntent,
  UseResult,
  FlowResult,
  ActionAnchor,
} from '../../src/sdk';
import { standardCards } from '../../src/content/standard/cards';

export function card(id: string, name: string, suit: Card['suit'] = 'spade', rank = 7): Card {
  return { id, name: `standard:${name}`, suit, rank };
}
export const defaultHand = [
  card('slash1', 'slash'),
  card('slash2', 'slash'),
  card('peach', 'peach', 'heart', 3),
  card('duel', 'duel', 'diamond', 1),
];
export function cardGame(
  options: {
    readonly hands?: Readonly<Record<string, readonly Card[]>>;
    readonly equipment?: Readonly<Record<string, readonly Card[]>>;
    readonly skills?: readonly SkillDefinition[] | ((book: CardBook) => readonly SkillDefinition[]);
    readonly definitions?: readonly CardDefinition[];
    readonly policy?: Partial<CardPolicy>;
    readonly actionAnchor?: ActionAnchor;
    readonly draw?: readonly Card[];
    readonly discard?: readonly Card[];
  } = {},
) {
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
  const world = {
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
  const room = new Room({
    id: 'cards',
    seed: 42,
    world,
    actionAnchor: options.actionAnchor ?? turnActionAnchor,
  });
  const skills = new SkillBook();
  installDelayedCards(room);
  const book = new CardBook(
    [...standardCards, ...(options.definitions ?? [])],
    skills,
    options.policy,
  );
  skills.register(
    typeof options.skills === 'function' ? options.skills(book) : (options.skills ?? []),
  );
  skills.attach(room);
  return { room, book, skills, initial: world };
}

export async function use(
  game: ReturnType<typeof cardGame>,
  intent: UseIntent,
): Promise<FlowResult<UseResult>> {
  return game.room.run('action', async (ctx) => {
    const result = await game.book.use(ctx, intent);
    if (result.kind === 'aborted') return ctx.abort(result.reason);
    return result.value;
  });
}
