import { expect } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import type { RoleMatch } from '../../src/host/role-match';
import { observeAgent } from '../../src/host/agent-observation';
import { decideBasic } from '../../src/host/basic-agent';
import type { DecisionRequest } from '../../src/core/decisions/hub';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { activePhase, activeTurn } from '../../src/rules/turn/turn';
import { useDeclarations } from '../../src/rules/cards/plan';

/** 驱动真实整局并验证终局不变量；阵容、预算和技能断言仍由场景负责。 */
export async function playMatch(
  match: RoleMatch,
  budget: { readonly steps: number; readonly decisions?: number },
  beforeAnswer?: (request: DecisionRequest) => void,
): Promise<number> {
  const running = match.start();
  let decisions = 0;

  try {
    for (let step = 0; step < budget.steps && !match.result; step++) {
      await setImmediate();
      expect(match.room.status).not.toBe('faulted');
      const request = match.room.decisions.pending[0];
      if (!request) continue;
      if (decisions >= (budget.decisions ?? Infinity))
        throw new Error(`${request.prompt}: decision budget exhausted.`);

      // 场景在回答前检查分配投影等中间状态，不再复制整套 AI 驱动与善后。
      beforeAnswer?.(request);
      const answer = decideBasic(observeAgent(match, request.player), request, (input) =>
        match.room.decisions.preview(request.id, input),
      );
      if (answer.kind === 'unsupported') throw new Error(`${request.prompt}: ${answer.reason}`);
      const accepted =
        answer.kind === 'cancel'
          ? match.room.decisions.cancel(request.id, request.token)
          : match.room.decisions.submit(request.id, request.token, answer.value);
      expect(accepted, request.prompt).toEqual({ kind: 'accepted' });
      decisions++;
    }

    expect(match.result, `${decisions} decisions / ${match.progress?.turns} turns`).not.toBeNull();
    expect(await running).toMatchObject({ kind: 'resolved', value: match.result });

    // 在测试清理前验证自然收束，不能借 finally 的 abort 掩盖未关闭的规则资源。
    expect(match.room.status).toBe('ended');
    expect(match.room.decisions.pending).toEqual([]);
    expect(activeTurn.of(match.room.world)).toBeNull();
    expect(activePhase.of(match.room.world)).toBeNull();
    expect(useDeclarations(match.room.world)).toEqual([]);
    const world = match.room.world.snapshot;
    expect(world.zones.some((zone) => zone.kind === 'processing')).toBe(false);
    expect(world.states.some((state) => state.key === 'core:private-pool')).toBe(false);

    const cards = world.zones.flatMap((zone) => zone.cards);
    expect([...cards].sort()).toEqual(match.initial.cards.map((card) => card.id).sort());

    const facts = match.room.history.facts();
    expect(facts.filter((fact) => fact.data.kind === 'game.finished')).toHaveLength(1);
    expect(rebuildWorld(match.initial, facts)).toEqual(world);
    return decisions;
  } finally {
    match.room.abort('test cleanup');
    await running;
  }
}
