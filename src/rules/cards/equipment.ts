import type { Card, WorldReader, Zone } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineSkill, isSkillBlocked } from '../skills/skills';
import type { SkillBinding, SkillDefinition, SkillHandle, SkillProvider } from '../skills/skills';
import { modify } from '../skills/query';
import { attackRange } from './queries';
import { moveCards, Cards } from './move';
import type { MoveResult } from './move';
import type { CardBook } from './book';
import type { CardDefinition, EffectRef } from './types';
import { isGameOver } from '../game/end';

/** 标准槽位为 weapon/armor/offensive-horse/defensive-horse；扩展可直接命名新槽位。 */
export type EquipmentSlot = string;
export interface EquipmentDefinition {
  readonly slot: EquipmentSlot;
  readonly range?: number;
  readonly skill?: SkillDefinition;
}

/** 忽略只属于指定目标的这个效果；嵌套效果、代答者及普通技能来源各自判断。 */
export function equipmentEffectiveFor(
  world: WorldReader,
  self: SkillHandle,
  effect: EffectRef,
  slot: EquipmentSlot,
): boolean {
  return (
    self.effective(world) &&
    !(
      self.origin?.kind === 'equipment' &&
      self.owner === effect.target &&
      effect.ignoredEquipment?.some((entry) => entry.slot === slot)
    )
  );
}

export function equippedCards(world: WorldReader, owner: string): readonly string[] {
  // 区域身份由 World 管理；牌的槽位由目录解释，见 equipmentInSlot。
  return world.snapshot.zones
    .filter((zone) => zone.kind === 'equipment' && zone.owner === owner)
    .flatMap((zone) => zone.cards);
}

export function equipmentInSlot(
  world: WorldReader,
  book: CardBook,
  owner: string,
  slot: EquipmentSlot,
): readonly string[] {
  return equippedCards(world, owner).filter(
    (id) => book.definition(world.card(id).name).equipment?.slot === slot,
  );
}

export type EquipResult =
  | {
      readonly kind: 'equipped';
      readonly card: string;
      readonly owner: string;
      readonly replaced: readonly string[];
    }
  | { readonly kind: 'unavailable' | 'unchanged' };

/** 替换在同一次移动中提交。后效看见新装备与旧装备离场，不存在两把同槽武器的中间态。 */
export function equip(
  ctx: Context,
  book: CardBook,
  input: {
    readonly card: string;
    readonly owner: string;
    readonly from: string;
  },
): Promise<EquipResult> {
  const request = immutable(input);
  return ctx.flow('equipment.equip', async (child) => {
    const definition = book.definition(child.world.card(request.card).name).equipment;
    if (!definition) throw new Error('Card has no equipment definition.');
    if (
      !child.world.player(request.owner).alive ||
      isGameOver(child.world) ||
      child.world.position(request.card) !== request.from
    )
      return { kind: 'unavailable' };
    const zones = child.world.snapshot.zones.filter(
      (zone) => zone.kind === 'equipment' && zone.owner === request.owner,
    );
    if (zones.length !== 1) throw new Error('Equipment requires one owned equipment zone.');
    const destination = zones[0]!;
    if (request.from === destination.id) return { kind: 'unchanged' };
    const replaced = equipmentInSlot(child.world, book, request.owner, definition.slot);
    const result = immutable({
      kind: 'equipped' as const,
      card: request.card,
      owner: request.owner,
      replaced,
    });
    await moveCards(
      child,
      [
        ...replaced.map((card) => ({
          cards: [card],
          from: child.world.position(card),
          to: 'discard',
          place: 'bottom' as const,
        })),
        { cards: [request.card], from: request.from, to: destination.id, place: 'bottom' },
      ],
      'equipment',
      { kind: 'equipment.equipped', data: result },
    );

    return result;
  });
}

/** 当前标准装备安装一个同名实体；转换装备与零/多材料装备尚无持久绑定协议。 */
export function equipmentCard(
  input: {
    readonly id: string;
    readonly label: string;
  } & EquipmentDefinition,
): CardDefinition {
  const { id, label, slot, range, skill } = input;
  if (!slot || (range !== undefined && (!Number.isSafeInteger(range) || range < 1)))
    throw new Error('Invalid equipment range.');
  return {
    id,
    type: 'equipment',
    label,
    equipment: {
      slot,
      ...(range === undefined ? {} : { range }),
      ...(skill === undefined ? {} : { skill }),
    },
    use: {
      count: { min: 0, max: 0 },
      fixedTargets: (_ctx, { actor }) => [actor],
      target: (_ctx, { request, target }) => target === request.actor,
      canUse: (ctx, { request }) =>
        request.targets.length === 1 &&
        request.card.materials.length === 1 &&
        ctx.world.card(request.card.materials[0]!).name === id
          ? null
          : 'Equipment requires one matching physical card.',
      async resolve(ctx, { effect, book }) {
        const card = effect.card.materials[0]!;
        await equip(ctx, book, {
          card,
          owner: effect.target,
          from: effect.processing,
        });
      },
    },
  };
}

/** 离场能力必须明确引用本次移动前后快照，不把已离场装备重新伪装成当前装备。 */
export function equipmentLost(world: WorldReader, moved: MoveResult, self: SkillHandle): boolean {
  const card = self.origin?.kind === 'equipment' ? self.origin.id : null;
  return (
    card !== null &&
    !isSkillBlocked(world, self.owner, self.id) &&
    moved.before.some(
      (zone) => zone.kind === 'equipment' && zone.owner === self.owner && zone.cards.includes(card),
    ) &&
    !moved.after.some(
      (zone) => zone.kind === 'equipment' && zone.owner === self.owner && zone.cards.includes(card),
    )
  );
}

/** 装备实例以实体牌与持有者为身份。移动、支付、埋葬后查询立即反映权威位置。 */
export function equipmentAbilities(definitions: readonly CardDefinition[]): SkillProvider {
  const abilities = new Map(
    definitions
      .filter((card) => card.equipment)
      .map((card) => {
        const equipment = card.equipment!;
        const {
          id,
          name,
          description,
          triggers = [],
          active,
          viewAs,
          modifiers = [],
        } = equipment.skill ?? {};
        return [
          card.id,
          defineSkill({
            id: id ?? `${card.id}:ability`,
            name: name ?? card.label,
            ...(description === undefined ? {} : { description }),
            triggers,
            ...(active === undefined ? {} : { active }),
            ...(viewAs === undefined ? {} : { viewAs }),
            modifiers: [
              ...modifiers,
              ...(equipment.range === undefined
                ? []
                : [
                    modify(attackRange, (_ctx, { input, self }) =>
                      input.actor === self.owner && !input.card.materials.includes(self.origin!.id)
                        ? equipment.range
                        : undefined,
                    ),
                  ]),
            ],
          }),
        ] as const;
      }),
  );
  // 仅复用实体牌与持有者的不可变来源描述；资格仍从当前 World 读取。
  // 每张牌只保留最近的持有者，不累计所有者历史，绑定也不捕获 World。
  const byCard = new WeakMap<Card, SkillBinding>();
  const bindingFor = (card: Card, owner: string): SkillBinding | undefined => {
    const previous = byCard.get(card);
    if (previous?.self.owner === owner) return previous;
    const definition = abilities.get(card.name);
    if (!definition) return;
    const id = JSON.stringify(['equipment', owner, card.id]);
    const self: SkillHandle = Object.freeze({
      id,
      owner,
      skill: definition.id,
      name: definition.name,
      origin: Object.freeze({ kind: 'equipment', id: card.id }),
      effective: (current: WorldReader) =>
        current.snapshot.zones.some(
          (zone) =>
            zone.kind === 'equipment' && zone.owner === owner && zone.cards.includes(card.id),
        ) && !isSkillBlocked(current, owner, id),
    });
    const binding = Object.freeze({ self, definition });
    byCard.set(card, binding);
    return binding;
  };
  const collectFrom = (world: WorldReader, zones: readonly Zone[]): SkillBinding[] => {
    const bindings: SkillBinding[] = [];
    for (const zone of zones) {
      if (zone.kind !== 'equipment' || zone.owner === null) continue;
      const owner = zone.owner;
      for (const card of zone.cards) {
        const binding = bindingFor(world.card(card), owner);
        if (binding) bindings.push(binding);
      }
    }
    return bindings;
  };
  return Object.freeze({
    collect(world: WorldReader, window?: { readonly type: object; readonly payload: unknown }) {
      const current = collectFrom(world, world.snapshot.zones);
      if (window?.type !== Cards.moved) return current;
      // 只有移动窗口需要合并历史来源，并按实体与持有者去重。
      const before = collectFrom(world, (window.payload as MoveResult).before);
      return [
        ...new Map([...current, ...before].map((binding) => [binding.self.id, binding])).values(),
      ];
    },
  });
}
