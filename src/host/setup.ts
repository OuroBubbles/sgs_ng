import { createRoleMatch, seatNames, defaultContent, practiceContent } from './content';
import { roleRoster } from '../rules/game/roles';
import type { NetworkRoomOptions } from './room';
import type { ContentCatalog } from '../content/catalog';

/** 创建前的普通数据草稿；人数由阵容长度确定，不保存另一份可矛盾的席位数。 */
export interface RoomSetup {
  readonly practice?: boolean;
  readonly seed: number;
  readonly preset: string;
  readonly lineup: readonly string[];
  readonly humans: number;
}

export const defaultRoomSetup: RoomSetup = {
  seed: 42,
  preset: 'standard:identity',
  lineup: ['standard:guanyu', 'standard:caocao', 'standard:zhangfei', 'standard:zhaoyun'],
  humans: 2,
};

/** 桌面和开发主持端共用装配；身份配置、武将与牌组仍由原有对局装配验证。 */
export function createRoomOptions(
  setup: RoomSetup,
  content: ContentCatalog = setup.practice ? practiceContent : defaultContent,
): NetworkRoomOptions {
  const preset = setup.preset;
  if (!Number.isSafeInteger(setup.seed) || setup.seed < 1 || setup.seed > 0xffffffff)
    throw new Error('对局种子应为 1–4294967295 的整数。');
  if (!Number.isInteger(setup.humans) || setup.humans < 2 || setup.humans > setup.lineup.length)
    throw new Error('玩家人数应在 2 与总席位数之间。');
  roleRoster(setup.lineup.length);
  const deck = content.decks.find((deck) => deck.id === preset);
  if (!deck) throw new Error('当前房间不包含此牌组。');
  if (setup.lineup.some((id) => !content.generals.some((general) => general.id === id)))
    throw new Error('当前房间不包含此武将。');
  return {
    seed: setup.seed,
    deckName: deck.label,
    players: setup.lineup.map((general, i) => ({
      id: seatNames[i]!,
      general,
      human: i < setup.humans,
    })),
    generals: content.generals.map(({ id, name }) => {
      const portrait = content.generalViews[id]?.portrait;
      return { id, name, ...(portrait ? { portrait } : {}) };
    }),
    createMatch: (players, seed) =>
      createRoleMatch({
        seed,
        preset,
        lineup: players.map((player) => player.general),
        content,
      }),
  };
}
