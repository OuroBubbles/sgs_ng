import type { Card } from '../core/model/state';
import type { CardKind } from '../core/view/table';
import { immutable } from '../core/model/value';
import { CardBook, defineCard } from '../rules/cards/book';
import type { CardDefinition, CardPolicy } from '../rules/cards/types';
import { GeneralBook, defineGeneral } from '../rules/characters/general';
import type { GeneralDefinition } from '../rules/characters/general';
import { SkillBook, defineSkill } from '../rules/skills/skills';
import type { SkillDefinition } from '../rules/skills/skills';
import { defineEffect } from '../rules/effects/effects';
import type { EffectDefinition } from '../rules/effects/effects';

export interface CardPresentation {
  readonly id: string;
  readonly kind: CardKind;
  readonly description: string;
  readonly icon?: string;
  /** 完整卡面；当前点数、花色由投影叠加，缺图时仍可显示文字。 */
  readonly image?: string;
  /** 使用/打出时按实际角色性别选择，不影响规则判定。 */
  readonly voices?: Readonly<Partial<Record<'male' | 'female', string>>>;
}

/** 展示资源不进入规则状态、历史或 AI 观察。 */
export interface GeneralPresentation {
  readonly id: string;
  readonly portrait?: string;
  readonly deathVoice?: string;
  readonly voices?: Readonly<Record<string, readonly string[]>>;
}

export interface DeckDefinition {
  readonly id: string;
  readonly label: string;
  /** 组合时固定函数并保留原接收者；函数捕获的可变数据仍由开发者管理。 */
  create(): readonly Card[];
}

/** 普通源码内容：直接组合定义，不要求包名、版本、依赖清单或命名空间。 */
export interface ContentDefinition {
  readonly cards?: readonly CardDefinition[];
  /** 不属于任何武将的技能；武将引用的技能对象会自动登记。 */
  readonly skills?: readonly SkillDefinition[];
  readonly effects?: readonly EffectDefinition[];
  readonly generals?: readonly (GeneralDefinition & {
    readonly abilities?: readonly SkillDefinition[];
  })[];
  readonly decks?: readonly DeckDefinition[];
  readonly cardViews?: readonly CardPresentation[];
  readonly generalViews?: readonly GeneralPresentation[];
}

export interface ContentCatalog {
  readonly cards: readonly CardDefinition[];
  readonly generals: readonly GeneralDefinition[];
  readonly decks: readonly Pick<DeckDefinition, 'id' | 'label'>[];
  readonly cardViews: Readonly<Record<string, CardPresentation>>;
  readonly generalViews: Readonly<Record<string, GeneralPresentation>>;
  /** 定义可共享；每局目录独立，工厂取得本局实际使用的 CardBook。 */
  createBooks(policy?: Partial<CardPolicy>): {
    readonly book: CardBook;
    readonly skills: SkillBook;
    readonly generals: GeneralBook;
  };
  createDeck(id: string): readonly Card[];
}

function distinct(entries: readonly { readonly id: string }[], kind: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.id.trim()) throw new Error(`Missing ${kind} ID.`);
    if (seen.has(entry.id)) throw new Error(`Duplicate ${kind}: ${entry.id}`);
    seen.add(entry.id);
  }
}

/** 唯一的普通源码装配：展平全部定义并校验重复；技能、事件与查询按引用使用。 */
export function createContent(...definitions: readonly ContentDefinition[]): ContentCatalog {
  const cards = Object.freeze(definitions.flatMap((entry) => entry.cards ?? []).map(defineCard));
  const generals = Object.freeze(
    definitions.flatMap((entry) => entry.generals ?? []).map(defineGeneral),
  );
  const effects = Object.freeze(
    definitions.flatMap((entry) => entry.effects ?? []).map(defineEffect),
  );
  const decks = Object.freeze(
    definitions
      .flatMap((entry) => entry.decks ?? [])
      .map((deck) =>
        Object.freeze({
          id: deck.id,
          label: deck.label,
          create: deck.create.bind(deck),
        }),
      ),
  );
  // 同一技能对象可同时出现在 skills 与多个武将中，只登记一次；同 ID 不同对象仍报重复。
  const skills = Object.freeze(
    [
      ...new Set(
        definitions.flatMap((entry) => [
          ...(entry.skills ?? []),
          ...(entry.generals ?? []).flatMap((general) => general.abilities ?? []),
        ]),
      ),
    ].map(defineSkill),
  );
  // 与规则定义一样，先固定公开字段，再校验与建索引；不重复读取作者 getter。
  const cardEntries = immutable(
    definitions
      .flatMap((entry) => entry.cardViews ?? [])
      .map(({ id, kind, description, icon, image, voices }) => ({
        id,
        kind,
        description,
        ...(icon === undefined ? {} : { icon }),
        ...(image === undefined ? {} : { image }),
        ...(voices === undefined ? {} : { voices }),
      })),
  );
  const generalEntries = immutable(
    definitions
      .flatMap((entry) => entry.generalViews ?? [])
      .map(({ id, portrait, deathVoice, voices }) => ({
        id,
        ...(portrait === undefined ? {} : { portrait }),
        ...(deathVoice === undefined ? {} : { deathVoice }),
        ...(voices === undefined ? {} : { voices }),
      })),
  );
  for (const [kind, entries] of [
    ['card', cards],
    ['general', generals],
    ['effect', effects],
    ['deck', decks],
    ['card presentation', cardEntries],
    ['general presentation', generalEntries],
  ] as const)
    distinct(entries, kind);
  if (decks.some((deck) => !deck.label.trim())) throw new Error('Deck requires a label.');
  const cardIds = new Set(cards.map((card) => card.id));
  const generalIds = new Set(generals.map((general) => general.id));
  for (const view of cardEntries)
    if (!cardIds.has(view.id)) throw new Error(`Presentation references unknown card: ${view.id}`);
  for (const view of generalEntries) {
    if (!generalIds.has(view.id))
      throw new Error(`Presentation references unknown general: ${view.id}`);
    if (view.portrait !== undefined && !view.portrait.trim())
      throw new Error('General portrait URL cannot be empty.');
  }
  return Object.freeze({
    cards,
    generals,
    decks: immutable(decks.map(({ id, label }) => ({ id, label }))),
    cardViews: immutable(Object.fromEntries(cardEntries.map((view) => [view.id, view]))),
    generalViews: immutable(Object.fromEntries(generalEntries.map((view) => [view.id, view]))),
    createBooks(policy?: Partial<CardPolicy>) {
      const registry = new SkillBook();
      const book = new CardBook(cards, registry, policy);
      book.effects.register(effects);
      registry.register(skills);
      return { book, skills: registry, generals: new GeneralBook(generals, registry) };
    },
    createDeck(id: string) {
      const entry = decks.find((deck) => deck.id === id);
      if (!entry) throw new Error(`Unknown deck: ${id}`);
      const deck = immutable(entry.create());
      distinct(deck, 'physical card');
      for (const card of deck)
        if (!cardIds.has(card.name))
          throw new Error(`[${id}] Unknown card definition: ${card.name}`);
      return deck;
    },
  });
}
