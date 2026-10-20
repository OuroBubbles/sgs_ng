import { expect, it, vi } from 'vitest';
import { DecisionHub } from '../../src/core/decisions/hub';
import { Scope } from '../../src/core/runtime/scope';
import { Journal } from '../../src/core/history/journal';

function setup() {
  let revision = 0;
  let available = true;
  const journal = new Journal();
  const scope = new Scope('test', null);
  const fault = vi.fn();
  const describe = vi.fn(() => ({ choices: ['yes'] }));
  const hub = new DecisionHub(
    'test',
    () => revision,
    journal,
    (fn) => fn(),
    fault,
  );
  const running = hub.open(
    {
      player: 'a',
      kind: 'choice',
      prompt: '选一项',
      optional: false,
      data: null,
      available: () => available,
      describe,
      validate: (input) =>
        input === 'yes'
          ? { ok: true as const, value: input }
          : { ok: false as const, reason: 'invalid' },
    },
    scope,
    {
      flowId: 'flow',
      parentFlowId: null,
      scopeId: scope.id,
      scopePath: scope.path,
      reason: 'test',
    },
  );
  const request = hub.pending[0]!;
  return {
    hub,
    running,
    request,
    journal,
    scope,
    describe,
    fault,
    unavailable: () => {
      available = false;
      revision++;
    },
  };
}

it.each(['pending', 'preview', 'submit', 'cancel', 'invalidate'] as const)(
  '失效刷新经 %s 关闭无解必选请求，不暴露关闭后的旧请求',
  async (read) => {
    const game = setup();
    game.unavailable();
    switch (read) {
      case 'pending':
        expect(game.hub.pending).toEqual([]);
        break;
      case 'preview':
        expect(game.hub.preview(game.request.id, 'yes')).toBeNull();
        break;
      case 'submit':
        expect(game.hub.submit(game.request.id, game.request.token, 'yes')).toMatchObject({
          reason: 'closed',
        });
        break;
      case 'cancel':
        expect(game.hub.cancel(game.request.id, game.request.token)).toMatchObject({
          reason: 'closed',
        });
        break;
      case 'invalidate':
        game.hub.invalidate(game.request.id);
        break;
    }
    expect(await game.running).toEqual({ kind: 'unavailable' });
    expect(game.hub.pending).toEqual([]);
    expect(game.describe).toHaveBeenCalledTimes(1);
    expect(game.fault).not.toHaveBeenCalled();
    game.scope.close('done');
    expect(game.journal.entries.filter((entry) => entry.type === 'decision.close')).toHaveLength(1);
  },
);
