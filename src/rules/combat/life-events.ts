import type { Player, SkillInstance, Zone } from '../../core/model/state';
import { defineWindow } from '../../core/runtime/window';

export interface HealthCause {
  readonly kind: 'damage' | 'hp-loss' | 'rule';
  readonly seq: number | null;
  readonly data: unknown;
}
export interface DyingInput {
  readonly player: string;
  readonly killer: string | null;
  readonly cause: HealthCause;
}
export interface DyingEvent extends DyingInput {
  readonly id: string;
}
export interface DeathInput extends DyingInput {
  readonly reason: 'dying' | 'rule';
}
export interface DeathEvent extends DeathInput {
  readonly id: string;
  readonly before: Player;
  readonly zonesBefore: readonly Zone[];
  readonly skillsBefore: readonly SkillInstance[];
}
/** 死亡后效可以改变牌和技能；埋葬记录真正移除前的快照，不改写最初死亡事件。 */
export interface BurialEvent extends DeathEvent {
  readonly burial: {
    readonly zonesBefore: readonly Zone[];
    readonly skillsBefore: readonly SkillInstance[];
  };
}
export interface DeathDraft {
  readonly input: DeathInput;
  readonly prevention: string | null;
  prevent(reason: string): void;
}
export interface DeathResult {
  readonly kind: 'dead' | 'prevented' | 'rescued' | 'unavailable';
  readonly event: DeathEvent | null;
  readonly reason: string | null;
}
export interface DyingResult {
  readonly kind: 'rescued' | 'dead' | 'prevented' | 'unavailable';
  readonly event: DyingEvent;
}

export const dyingStarted = defineWindow<DyingEvent>('dying.started');
export const rescueRequested = defineWindow<DyingEvent>('dying.rescue', [
  'before',
  'rescue',
  'after',
]);
export const dyingFinishing = defineWindow<DyingEvent>('dying.finishing');
export const dyingFinished = defineWindow<DyingResult>('dying.finished');
export const beforeDeath = defineWindow<DeathDraft>('death.before');
export const playerDied = defineWindow<DeathEvent>('death.committed');
export const playerBuried = defineWindow<BurialEvent>('death.buried');
export const deathFinished = defineWindow<BurialEvent>('death.finished', ['mode', 'after']);
