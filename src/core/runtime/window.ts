import type { Context } from './room';
import type { WorldReader } from '../model/state';

export interface WindowType<T> {
  readonly id: string;
  readonly groups: readonly string[];
  /** 只参与类型推导，不存运行时 payload。 */
  readonly payload?: T;
}

export function defineWindow<T>(id: string, groups: readonly string[] = ['main']): WindowType<T> {
  if (
    !id ||
    !groups.length ||
    groups.some((group) => !group) ||
    new Set(groups).size !== groups.length
  )
    throw new Error('Window requires an ID and distinct named groups.');
  return Object.freeze({ id, groups: Object.freeze([...groups]) });
}

/** 本窗口内的一次独立结算；index 从 1 开始，total 在该候选入队时固定。 */
export interface TriggerOccurrence {
  readonly id: string;
  readonly index: number;
  readonly total: number;
}

/** id 标识具体拥有者的效果实例；times 显式生成可与其他效果交错的有限次数。 */
export interface Trigger<T> {
  readonly id: string;
  readonly label?: string;
  readonly owner: string | null;
  readonly group?: string;
  readonly order?: 'automatic' | 'choose';
  readonly times?: (ctx: Context, payload: T) => number;
  readonly eligible: (ctx: Context, payload: T, occurrence: TriggerOccurrence) => boolean;
  readonly run: (ctx: Context, payload: T, occurrence: TriggerOccurrence) => void | Promise<void>;
}

export interface WindowOptions {
  /** 事件主体只提供模式没有默认起点时的回退，不覆盖模式政策。 */
  readonly subject?: string;
  /** 特殊规则显式覆盖起点；通常只声明 subject，交给模式决定行动序。 */
  readonly anchor?: string;
  /** 普通纯查询决定窗口是否继续；false 收束整个窗口，不回滚已执行效果。 */
  readonly active?: (ctx: Context) => boolean;
}

/** 模式提供纯查询；null 表示回退到调用方主体或首席。核心不认识回合规则。 */
export type ActionAnchor = (ctx: Context, subject: string | null) => string | null;

/** 开窗时从权威状态生成候选，核心不需要导入技能定义或内容包。 */
export interface TriggerSource {
  collect<T>(type: WindowType<T>, world: WorldReader, payload: T): readonly Trigger<T>[];
}

/** 执行中的具体窗口；不是存档数据。相同 type 的嵌套窗口有不同引用和 ID。 */
export interface WindowRef<T> {
  readonly id: string;
  readonly type: WindowType<T>;
  readonly payload: T;
}

export interface WindowAdmission {
  readonly state: 'open' | 'stopped';
  readonly added: readonly string[];
  readonly skipped: readonly {
    readonly id: string;
    readonly reason: 'known' | 'past';
  }[];
}
