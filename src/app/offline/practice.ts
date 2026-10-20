import { availablePackages } from '../../content/available';
import { resolvePackages } from '../../content/package';
import type { ResolvedContent } from '../../content/package';
import { RoleMatch } from './role-match';

export { availablePackages };
export const defaultContent = resolvePackages(availablePackages, ['standard']);
export const seatNames = ['甲席', '乙席', '丙席', '丁席', '戊席', '己席', '庚席', '辛席'];

/** 客户端默认载入标准基础包；额外源码包由开局选择显式启用。 */
export function createOfflineMatch(
  count = 4,
  seed = 42,
  preset = 'standard:identity',
  lineup: readonly string[] | null = null,
  content: ResolvedContent = defaultContent,
): RoleMatch {
  if (lineup && lineup.length !== count) throw new Error('General lineup must match seat count.');
  const deck = content.createDeck(preset);
  const deckName = content.decks.find((deck) => deck.id === preset)!.label;
  return new RoleMatch({
    id: 'local',
    deckName,
    seed,
    players: Array.from({ length: count }, (_, i) => ({
      id: seatNames[i]!,
      ...(lineup
        ? { general: lineup[i]! }
        : {
            gender: i % 2 === 0 ? ('male' as const) : ('female' as const),
            ...(i === 0 ? { skills: ['standard:wusheng'] } : {}),
          }),
    })),
    deck,
    content,
  });
}
