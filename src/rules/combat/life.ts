import type { Change, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { isGameOver } from '../game/end';
import { withLifetime } from '../scopes/lifetime';
import { defineMark } from '../state/mark';
import type {
  BurialEvent,
  DeathDraft,
  DeathEvent,
  DeathInput,
  DeathResult,
  DyingEvent,
  DyingInput,
  DyingResult,
} from './life-events';
import { Cards } from '../cards/move';
import { Dying, Death } from './life-events';
import { defineEvent } from '../../core/runtime/event';
import { timing } from '../../core/runtime/event';

export const PlayerEvent = defineEvent('player', {
  died: timing<unknown, DeathEvent>(),
  buried: timing<unknown>(),
});

export type {
  BurialEvent,
  DeathDraft,
  DeathEvent,
  DeathInput,
  DeathResult,
  DyingEvent,
  DyingInput,
  DyingResult,
  HealthCause,
} from './life-events';

const dyingState = defineMark('core:dying', false);
export function isDying(world: WorldReader, player: string): boolean {
  return world.snapshot.states.some(
    (state) => state.key === dyingState.id && state.owner === player && state.value === true,
  );
}

class Draft implements DeathDraft {
  #open = true;
  #prevention: string | null = null;
  constructor(
    readonly input: DeathInput,
    private readonly ctx: Context,
  ) {}
  get prevention(): string | null {
    return this.#prevention;
  }
  prevent(reason: string): void {
    this.ctx.assertActive();
    if (!this.#open || !reason) throw new Error('Invalid death prevention.');
    this.#prevention ??= reason;
  }
  seal(): void {
    this.#open = false;
  }
}

/** 标记死亡后开放死亡效果，再原子清理所属区域和技能；不夺走已宣告牌的处理区材料。 */
export function kill(ctx: Context, request: DeathInput): Promise<DeathResult> {
  return ctx.flow('death', async (child) => {
    const input = immutable(request);
    if (input.killer !== null) child.world.player(input.killer);
    if (!child.world.player(input.player).alive || isGameOver(child.world))
      return { kind: 'unavailable', event: null, reason: null };
    if (input.reason === 'dying' && child.world.player(input.player).hp > 0)
      return { kind: 'rescued', event: null, reason: null };
    const draft = new Draft(input, child);
    // 只约束尚未提交的死亡；已死亡/获救/被防止后，不再执行其他候选或索取费用。
    // 规则直接死亡不要求体力非正；死亡完成和埋葬则必须保留自己的后效与善后。
    await child.window(Death.before, draft, {
      subject: input.player,
      active: (at) =>
        at.world.player(input.player).alive &&
        !isGameOver(at.world) &&
        draft.prevention === null &&
        (input.reason !== 'dying' || at.world.player(input.player).hp <= 0),
    });
    draft.seal();
    if (!child.world.player(input.player).alive || isGameOver(child.world))
      return { kind: 'unavailable', event: null, reason: null };
    if (draft.prevention) {
      child.commit(Death.prevented, [], { input, reason: draft.prevention });
      return { kind: 'prevented', event: null, reason: draft.prevention };
    }
    if (input.reason === 'dying' && child.world.player(input.player).hp > 0)
      return { kind: 'rescued', event: null, reason: null };
    const event: DeathEvent = immutable({
      ...input,
      id: child.cause.flowId,
      before: child.world.player(input.player),
      zonesBefore: child.world.snapshot.zones.filter((zone) => zone.owner === input.player),
      skillsBefore: child.world.snapshot.skills.filter((skill) => skill.owner === input.player),
    });
    child.commit(
      PlayerEvent.died,
      [{ kind: 'vitality', player: input.player, hp: event.before.hp, alive: false }],
      event,
    );
    await child.window(Death.committed, event, { subject: input.player });

    const before = child.world.snapshot.zones.filter((zone) => zone.owner === input.player);
    const discardBefore = child.world.zone('discard');
    const moves = before
      .filter((zone) => zone.cards.length)
      .map((zone) => ({
        cards: zone.cards,
        from: zone.id,
        to: 'discard',
        place: 'bottom' as const,
      }));
    const changes: Change[] = moves.map((move) => ({ kind: 'move', ...move }));
    const skills = child.world.snapshot.skills.filter((skill) => skill.owner === input.player);
    const buried: BurialEvent = immutable({
      ...event,
      burial: { zonesBefore: before, skillsBefore: skills },
    });
    changes.push(...skills.map((skill): Change => ({ kind: 'removeSkill', instance: skill.id })));
    child.commit(PlayerEvent.buried, changes, {
      event,
      moves,
      removedSkills: skills.map((skill) => skill.id),
      burial: buried.burial,
    });
    if (moves.length)
      await child.window(
        Cards.moved,
        immutable({
          kind: 'moved',
          moves,
          before: [...before, discardBefore],
          after: child.world.snapshot.zones.filter(
            (zone) => zone.owner === input.player || zone.id === 'discard',
          ),
        }),
      );
    await child.window(Death.buried, buried, { subject: input.player });
    await child.window(Death.finished, buried, { subject: input.player });
    return { kind: 'dead', event, reason: null };
  });
}

/** 每次导致濒死的提交有独立因果；嵌套濒死不共享一个可被内层提前清掉的布尔标记。 */
export async function enterDying(ctx: Context, request: DyingInput): Promise<DyingResult> {
  return withLifetime(ctx, 'dying', async (child, lifetime) => {
    const event: DyingEvent = immutable({ ...request, id: child.cause.flowId });
    const player = child.world.player(event.player);
    if (!player.alive || player.hp > 0 || isGameOver(child.world))
      return { kind: 'unavailable', event };
    child.commit(
      Dying.started,
      [dyingState.change(child, event.player, true, { source: event.id, lifetime })],
      event,
    );
    await child.window(Dying.started, event, { subject: event.player });
    if (
      child.world.player(event.player).alive &&
      child.world.player(event.player).hp <= 0 &&
      !isGameOver(child.world)
    )
      await child.window(Dying.rescue, event, { subject: event.player });
    await child.window(Dying.finishing, event, { subject: event.player });
    let kind: DyingResult['kind'] = !child.world.player(event.player).alive
      ? 'dead'
      : child.world.player(event.player).hp > 0
        ? 'rescued'
        : 'unavailable';
    if (
      child.world.player(event.player).alive &&
      child.world.player(event.player).hp <= 0 &&
      !isGameOver(child.world)
    ) {
      const result = await kill(child, {
        player: event.player,
        killer: event.killer,
        cause: event.cause,
        reason: 'dying',
      });

      kind = result.kind;
    }
    const result: DyingResult = immutable({ kind, event });
    child.commit(
      Dying.finished,
      [dyingState.change(child, event.player, false, { source: event.id, lifetime })],
      result,
    );
    await child.window(Dying.finished, result, { subject: event.player });
    return result;
  });
}

export { Death } from './life-events';
export { Dying } from './life-events';
