import type { GameView } from '../../core/view/game';
import type { CardView } from '../../core/view/table';

export interface RemoteAsset {
  /** 房间内稳定的资源 URI；各客户端替换为自己的 Blob URL。 */
  readonly url: string;
  readonly type: string;
  readonly data: string;
}

export function decodeAsset(type: string, data: string): Blob {
  return new Blob([Uint8Array.from(atob(data), (value) => value.charCodeAt(0))], { type });
}

/** 只绑定展示契约中的 URL；选项 ID、答案和文案即使与资源 URI 相同也原样保留。 */
export function bindRoomAssets(view: GameView, assets: ReadonlyMap<string, string>): GameView {
  if (!assets.size) return view;
  const url = (value: string) => assets.get(value) ?? value;
  const card = (value: CardView): CardView => ({
    ...value,
    ...(value.image ? { image: url(value.image) } : {}),
    ...(value.icon ? { icon: url(value.icon) } : {}),
  });
  const decision = view.decision;
  return {
    ...view,
    hand: view.hand.map(card),
    players: view.players.map((player) => ({
      ...player,
      ...(player.portrait ? { portrait: url(player.portrait) } : {}),
      equipment: player.equipment.map(card),
      judgment: player.judgment.map(card),
    })),
    pools: view.pools.map((pool) => ({ ...pool, cards: pool.cards.map(card) })),
    actions: view.actions.map((action) => ({ ...action, card: card(action.card) })),
    log: view.log.map((entry) => ({
      ...entry,
      ...(entry.audio?.voice ? { audio: { ...entry.audio, voice: url(entry.audio.voice) } } : {}),
    })),
    decision:
      decision?.kind === 'cards-targets' && decision.cardGroups
        ? {
            ...decision,
            cardGroups: decision.cardGroups.map((group) => ({
              ...group,
              cards: group.cards.map((choice) => ({
                ...choice,
                face: choice.face ? card(choice.face) : null,
              })),
            })),
          }
        : decision,
  };
}
