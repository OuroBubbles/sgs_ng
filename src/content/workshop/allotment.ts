import {
  ArrangementSelection,
  invoke,
  isGameOver,
  moveCards,
  on,
  phaseStarted,
  withPrivateTopCards,
} from '../../sdk';
import type { CardBook } from '../../sdk';
import type { SkillDefinition } from '../../sdk';

/** 角色额度与逐牌接收条件，复用分组模型；分配一次提交，不逐个打开送牌菜单。 */
export function allotment(book: CardBook) {
  return {
    id: 'workshop:allotment',
    name: '分筹',
    description:
      '准备阶段，你可以观看牌堆顶四张牌并分配。每名其他角色至多获得一张，且红牌只能交给受伤的其他角色；其余牌归自己。',
    triggers: [
      on(phaseStarted, {
        order: 'choose',
        when: (_ctx, { payload: phase, self }) =>
          phase.owner === self.owner && phase.kind === 'prepare',
        async run(ctx, { self }) {
          if (!(await invoke(ctx, self, '分筹：是否观看并分配牌堆顶四张牌？'))) return;
          await withPrivateTopCards(
            ctx,
            { player: self.owner, count: 4, reason: self.skill },
            async (at, pool) => {
              const live = () => at.world.player(self.owner).alive && !isGameOver(at.world);
              const model = new ArrangementSelection({
                items: () =>
                  live()
                    ? pool.remaining().map((id) => ({
                        id,
                        label: book.definition(book.face(at, id).name).label,
                      }))
                    : [],
                groups: () =>
                  live()
                    ? [
                        {
                          id: self.owner,
                          label: '自己保留',
                          count: { min: 0, max: 'all' as const },
                        },
                        ...at.world.snapshot.players
                          .filter((player) => player.alive && player.id !== self.owner)
                          .map((player) => ({
                            id: player.id,
                            label: player.id,
                            count: { min: 0, max: 1 },
                          })),
                      ]
                    : [],
                canPlace: (item, target) =>
                  target === self.owner ||
                  book.face(at, item).color !== 'red' ||
                  at.world.player(target).hp < at.world.player(target).maxHp,
              });
              if (!live() || !pool.remaining().length) return;
              const answer = await at.ask(
                model.decision(self.owner, '分筹：他人至多一张，红牌仅给受伤角色', {
                  reason: self.skill,
                  presentation: 'distribution',
                }),
              );
              if (answer.kind !== 'chosen' || !live() || !model.validate(answer.value).ok) return;
              const groups = answer.value.groups.filter((group) => group.items.length > 0);
              // 最终校验与批量移动之间没有可插入的异步后效；后效看到全部分配已提交。
              await moveCards(
                at,
                groups.map((group) => ({
                  cards: group.items,
                  from: pool.zone,
                  to: at.world.snapshot.zones.find(
                    (zone) => zone.owner === group.id && zone.kind === 'hand',
                  )!.id,
                  place: 'bottom' as const,
                })),
                self.skill,
                {
                  kind: 'cards.distributed',
                  data: {
                    actor: self.owner,
                    reason: self.skill,
                    allocations: groups.map((group) => ({
                      target: group.id,
                      count: group.items.length,
                    })),
                  },
                },
              );
            },
          );
        },
      }),
    ],
  } satisfies SkillDefinition;
}
