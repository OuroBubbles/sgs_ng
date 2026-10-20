import type { Card } from '../core/model/state';
import type { CardKind } from '../core/view/table';
import { immutable } from '../core/model/value';
import { CardBook } from '../rules/cards/book';
import type { CardDefinition, CardPolicy } from '../rules/cards/types';
import { GeneralBook, defineGeneral } from '../rules/characters/general';
import type { GeneralDefinition } from '../rules/characters/general';
import { SkillBook } from '../rules/skills/skills';
import type { SkillDefinition } from '../rules/skills/skills';
import { defineEffect } from '../rules/effects/effects';
import type { EffectDefinition } from '../rules/effects/effects';

export interface PackageVersion {
  readonly id: string;
  readonly version: string;
}
export interface PackageManifest extends PackageVersion {
  readonly name: string;
  /** 版本是精确内容版本；省略 version 表示只要求该包存在。 */
  readonly requires?: readonly { readonly id: string; readonly version?: string }[];
}
export interface CardPresentation {
  readonly id: string;
  readonly kind: CardKind;
  readonly description: string;
}
/** 仅供客户端展示；资源不进入规则状态、历史或 AI 观察。 */
export interface GeneralPresentation {
  readonly id: string;
  readonly portrait: string;
}
export interface DeckDefinition {
  readonly id: string;
  readonly label: string;
  create(): readonly Card[];
}
export interface ContentPackage {
  readonly manifest: PackageManifest;
  readonly cards?: readonly CardDefinition[];
  readonly skills?: readonly SkillDefinition[] | ((book: CardBook) => readonly SkillDefinition[]);
  readonly effects?: readonly EffectDefinition[];
  readonly generals?: readonly GeneralDefinition[];
  readonly decks?: readonly DeckDefinition[];
  readonly cardViews?: readonly CardPresentation[];
  readonly generalViews?: readonly GeneralPresentation[];
}

const packageId = /^[a-z][a-z0-9_-]*$/;
function ownId(owner: string, id: string, kind: string): void {
  if (!id.startsWith(`${owner}:`) || !packageId.test(id.slice(owner.length + 1)))
    throw new Error(`[${owner}] ${kind} ID must use its own namespace: ${id}`);
}
function unique(entries: readonly { readonly id: string }[], kind: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`Duplicate ${kind}: ${entry.id}`);
    seen.add(entry.id);
  }
}

/** 只冻结声明与列表，保留 Window 身份和普通代码闭包；不序列化或遍历函数。 */
export function definePackage(input: ContentPackage): ContentPackage {
  const { manifest } = input;
  if (!packageId.test(manifest.id) || !manifest.name.trim() || !manifest.version.trim())
    throw new Error('Package requires a namespaced ID, name and content version.');
  const dependencies = manifest.requires ?? [];
  unique(dependencies, 'package dependency');
  for (const dependency of dependencies) {
    if (
      !packageId.test(dependency.id) ||
      dependency.id === manifest.id ||
      (dependency.version !== undefined && !dependency.version.trim())
    )
      throw new Error(`[${manifest.id}] Invalid dependency: ${dependency.id}`);
  }
  const cards = Object.freeze([...(input.cards ?? [])]);
  const effects = Object.freeze((input.effects ?? []).map(defineEffect));
  const generals = Object.freeze((input.generals ?? []).map(defineGeneral));
  const decks = Object.freeze((input.decks ?? []).map((deck) => Object.freeze({ ...deck })));
  const cardViews = immutable(input.cardViews ?? []);
  const generalViews = immutable(input.generalViews ?? []);
  for (const [kind, entries] of [
    ['card', cards],
    ['effect', effects],
    ['general', generals],
    ['deck', decks],
    ['card presentation', cardViews],
    ['general presentation', generalViews],
  ] as const) {
    unique(entries, kind);
    for (const entry of entries) ownId(manifest.id, entry.id, kind);
  }
  if (decks.some((deck) => !deck.label.trim())) throw new Error('Deck requires a label.');
  if (generalViews.some((view) => !view.portrait.trim()))
    throw new Error('General presentation requires a portrait URL.');
  return Object.freeze({
    manifest: immutable(manifest),
    cards,
    effects,
    generals,
    decks,
    cardViews,
    generalViews,
    skills:
      typeof input.skills === 'function' ? input.skills : Object.freeze([...(input.skills ?? [])]),
  });
}

export interface ResolvedContent {
  readonly packages: readonly PackageManifest[];
  readonly versions: readonly PackageVersion[];
  readonly cards: readonly CardDefinition[];
  readonly generals: readonly GeneralDefinition[];
  readonly decks: readonly Pick<DeckDefinition, 'id' | 'label'>[];
  readonly cardViews: Readonly<Record<string, CardPresentation>>;
  readonly generalViews: Readonly<Record<string, GeneralPresentation>>;
  /** 每局各建一套目录；技能工厂只拿到该局真正使用的 CardBook。 */
  createBooks(policy?: Partial<CardPolicy>): {
    readonly book: CardBook;
    readonly skills: SkillBook;
    readonly generals: GeneralBook;
  };
  createDeck(id: string): readonly Card[];
}

/** 解析选择闭包，不依赖构建工具；缺依赖、循环、版本冲突在创建 Room 前报错。 */
export function resolvePackages(
  available: readonly ContentPackage[],
  selected: readonly string[],
): ResolvedContent {
  const entries = available.map(definePackage);
  unique(
    entries.map((entry) => entry.manifest),
    'package',
  );
  const byId = new Map(entries.map((entry) => [entry.manifest.id, entry]));
  const ordered: ContentPackage[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visible = new Map<string, ReadonlySet<string>>();
  function visit(id: string, path: readonly string[]): void {
    if (visiting.has(id))
      throw new Error(`Package dependency cycle: ${[...path, id].join(' -> ')}`);
    if (visited.has(id)) return;
    const entry = byId.get(id);
    if (!entry)
      throw new Error(`Missing package: ${id} (required by ${path.at(-1) ?? 'selection'})`);
    visiting.add(id);
    const closure = new Set([id]);
    // 使用码点序，避免系统语言或 ICU 排序差异改变跨平台装配顺序。
    for (const dependency of [...(entry.manifest.requires ?? [])].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )) {
      visit(dependency.id, [...path, id]);
      const actual = byId.get(dependency.id)!.manifest.version;
      if (dependency.version !== undefined && dependency.version !== actual)
        throw new Error(`[${id}] ${dependency.id} requires ${dependency.version}, found ${actual}`);
      for (const reachable of visible.get(dependency.id)!) closure.add(reachable);
    }
    visible.set(id, closure);
    visiting.delete(id);
    visited.add(id);
    ordered.push(entry);
  }
  for (const id of [...new Set(selected)].sort()) visit(id, []);
  const cards = Object.freeze(ordered.flatMap((entry) => entry.cards ?? []));
  const generals = Object.freeze(ordered.flatMap((entry) => entry.generals ?? []));
  const decks = ordered.flatMap((entry) =>
    (entry.decks ?? []).map((deck) => ({ owner: entry.manifest.id, deck })),
  );
  const cardViews: Readonly<Record<string, CardPresentation>> = immutable(
    Object.fromEntries(
      ordered.flatMap((entry) => (entry.cardViews ?? []).map((view) => [view.id, view])),
    ),
  );
  const cardIds = new Set(cards.map((card) => card.id));
  const generalViews: Readonly<Record<string, GeneralPresentation>> = immutable(
    Object.fromEntries(
      ordered.flatMap((entry) => (entry.generalViews ?? []).map((view) => [view.id, view])),
    ),
  );
  const generalIds = new Set(generals.map((general) => general.id));
  for (const view of Object.values(generalViews))
    if (!generalIds.has(view.id))
      throw new Error(`Presentation references unknown general: ${view.id}`);
  for (const view of Object.values(cardViews))
    if (!cardIds.has(view.id)) throw new Error(`Presentation references unknown card: ${view.id}`);
  function assertReference(owner: string, reference: string): void {
    if (!visible.get(owner)!.has(reference.split(':')[0]!))
      throw new Error(`[${owner}] Reference requires a declared dependency: ${reference}`);
  }
  return Object.freeze({
    packages: immutable(ordered.map((entry) => entry.manifest)),
    versions: immutable(ordered.map(({ manifest: { id, version } }) => ({ id, version }))),
    cards,
    generals,
    decks: immutable(decks.map(({ deck: { id, label } }) => ({ id, label }))),
    cardViews,
    generalViews,
    createBooks(policy?: Partial<CardPolicy>) {
      const skills = new SkillBook();
      const book = new CardBook(cards, skills, policy);
      for (const entry of ordered) {
        book.effects.register(entry.effects ?? []);
        const definitions =
          typeof entry.skills === 'function' ? entry.skills(book) : (entry.skills ?? []);
        for (const definition of definitions) ownId(entry.manifest.id, definition.id, 'skill');
        skills.register(definitions);
        for (const general of entry.generals ?? [])
          for (const skill of general.skills) assertReference(entry.manifest.id, skill);
      }
      return { book, skills, generals: new GeneralBook(generals, skills) };
    },
    createDeck(id: string) {
      const entry = decks.find(({ deck }) => deck.id === id);
      if (!entry) throw new Error(`Unknown deck: ${id}`);
      const deck = immutable(entry.deck.create());
      unique(deck, 'physical card');
      for (const card of deck) {
        assertReference(entry.owner, card.name);
        if (!cardIds.has(card.name))
          throw new Error(`[${id}] Unknown card definition: ${card.name}`);
      }
      return deck;
    },
  });
}
