import { afterAll, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { createOfflineMatch, defaultContent } from '../../src/app/offline/practice';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { decideBasic } from '../../src/app/offline/basic-agent';
import { rebuildWorld } from '../../src/core/history/rebuild';
import {
  activePhase,
  activeTarget,
  activeTurn,
  generalOf,
  privateCardPools,
  readState,
  useDeclarations,
} from '../../src/sdk';
import type { GameResult } from '../../src/sdk';

interface GameEvidence {
  readonly general: string;
  readonly seed: number;
  readonly lineup: readonly string[];
  readonly decisions: number;
  readonly turns: number;
  readonly result: GameResult;
  readonly facts: number;
  readonly invokedSkills: readonly string[];
  readonly usedCards: readonly string[];
}
const evidence: GameEvidence[] = [];
const generals = defaultContent.generals;

afterAll(async () => {
  await mkdir('.artifacts/validation', { recursive: true });
  await writeFile(
    '.artifacts/validation/standard-games.json',
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        versions: defaultContent.versions,
        complete: evidence.length === 25,
        expected: 25,
        cases: evidence,
      },
      null,
      2,
    ) + '\n',
  );
});

for (const [index, general] of generals.entries()) {
  it(`${general.name}进入四人标准身份局，真实决策至胜负并清理临时结算`, async () => {
    expect(generals).toHaveLength(25);
    // 每名武将轮流位于甲席，并通过不同偏移与其他武将组合；不重排起手或注入状态。
    const lineup = [0, 7, 13, 19].map((offset) => generals[(index + offset) % generals.length]!.id);
    const seed = 42 + index * 17;
    const match = createOfflineMatch(4, seed, 'standard:identity', lineup);
    const running = match.start();
    let decisions = 0;
    try {
      for (let step = 0; step < 12_000 && !match.result; step++) {
        await setImmediate();
        expect(match.room.status).not.toBe('faulted');
        const request = match.room.decisions.pending[0];
        if (!request) continue;
        if (decisions >= 2400) throw new Error(`${general.id}: decision budget exhausted.`);
        const answer = decideBasic(observeAgent(match, request.player), request, (input) =>
          match.room.decisions.preview(request.id, input),
        );
        if (answer.kind === 'unsupported') throw new Error(`${request.prompt}: ${answer.reason}`);
        const accepted =
          answer.kind === 'cancel'
            ? match.room.decisions.cancel(request.id, request.token)
            : match.room.decisions.submit(request.id, request.token, answer.value);
        expect(accepted, `${general.id}: ${request.prompt}`).toEqual({ kind: 'accepted' });
        decisions++;
      }
      expect(match.result, `${general.id}: ${decisions} decisions`).not.toBeNull();
      expect(await running).toMatchObject({ kind: 'resolved', value: match.result });
      expect(match.room.status).toBe('ended');
      expect(generalOf(match.room.world, '甲席')).toBe(general.id);
      expect(match.room.decisions.pending).toEqual([]);
      expect(readState(match.room.world, activeTurn, activeTarget)).toBeNull();
      expect(readState(match.room.world, activePhase, activeTarget)).toBeNull();
      expect(useDeclarations(match.room.world)).toEqual([]);
      expect(match.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(
        false,
      );
      for (const player of match.room.world.snapshot.players)
        expect(privateCardPools(match.room.world, player.id)).toEqual([]);

      const cards = match.room.world.snapshot.zones.flatMap((zone) => zone.cards);
      expect(cards).toHaveLength(108);
      expect(new Set(cards).size).toBe(108);
      expect([...cards].sort()).toEqual(match.initial.cards.map((card) => card.id).sort());
      expect(match.room.history.facts('game.finished')).toHaveLength(1);
      expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
        match.room.world.snapshot,
      );
      const facts = match.room.history.facts();
      evidence.push({
        general: general.id,
        seed,
        lineup,
        decisions,
        turns: match.progress!.turns,
        result: match.result!,
        facts: facts.length,
        invokedSkills: [
          ...new Set(
            match.room.history
              .facts('skill.invoked')
              .map((fact) => (fact.data.detail as { skill: string }).skill),
          ),
        ].sort(),
        usedCards: [
          ...new Set(
            match.room.history
              .facts('card.used')
              .map(
                (fact) =>
                  (fact.data.detail as { declaration: { card: { name: string } } }).declaration.card
                    .name,
              ),
          ),
        ].sort(),
      });
    } finally {
      match.room.abort('test cleanup');
      await running;
    }
  }, 60_000);
}
