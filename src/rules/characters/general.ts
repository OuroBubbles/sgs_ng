import type { WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineState, readState, stateChange } from '../state/state';
import type { SkillBook } from '../skills/skills';
import type { Gender } from './gender';

export interface GeneralDefinition {
  readonly id: string;
  readonly name: string;
  readonly kingdom: string;
  readonly gender: Gender;
  readonly maxHp: number;
  readonly skills: readonly string[];
}
export function defineGeneral(input: GeneralDefinition): GeneralDefinition {
  const { id, name, kingdom, gender, maxHp } = input;
  // 先固定声明字段与技能列表，再验证同一份数据；不复制或冻结作者对象。
  const skills = immutable(input.skills);
  if (
    !id ||
    !name ||
    !kingdom ||
    !Number.isSafeInteger(maxHp) ||
    maxHp < 1 ||
    !['male', 'female', 'dual', 'none'].includes(gender) ||
    skills.some((id) => !id) ||
    new Set(skills).size !== skills.length
  )
    throw new Error('Invalid general definition.');
  return immutable({ id, name, kingdom, gender, maxHp, skills });
}

/** 目录持有不可变定义；选将只在 World 保存 ID，不复制技能实现或可漂移的显示状态。 */
export class GeneralBook {
  readonly #definitions: ReadonlyMap<string, GeneralDefinition>;
  constructor(definitions: readonly GeneralDefinition[], skills: SkillBook) {
    const entries = definitions.map(defineGeneral);
    if (new Set(entries.map((general) => general.id)).size !== entries.length)
      throw new Error('Duplicate general definition.');
    for (const general of entries) for (const skill of general.skills) skills.definition(skill);
    this.#definitions = new Map(entries.map((general) => [general.id, general]));
  }
  definition(id: string): GeneralDefinition {
    const general = this.#definitions.get(id);
    if (!general) throw new Error(`Unknown general definition: ${id}`);
    return general;
  }
}
const general = defineState<string | null>(
  'character:general',
  null,
  (value): value is string | null =>
    value === null || (typeof value === 'string' && value.length > 0),
);
const target = (owner: string) => ({ owner, source: 'general', lifetime: null });
export const generalOf = (world: WorldReader, owner: string): string | null =>
  readState(world, general, target(owner));
export function generalChange(ctx: Context, owner: string, id: string) {
  return stateChange(ctx, general, target(owner), id);
}
