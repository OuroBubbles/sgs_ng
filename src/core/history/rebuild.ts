import type { WorldSeed, WorldSnapshot } from '../model/state';
import { World } from '../state/world';
import type { Fact } from './journal';

/** 只重建已提交状态；不恢复 Promise、监听闭包、随机源位置或挂起的技能栈。 */
export function rebuildWorld(seed: WorldSeed, facts: readonly Fact[]): WorldSnapshot {
  const state = new World(seed);
  let previousSeq = 0;
  for (const fact of facts) {
    if (fact.seq <= previousSeq || fact.data.revision !== state.reader.snapshot.revision + 1)
      throw new Error('Fact order or revision is discontinuous.');
    const prepared = state.prepare(fact.data.changes);
    state.apply(prepared);
    previousSeq = fact.seq;
  }
  return state.reader.snapshot;
}
