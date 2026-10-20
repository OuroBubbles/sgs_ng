import type { WorldReader } from '../../core/model/state';
import type { HistoryReader } from '../../core/history/journal';
import type { DecisionRequest } from '../../core/decisions/hub';
import type {
  GameView,
  DecisionView,
  OfferView,
  LogView,
  PublicAction,
  CountView,
  CandidateView,
  PoolView,
} from '../../core/view/game';
import type { CardView } from '../../core/view/table';
import { immutable } from '../../core/model/value';
import { activePhase, activeTurn, activeTarget } from '../../rules/turn/turn';
import { readState } from '../../rules/state/state';
import { knownRole } from './knowledge';
import { roleOf } from '../../rules/game/roles';
import { genderOf } from '../../rules/characters/gender';
import { kingdomOf } from '../../rules/characters/kingdom';
import { generalOf } from '../../rules/characters/general';
import type { RoleMatch } from './role-match';
import { delayedCards } from '../../rules/cards/delayed';
import { skillEffective } from '../../rules/skills/skills';
import { privateCardPools } from '../../rules/cards/private-pool';
import { useDeclarations } from '../../rules/cards/plan';
import { isChained } from '../../rules/combat/chain';
import { shieldOf } from '../../rules/combat/shield';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
export function strings(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
    ? value
    : [];
}
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
export const roleNames: Readonly<Record<string, string>> = {
  lord: '主公',
  loyalist: '忠臣',
  rebel: '反贼',
  renegade: '内奸',
};
const suitNames: Readonly<Record<string, CardView['suit']>> = {
  spade: '♠',
  heart: '♥',
  club: '♣',
  diamond: '♦',
  none: '·',
};
function count(value: unknown): CountView {
  const input = record(value);
  return {
    min: typeof input.min === 'number' ? input.min : 0,
    max: input.max === 'all' ? 'all' : typeof input.max === 'number' ? input.max : 0,
  };
}
export function candidates(value: unknown): readonly CandidateView[] {
  return Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        const entry = record(item);
        return typeof entry.id === 'string'
          ? [
              {
                id: entry.id,
                label: text(entry.label) || entry.id,
                selectable: entry.selectable !== false,
              },
            ]
          : [];
      })
    : [];
}
function face(match: RoleMatch, id: string, input: unknown): CardView {
  const card = record(input);
  const name = text(card.name);
  const rank = typeof card.rank === 'number' ? card.rank : 0;
  const presentation = match.content?.cardViews[name];
  return {
    id,
    name: match.book.definition(name).label,
    kind: presentation?.kind ?? 'other',
    description: presentation?.description ?? '请参阅当前内容定义。',
    suit: suitNames[text(card.suit)] ?? '·',
    color:
      card.color === 'red' || card.color === 'black' || card.color === 'none'
        ? card.color
        : ['heart', 'diamond'].includes(text(card.suit))
          ? 'red'
          : ['spade', 'club'].includes(text(card.suit))
            ? 'black'
            : 'none',
    rank: rank === 0 ? '—' : ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[rank] ?? String(rank)),
  };
}
export function cardView(match: RoleMatch, id: string): CardView {
  return face(
    match,
    id,
    match.room.inspect((ctx) => match.book.face(ctx, id)),
  );
}

/** 只有实体 ID 的旧事实按印刷牌识别；不拿当前持有者的过滤改写过去的日志。 */
function printedCardView(match: RoleMatch, id: string): CardView {
  return face(match, id, match.room.world.card(id));
}

export function decisionView(request: DecisionRequest): DecisionView {
  const base = {
    id: request.id,
    token: request.token,
    prompt: request.prompt,
    optional: request.optional,
    ...(typeof record(request.data).cancelLabel === 'string'
      ? { cancelLabel: text(record(request.data).cancelLabel) }
      : {}),
  };
  const data = record(request.data);
  switch (request.kind) {
    case 'play-action':
    case 'card-response':
    case 'use-card': {
      const offers: OfferView[] = Array.isArray(data.offers)
        ? data.offers.flatMap((value: unknown) => {
            const offer = record(value);
            const choice = record(offer.choice);
            return typeof offer.id === 'string' &&
              (offer.kind === 'physical' || offer.kind === 'viewAs' || offer.kind === 'active')
              ? [
                  {
                    id: offer.id,
                    label: text(offer.label),
                    description: text(offer.description),
                    kind: offer.kind,
                    cards: strings(offer.materials),
                    count: count(offer.count),
                    cardId: typeof choice.card === 'string' ? choice.card : null,
                  },
                ]
              : [];
          })
        : [];
      const purpose =
        request.kind === 'play-action'
          ? 'play'
          : request.kind === 'card-response'
            ? 'response'
            : data.timing === 'counter'
              ? 'counter'
              : data.timing === 'rescue'
                ? 'rescue'
                : 'effect';
      return { ...base, kind: request.kind, offers, fixedTargets: strings(data.targets), purpose };
    }
    case 'cards-targets': {
      const preview = record(data.preview);
      return {
        ...base,
        kind: request.kind,
        cards: candidates(preview.cards),
        targets: candidates(preview.targets),
        cardCount: count(data.cardCount),
        targetCount: count(data.targetCount),
      };
    }
    case 'invoke':
      return { ...base, kind: 'invoke' };
    case 'arrange': {
      const initial = record(data.initial);
      const assigned = Array.isArray(initial.groups) ? initial.groups.map(record) : [];
      return {
        ...base,
        kind: 'arrange',
        presentation: data.presentation === 'distribution' ? 'distribution' : 'order',
        ...('destinations' in data
          ? {
              destinations: Object.fromEntries(
                candidates(data.items).map((item) => [
                  item.id,
                  strings(record(data.destinations)[item.id]),
                ]),
              ),
            }
          : {}),
        items: candidates(data.items),
        groups: Array.isArray(data.groups)
          ? data.groups.map(record).map((group) => ({
              id: text(group.id),
              label: text(group.label),
              count: count(group.count),
              items: strings(assigned.find((entry) => entry.id === group.id)?.items),
            }))
          : [],
      };
    }
    case 'choose-option':
      return { ...base, kind: 'choose-option', options: candidates(data.options) };
    case 'trigger-order':
      return {
        ...base,
        kind: 'trigger-order',
        options: strings(data.options).map((id) => ({
          id,
          label: text(record(data.labels)[id]) || id,
          selectable: true,
        })),
      };
    default:
      return { ...base, kind: 'unsupported', original: request.kind };
  }
}

/** 只解释已明确公开的事实。原始历史可能含洗牌顺序、手牌等私有数据，永不透传。 */
function publicHistory(
  match: RoleMatch,
  history: HistoryReader,
  world: WorldReader,
): {
  actions: PublicAction[];
  log: LogView[];
  pools: PoolView[];
} {
  const actions: PublicAction[] = [];
  const log: LogView[] = [];
  const revealed = new Map<string, readonly string[]>();
  const targetsOf = (effects: readonly unknown[], edits: readonly unknown[]) => {
    // 效果被防止/无懈不等于移除用牌目标；只有显式的目标编辑改变公开指向。
    const removed = new Set(
      edits
        .map(record)
        .flatMap((edit) =>
          edit.kind === 'remove'
            ? [text(edit.effectId)]
            : edit.kind === 'replace'
              ? [text(edit.fromEffectId)]
              : [],
        ),
    );
    return effects
      .map(record)
      .filter((effect) => !removed.has(text(effect.effectId)))
      .map((effect) => text(effect.target));
  };
  const declarations = new Map(
    useDeclarations(world).map((use) => [use.id, targetsOf(use.effects, use.edits)]),
  );
  const finishedTargets = new Map(
    history.facts('card.finished').map((fact) => {
      const use = record(fact.data.detail);
      const effects = Array.isArray(use.effects) ? use.effects.map(record) : [];
      return [text(use.id), targetsOf(effects, Array.isArray(use.edits) ? use.edits : [])];
    }),
  );
  for (const fact of history.facts()) {
    const detail = record(fact.data.detail);
    const input = record(detail.input);
    let message = '';
    switch (fact.data.kind) {
      case 'card.used':
      case 'card.responded': {
        const declaration = record(detail.declaration);
        const semantic = record(declaration.card);
        const card = face(match, `action:${fact.seq}`, semantic);
        const actor = text(detail.actor);
        const originalTargets = strings(declaration.targets);
        const targets =
          declarations.get(text(declaration.useId)) ??
          finishedTargets.get(text(declaration.useId)) ??
          strings(declaration.targets);
        const responding = fact.data.kind === 'card.responded';
        const processing = world.snapshot.zones.some((zone) => zone.id === declaration.processing);
        actions.push({
          seq: fact.seq,
          actor,
          card,
          targets,
          kind: responding ? 'response' : 'use',
          processing,
        });
        const beneficiary = text(declaration.beneficiary);
        message = `${actor}${responding && beneficiary && beneficiary !== actor ? `为${beneficiary}` : ''}${responding ? '打出' : '使用'}【${card.name}】${originalTargets.length ? ` → ${originalTargets.join('、')}` : ''}`;
        if (semantic.name === 'standard:collateral')
          message += `，令其对 ${text(record(declaration.parameters).victim)} 使用杀`;
        break;
      }
      case 'collateral.weapon-taken':
        message = `${text(detail.actor)}因【借刀杀人】获得 ${text(detail.holder)} 的${strings(
          detail.cards,
        )
          .map((id) => `【${printedCardView(match, id).name}】`)
          .join('、')}`;
        break;
      case 'skill.invoked':
        message = `${text(detail.actor)}发动【${text(record(detail.declaration).label) || '技能'}】`;
        if (detail.skill === 'standard:rende')
          message += `，将 ${strings(detail.cards).length} 张牌交给 ${strings(record(detail.declaration).targets).join('、')}`;
        if (detail.skill === 'standard:liuli') {
          const redirect = record(record(detail.declaration).redirect);
          message += `，将杀从 ${text(redirect.from)} 转移给 ${text(redirect.to)}`;
        }
        break;
      case 'discard.limited':
        message = `${text(detail.actor)}有无法弃置的手牌，本阶段需弃置 ${String(detail.count)} 张（原需 ${String(detail.required)} 张）`;
        break;
      case 'weapon.follow-up':
        message = `${text(detail.actor)}通过【${text(detail.name)}】追杀`;
        break;
      case 'weapon.card-discarded':
        message = `${text(detail.actor)}以【${text(detail.name)}】弃置 ${text(detail.target)} 的【${printedCardView(match, text(detail.card)).name}】`;
        break;
      case 'weapon.damage-replaced':
        message = `${text(detail.actor)}发动【${text(detail.name)}】防止对 ${text(detail.target)} 的伤害`;
        break;
      case 'weapon.horse-discarded':
        message = `${text(detail.actor)}以【${text(detail.name)}】弃置 ${text(detail.target)} 的【${printedCardView(match, text(detail.card)).name}】`;
        break;
      case 'equipment.ignored':
        message = `${text(detail.actor)}的【青釭剑】使此杀忽略目标防具`;
        break;
      case 'equipment.blocked':
        message = `${text(detail.actor)}的【仁王盾】抵消黑色杀`;
        break;
      case 'draw.completed':
        message = `${text(input.player)}摸了 ${Array.isArray(detail.cards) ? detail.cards.length : 0} 张牌`;
        break;
      case 'damage.dealt':
        message = `${text(input.to)}受到 ${String(detail.amount)} 点${input.nature === 'normal' ? '' : input.nature === 'fire' ? '火焰' : input.nature === 'thunder' ? '雷电' : '属性'}伤害（${String(detail.beforeHp)} → ${String(detail.afterHp)}）${typeof detail.shieldLost === 'number' && detail.shieldLost > 0 ? `，护盾吸收 ${detail.shieldLost} 点` : ''}${record(input.origin).kind === 'chain' || typeof record(input.origin).chain === 'string' ? '，连环传播' : ''}${record(input.origin).kind === 'transfer' ? '，转移伤害' : ''}${detail.unchained === true ? '，解除连环' : ''}`;
        break;
      case 'damage.transferring':
        message = `${text(detail.player)}将 ${String(detail.amount)} 点伤害转移给${text(detail.target)}`;
        break;
      case 'shield.changed':
        message = `${text(detail.player)}${Number(detail.amount) > 0 ? '获得' : '失去'} ${Math.abs(Number(detail.amount))} 点护盾（${String(detail.before)} → ${String(detail.after)}）`;
        break;
      case 'chain.changed':
        message = `${text(detail.player)}${detail.after === true ? '进入连环' : '解除连环'}`;
        break;
      case 'hp.recovered':
        message = `${text(input.to)}回复 ${String(detail.amount)} 点体力`;
        break;
      case 'hp.lost':
        message = `${text(input.player)}失去 ${String(detail.amount)} 点体力`;
        break;
      case 'player.died':
        message = `${text(detail.player)}阵亡，身份为${roleNames[roleOf(world, text(detail.player))] ?? '未知'}`;
        break;
      case 'cards.discarded':
        message = `${text(detail.actor)}弃置 ${Array.isArray(detail.cards) ? detail.cards.length : 0} 张牌`;
        break;
      case 'cards.peeked': {
        const peeked = record(detail.declaration);
        message = `${text(peeked.player)}查看牌堆顶 ${strings(peeked.cards).length} 张牌`;
        break;
      }
      case 'cards.arranged': {
        const arranged = record(detail.declaration);
        message = `${text(arranged.player)}整理牌堆：${strings(arranged.top).length} 张置顶，${strings(arranged.bottom).length} 张置底`;
        break;
      }
      case 'cards.given': {
        const given = record(detail.declaration);
        message = `${text(given.actor)}将 ${String(given.count)} 张牌交给 ${text(given.target)}`;
        if (given.visible === true) {
          const cards = strings(given.cards).map((id) => printedCardView(match, id));
          message += `，公开：${cards.map((card) => `【${card.name}】${card.suit}${card.rank}`).join('、')}`;
          for (const card of cards)
            actions.push({
              seq: fact.seq,
              actor: text(given.actor),
              targets: [text(given.target)],
              card,
              kind: 'reveal',
              processing: false,
            });
        }
        break;
      }
      case 'cards.distributed': {
        const given = record(detail.declaration);
        const allocations = Array.isArray(given.allocations) ? given.allocations.map(record) : [];
        message = `${text(given.actor)}分配牌：${allocations.map((entry) => `${text(entry.target)} ${Number(entry.count)} 张`).join('、')}`;
        break;
      }
      case 'fanjian.guessed':
        message = `${text(detail.actor)}为反间选择${({ spade: '黑桃', heart: '红桃', club: '梅花', diamond: '方块' } as Readonly<Record<string, string>>)[text(detail.suit)] ?? '未知花色'}`;
        break;
      case 'turn.started':
        message = `${text(detail.owner)}的${record(detail.origin).kind === 'extra' ? '额外回合' : '回合'}`;
        break;
      case 'game.finished':
        message = `对局结束：${strings(detail.winners).join('、') || '无人'}获胜`;
        break;
      case 'cards.revealed':
        revealed.set(text(detail.zone), strings(detail.cards));
        message = `公开展示 ${strings(detail.cards).length} 张牌`;
        break;
      case 'delayed.placed': {
        const placed = record(detail.declaration);
        message = `${text(placed.owner)}的判定区置入【${match.book.definition(text(record(record(placed.source).card).name)).label}】`;
        break;
      }
      case 'delayed.resolving': {
        const resolving = record(detail.declaration);
        const entry = record(resolving.entry);
        const card = face(match, `action:${fact.seq}`, record(record(entry.source).card));
        const actor = text(entry.owner);
        actions.push({
          seq: fact.seq,
          actor,
          card,
          targets: [actor],
          kind: 'delayed',
          processing: world.snapshot.zones.some((zone) => zone.id === resolving.processing),
        });
        message = `${actor}结算【${card.name}】`;
        break;
      }
      case 'judgment.finished': {
        if (detail.card === null) break;
        const card = face(match, `action:${fact.seq}`, detail.card);
        const actor = text(detail.player);
        actions.push({
          seq: fact.seq,
          actor,
          card,
          targets: [],
          kind: 'judgment',
          processing: world.snapshot.zones.some((zone) => zone.id === detail.processing),
        });
        message = `${actor}的${match.content?.cardViews[text(detail.reason)] ? match.book.definition(text(detail.reason)).label : '判定'}结果：${card.suit}${card.rank}【${card.name}】`;
        break;
      }
      case 'judgment.card-obtained': {
        const obtained = record(detail.declaration);
        message = `${text(obtained.player)}获得判定牌【${printedCardView(match, text(obtained.card)).name}】`;
        break;
      }
      case 'use.materials-obtained': {
        const obtained = record(detail.declaration);
        message = `${text(obtained.actor)}获得造成伤害的材料牌${strings(obtained.cards)
          .map((id) => `【${printedCardView(match, id).name}】`)
          .join('')}`;
        break;
      }
      case 'judgment.replaced': {
        const changed = record(detail.declaration);
        const card = face(match, `action:${fact.seq}`, changed.card);
        const invoked = record(changed.invocation);
        message = `${typeof invoked.actor === 'string' ? `${text(invoked.actor)}发动【${text(record(invoked.declaration).label)}】，` : ''}${text(changed.player)}的判定牌改为 ${card.suit}${card.rank}【${card.name}】`;
        break;
      }
      case 'phase.skipped': {
        const labels: Record<string, string> = {
          prepare: '准备',
          judge: '判定',
          draw: '摸牌',
          play: '出牌',
          discard: '弃牌',
          finish: '结束',
        };
        message = `${text(detail.owner)}跳过了${labels[text(detail.kind)] ?? text(detail.kind)}阶段`;
        break;
      }
      case 'card.taken.delayed':
      case 'card.discarded.delayed':
        message = `${text(detail.actor)}移除了 ${text(detail.target)} 的【${match.book.definition(text(record(detail.card).name)).label}】${fact.data.kind === 'card.taken.delayed' ? `，获得 ${strings(detail.cards).length} 张材料牌` : ''}`;
        break;
      case 'equipment.equipped': {
        const equipment = record(detail.declaration);
        message = `${text(equipment.owner)}装备【${printedCardView(match, text(equipment.card)).name}】`;
        if (strings(equipment.replaced).length)
          message += `，替换${strings(equipment.replaced)
            .map((id) => `【${printedCardView(match, id).name}】`)
            .join('')}`;
        break;
      }
      case 'counter.finished': {
        if (detail.by === null) break;
        const subject = record(detail.subject);
        const effect = record(subject.effect);
        if (subject.kind === 'effect')
          message =
            detail.kind === 'countered'
              ? `【${match.book.definition(text(record(effect.card).name)).label}】对 ${text(effect.target)} 的效果被【${match.book.definition(text(record(record(detail.by).card).name)).label}】抵消`
              : `对 ${text(effect.target)} 的原效果继续生效`;
        else if (detail.kind === 'countered')
          message = `${text(record(subject.use).actor)} 的【${match.book.definition(text(record(record(subject.use).card).name)).label}】被反制`;
        break;
      }
      case 'card.taken': {
        const taken = detail.declaration ? record(detail.declaration) : detail;
        message = `${text(taken.actor)}从 ${text(taken.target)} 获得${taken.open === true ? `【${printedCardView(match, text(taken.card)).name}】` : '一张手牌'}`;
        break;
      }
      case 'card.discarded.by-effect':
        message = `${text(detail.actor)}弃置了 ${text(detail.target)} 的【${printedCardView(match, text(detail.card)).name}】`;
        break;
      case 'card.taken.public':
        message = `${text(detail.actor)}获得${strings(detail.cards)
          .map((id) => `【${printedCardView(match, id).name}】`)
          .join('')}`;
        break;
    }
    if (message) log.push({ seq: fact.seq, text: message });
  }
  const pools = [...revealed].flatMap(([zone, ids]) =>
    world.snapshot.zones.some((item) => item.id === zone)
      ? [
          {
            zone,
            visibility: 'public' as const,
            cards: ids.filter((id) => world.position(id) === zone).map((id) => cardView(match, id)),
          },
        ]
      : [],
  );
  return { actions: actions.slice(-3), log: log.slice(-100), pools };
}

export function projectMatch(
  match: RoleMatch,
  viewer: string | null,
  request: DecisionRequest | null,
  error = '',
  focus: string | null = viewer,
): GameView {
  const world = match.room.world;
  const assigned = match.progress !== null;
  const active = readState(world, activeTurn, activeTarget);
  const phase = readState(world, activePhase, activeTarget);
  const handoff =
    request && (request.kind === 'seat-ready' || request.player !== viewer)
      ? {
          key: `${request.id}:${request.token}`,
          player: request.player,
          name: request.player,
          turn: request.kind === 'seat-ready',
          extra: request.kind === 'seat-ready' && record(request.data).extra === true,
        }
      : null;
  const authorized = handoff ? null : viewer;
  const publicData = publicHistory(match, match.room.history, world);
  return immutable({
    revision: world.snapshot.revision,
    status:
      match.room.status === 'faulted'
        ? 'faulted'
        : error
          ? 'stopped'
          : match.result
            ? 'ended'
            : match.progress === null
              ? 'idle'
              : 'running',
    viewer: authorized,
    automated: null,
    paused: false,
    deckName: match.deckName,
    hand: authorized ? world.zone(`${authorized}:hand`).cards.map((id) => cardView(match, id)) : [],
    players: world.snapshot.players.map((player, i) => {
      const id = generalOf(world, player.id);
      const general = id ? match.generals.definition(id) : null;
      const role = assigned ? knownRole(world, authorized, player.id) : null;

      return {
        ...player,
        chained: isChained(world, player.id),
        shield: shieldOf(world, player.id),
        name: player.id,
        gender: { male: '男', female: '女', dual: '双', none: '无' }[genderOf(world, player.id)],
        kingdom: kingdomOf(world, player.id) ?? '',
        title: general?.name ?? '',
        ...(id && match.content?.generalViews[id]
          ? { portrait: match.content.generalViews[id].portrait }
          : {}),
        self: focus === player.id,
        color: ['#b7a16e', '#779ba3', '#b98c72', '#91a085'][i % 4]!,
        handCount: world.zone(`${player.id}:hand`).cards.length,
        role: role ? roleNames[role]! : null,
        equipment: world.zone(`${player.id}:equipment`).cards.map((id) => cardView(match, id)),
        judgment: delayedCards(world, player.id).map((entry) =>
          face(match, entry.id, entry.source.card),
        ),
        skills: [
          ...new Set([
            ...(general?.skills ?? []),
            ...world.snapshot.skills
              .filter((skill) => skill.owner === player.id)
              .map((skill) => skill.skill),
          ]),
        ].map((id) => {
          const definition = match.skills.definition(id);
          return {
            id: definition.id,
            name: definition.name,
            description: definition.description ?? '',
            effective: world.snapshot.skills.some(
              (skill) =>
                skill.owner === player.id && skill.skill === id && skillEffective(world, skill.id),
            ),
          };
        }),
      };
    }),
    decision: request && !handoff ? decisionView(request) : null,
    handoff,
    turn: match.progress?.turns ?? 0,
    extraTurn: active?.origin.kind === 'extra',
    active: active?.owner ?? null,
    phase: phase?.kind ?? null,
    drawCount: world.zone('draw').cards.length,
    discardCount: world.zone('discard').cards.length,
    ...publicData,
    pools: [
      ...publicData.pools,
      ...privateCardPools(world, authorized)
        .filter((pool) => !publicData.pools.some((publicPool) => publicPool.zone === pool.zone))
        .map((pool) => ({
          zone: pool.zone,
          visibility: 'private' as const,
          cards: pool.cards.map((id) => cardView(match, id)),
        })),
    ],
    result: match.result,
    error,
  });
}
