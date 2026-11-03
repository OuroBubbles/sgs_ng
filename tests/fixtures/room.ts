import { expect, vi } from 'vitest';
import type { DecisionRequest, Decision } from '../../src/core/decisions/hub';
import type { WorldSeed } from '../../src/core/model/state';
import { Room } from '../../src/core/runtime/room';

export function worldSeed(): WorldSeed {
  return {
    players: ['a', 'b', 'c'].map((id) => ({ id, hp: 4, maxHp: 4, alive: true })),
    skills: [],
    states: [],
    cards: ['a1', 'a2', 'b1', 'd1'].map((id) => ({ id, name: 'slash', suit: 'spade', rank: 7 })),
    zones: [
      { id: 'a:hand', kind: 'hand', owner: 'a', scopeId: null, cards: ['a1', 'a2'] },
      { id: 'b:hand', kind: 'hand', owner: 'b', scopeId: null, cards: ['b1'] },
      { id: 'draw', kind: 'draw', owner: null, scopeId: null, cards: ['d1'] },
      { id: 'discard', kind: 'discard', owner: null, scopeId: null, cards: [] },
    ],
  };
}

export function room(id = 'test'): Room {
  return new Room({ id, seed: 12345, world: worldSeed() });
}

export function choose(optional = false): Decision<string> {
  return {
    player: 'a',
    kind: 'option',
    prompt: '选择一个选项',
    data: { options: ['yes', 'no'] },
    optional,
    validate: (input) =>
      input === 'yes' || input === 'no'
        ? { ok: true, value: input }
        : { ok: false, reason: 'Invalid option.' },
  };
}

export async function nextRequest(target: Room): Promise<DecisionRequest> {
  return vi.waitFor(() => {
    expect(target.decisions.pending).toHaveLength(1);
    const request = target.decisions.pending[0];
    if (!request) throw new Error('Expected a pending decision.');
    return request;
  });
}

type Roomed = Room | { readonly room: Room };
const roomOf = (target: Roomed): Room => (target instanceof Room ? target : target.room);
/** 回答下一个请求并断言被接受；kind 为 null 时不检查请求类型。 */
export async function answer(
  target: Roomed,
  value: unknown = true,
  kind: string | null = 'invoke',
): Promise<DecisionRequest> {
  const at = roomOf(target);
  const request = await nextRequest(at);
  if (kind !== null) expect(request.kind).toBe(kind);
  expect(at.decisions.submit(request.id, request.token, value)).toEqual({ kind: 'accepted' });
  return request;
}
/** 取消下一个请求并断言被接受。 */
export async function cancel(target: Roomed): Promise<void> {
  const at = roomOf(target);
  const request = await nextRequest(at);
  expect(at.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
}
