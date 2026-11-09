import { turnActionAnchor } from '../../src/rules/turn/order';
import { Room } from '../../src/core/runtime/room';
import type { Card, WorldSeed } from '../../src/core/model/state';
import { expect } from 'vitest';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { useDeclarations } from '../../src/rules/cards/plan';
import {
  createContent,
  installDelayedCards,
  activate,
  activeOffers,
  defineSkill,
  kill,
  rulesOf,
  useCard,
} from '../../src/sdk';
import type {
  ActiveChoice,
  CardDefinition,
  SkillBook,
  SkillHandle,
  SkillModifier,
  ContentDefinition,
  UseIntent,
  UseResult,
  FlowResult,
  ActionAnchor,
  Context,
  PhaseView,
} from '../../src/sdk';
import { standardCards } from './standard';

// 固定牌声明可共享；每局目录、装备能力及规则状态仍独立创建。
const baseCards = createContent({ cards: standardCards }).cards;

/** 隔离规则场景：先取得作者选择，再调用执行入口；整合交互由 playPhase 场景覆盖。 */
export async function chooseAndActivate(
  ctx: Context,
  phase: PhaseView,
  input: Pick<ActiveChoice, 'instance' | 'action'>,
) {
  const offer = activeOffers(ctx, phase).find(
    (offer) => offer.choice.instance === input.instance && offer.choice.action === input.action,
  );
  if (!offer) return;
  const binding = rulesOf(ctx).binding(ctx.world, input.instance)!;
  const model = ctx.query(() =>
    binding.definition
      .active!.find((action) => action.id === input.action)!
      .selection?.(ctx, { self: binding.self, phase }),
  );
  if (!model) return activate(ctx, phase, { ...input, cards: [], targets: [] });
  const answer = await ctx.ask(model.decision(phase.owner, offer.label, { optional: true }));
  if (answer.kind === 'chosen') await activate(ctx, phase, { ...input, ...answer.value });
}

export function card(id: string, name: string, suit: Card['suit'] = 'spade', rank = 7): Card {
  return { id, name: `standard:${name}`, suit, rank };
}
const defaultHand = [
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
      /** 测试专用的全局规则修正（如禁止指定某目标），以始终生效的来源提供。 */
      readonly rules?: readonly SkillModifier[];
      readonly actionAnchor?: ActionAnchor;
      /** 测试专用：在 attach 封存前装配快照读取器、能力提供者等。 */
      readonly setup?: (skills: SkillBook) => void;
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
  const { skills } = createContent(
    { cards: [...baseCards, ...(options.definitions ?? [])] },
    options,
  ).createBooks();
  if (options.rules) {
    const definition = defineSkill({
      id: 'test:rules',
      name: '测试规则',
      modifiers: options.rules,
    });
    const self: SkillHandle = {
      id: 'test:rules',
      owner: 'a',
      skill: definition.id,
      name: definition.name,
      origin: null,
      active: () => true,
    };
    skills.addProvider({ collect: () => [{ self, definition }] });
  }
  options.setup?.(skills);
  skills.attach(room);
  return { room, skills, initial: world };
}

export async function use(
  game: ReturnType<typeof cardGame>,
  intent: UseIntent,
): Promise<FlowResult<UseResult>> {
  return game.room.run('action', (ctx) => useCard(ctx, intent));
}

/** 以测试武将来源授予技能，返回该技能实例。 */
export async function grant(
  game: Pick<ReturnType<typeof cardGame>, 'room' | 'skills'>,
  skill: string,
  owner = 'a',
) {
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner, skill, source: { kind: 'general', id: 'test' } }),
  );
  return game.skills
    .bindings(game.room.world)
    .find((binding) => binding.self.owner === owner && binding.self.skill === skill)!.self;
}

/** 规则原因令角色阵亡，无击杀者。 */
export const die = (ctx: Context, player: string) =>
  kill(ctx, {
    player,
    killer: null,
    reason: 'rule',
    cause: { kind: 'rule', seq: null, data: null },
  });

type Played = { readonly room: Room; readonly initial: WorldSeed };
/** 局面已静止：历史可重建当前世界，无待决请求、处理区、用牌宣告、私有牌池或判定牌残留。 */
export function settled(game: Played): void {
  const { world } = game.room;
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(world.snapshot);
  expect(game.room.decisions.pending).toEqual([]);
  expect(world.snapshot.zones.filter((zone) => zone.kind === 'processing')).toEqual([]);
  expect(useDeclarations(world)).toEqual([]);
  expect(
    world.snapshot.states.filter((state) =>
      ['core:private-pool', 'core:judgment-card'].includes(state.key),
    ),
  ).toEqual([]);
}
/** settled，且房间就绪、初始牌全部仍在某个区域。 */
export function conserved(game: Played): void {
  settled(game);
  expect(game.room.status).toBe('ready');
  expect(game.room.world.snapshot.zones.flatMap((zone) => zone.cards).sort()).toEqual(
    game.initial.cards.map((item) => item.id).sort(),
  );
}
