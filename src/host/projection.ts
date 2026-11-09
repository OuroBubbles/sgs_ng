import { face } from '../rules/cards/face';
import { Use } from '../rules/cards/use';
import { cardDef, rulesOf } from '../rules/skills/skills';
import type { WorldReader } from '../core/model/state';
import type { HistoryReader } from '../core/history/journal';
import type { DecisionRequest } from '../core/decisions/hub';
import type {
  GameView,
  DecisionView,
  OfferView,
  LogView,
  PublicAction,
  CountView,
  CandidateView,
  PoolView,
  CardChoiceGroupView,
} from '../protocol';
import type { CardView, CardChoiceView } from '../protocol';
import { immutable, isStringArray } from '../core/model/value';
import { activePhase, activeTurn } from '../rules/turn/turn';

import { knownRole } from './knowledge';
import { roleOf } from '../rules/game/roles';
import { genderOf } from '../rules/characters/gender';
import { kingdomOf } from '../rules/characters/kingdom';
import { generalOf } from '../rules/characters/general';
import type { RoleMatch } from './role-match';
import { delayedCards } from '../rules/cards/delayed';
import { skillEffective } from '../rules/skills/skills';
import { privateCardPools } from '../rules/cards/private-pool';
import { useDeclarations } from '../rules/cards/plan';
import { isChained } from '../rules/combat/chain';
import { shieldOf } from '../rules/combat/shield';
import { CardEvent } from '../rules/cards/move';
import { Cards } from '../rules/cards/move';
import { isFact } from '../core/history/journal';
import type { Fact } from '../core/history/journal';
import type { Timing } from '../core/runtime/event';
import type { Card } from '../core/model/state';
import { primaryOf, tupleOf } from '../rules/cards/types';
import type { UseSnapshot } from '../rules/cards/types';
import { Skill } from '../rules/skills/skills';
import { Discard } from '../rules/cards/discard';
import { Equipment } from '../rules/cards/equipment';
import { Draw } from '../rules/cards/draw';
import { Damage } from '../rules/combat/damage';
import { Shield } from '../rules/combat/shield';
import { Chain } from '../rules/combat/chain';
import { Hp } from '../rules/combat/recover';
import { PlayerEvent } from '../rules/combat/life';
import { Turn, Phase } from '../rules/turn/turn';
import { Game } from '../rules/game/end';
import { Delayed } from '../rules/cards/delayed';
import { Judgment } from '../rules/cards/judge';
import { Counter } from '../rules/cards/counter';
import { Collateral } from '../content/standard/cards/collateral';
import { Weapon } from '../content/standard/card-kit';
import { Fanjian } from '../content/standard/skills/fanjian';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
function strings(value: unknown): readonly string[] {
  return isStringArray(value) ? value : [];
}
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const roleNames: Readonly<Record<string, string>> = {
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
type Face = Pick<Card, 'name' | 'suit' | 'rank'> & { readonly color?: string };
function presentCard(match: RoleMatch, id: string, card: Face): CardView {
  const { name, rank } = card;
  const presentation = match.content?.cardViews[name];
  const definition = cardDef(match.room, name);
  return {
    id,
    name: definition.label,
    kind:
      presentation?.kind ??
      (definition.type === 'basic' ? 'other' : definition.type === 'trick' ? 'trick' : 'equipment'),
    description: definition.description ?? '请参阅当前内容定义。',
    ...(presentation?.icon ? { icon: presentation.icon } : {}),
    ...(presentation?.image ? { image: presentation.image } : {}),
    ...(definition.equipment ? { slot: definition.equipment.slot } : {}),
    suit: suitNames[card.suit] ?? '·',
    color:
      card.color === 'red' || card.color === 'black' || card.color === 'none'
        ? card.color
        : ['heart', 'diamond'].includes(card.suit)
          ? 'red'
          : ['spade', 'club'].includes(card.suit)
            ? 'black'
            : 'none',
    rank: rank === 0 ? '—' : ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[rank] ?? String(rank)),
  };
}
export function cardView(match: RoleMatch, id: string): CardView {
  return presentCard(
    match,
    id,
    match.room.inspect((ctx) => face(ctx, id)),
  );
}

/** 只有实体 ID 的旧事实按印刷牌识别；不拿当前持有者的过滤改写过去的日志。 */
function printedCardView(match: RoleMatch, id: string): CardView {
  return presentCard(match, id, match.room.world.card(id));
}

function decisionView(match: RoleMatch, request: DecisionRequest): DecisionView {
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
                    ...(typeof offer.skill === 'string' ? { skill: offer.skill } : {}),
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
      const cards = candidates(preview.cards);
      const groups = new Map<string, { id: string; label: string; cards: CardChoiceView[] }>();
      if (data.purpose === 'owned-card' && Array.isArray(data.ownedCards))
        for (const raw of data.ownedCards) {
          const item = record(raw);
          const candidate = cards.find((card) => card.id === item.id);
          if (!candidate) continue;
          const area = text(item.area);
          let group = groups.get(area);
          if (!group) {
            const labels: Readonly<Record<string, string>> = {
              hand: '手牌',
              equipment: '装备',
              judgment: '判定区',
            };
            group = {
              id: area,
              label: `${text(data.target)} · ${labels[area] ?? '其他牌'}`,
              cards: [],
            };
            groups.set(area, group);
          }
          group.cards.push({
            id: candidate.id,
            label: candidate.label,
            face: item.face === null ? null : presentCard(match, candidate.id, item.face as Face),
          });
        }
      const cardGroups: readonly CardChoiceGroupView[] = [...groups.values()];
      return {
        ...base,
        kind: request.kind,
        cards,
        ...(data.purpose === 'owned-card' ? { cardGroups } : {}),
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
  projectCard: (id: string) => CardView,
): {
  actions: PublicAction[];
  log: LogView[];
  pools: PoolView[];
} {
  const actions: PublicAction[] = [];
  const log: LogView[] = [];
  const facts = history.facts();
  const generalMedia = (actor: string) => {
    const id = generalOf(world, actor);
    return id ? match.content?.generalViews[id] : undefined;
  };
  const skillVoice = (actor: string, skill: string, seq: number) => {
    const voices = generalMedia(actor)?.voices?.[skill];
    return voices?.length ? voices[seq % voices.length] : undefined;
  };
  const actionUses = new Map<number, string>();
  const targetsOf = (
    effects: readonly { readonly effectId: string; readonly target: string }[],
    edits: UseSnapshot['edits'],
  ) => {
    // 效果被防止/无懈不等于移除用牌目标；只有显式的目标编辑改变公开指向。
    const removed = new Set(
      edits.flatMap((edit) =>
        edit.kind === 'remove'
          ? [edit.effectId]
          : edit.kind === 'replace'
            ? [edit.fromEffectId]
            : [],
      ),
    );
    return effects.filter((effect) => !removed.has(effect.effectId)).map((effect) => effect.target);
  };
  const declarations = new Map(
    useDeclarations(world).map((use) => [use.id, targetsOf(use.effects, use.edits)]),
  );
  const cardName = (id: string) => `【${printedCardView(match, id).name}】`;
  const label = (card: { readonly name: string }) => cardDef(match.room, card.name).label;
  const processing = (zone: string) => world.snapshot.zones.some((item) => item.id === zone);
  type Narrator = (fact: Fact, play: (audio: LogView['audio']) => void) => string;
  const narrate = new Map<string, Narrator>();
  const on = <R>(
    kinds: Timing<unknown, R> | readonly Timing<unknown, R>[],
    render: (
      detail: Fact<R>['data']['detail'],
      fact: Fact<R>,
      play: (audio: LogView['audio']) => void,
    ) => string | undefined,
  ) => {
    for (const kind of [kinds].flat())
      narrate.set(kind.id, (fact, play) =>
        isFact(fact, kind) ? (render(fact.data.detail, fact, play) ?? '') : '',
      );
  };
  on([CardEvent.used, CardEvent.responded], ({ actor, declaration }, fact, play) => {
    const card = presentCard(match, `action:${fact.seq}`, declaration.card);
    const source = declaration.card.source;
    const voice =
      skillVoice(actor, source?.kind === 'viewAs' ? source.skill : '', fact.seq) ??
      match.content?.cardViews[declaration.card.name]?.voices?.[
        genderOf(world, actor) === 'female' ? 'female' : 'male'
      ];
    if (voice) play({ voice });
    const tuples = (declaration.targets ?? []).map(tupleOf);
    const targets = tuples.map(primaryOf);
    if (actions.length < 3) actionUses.set(fact.seq, declaration.useId ?? '');
    const responding = fact.data.kind === CardEvent.responded.id;
    actions.push({
      seq: fact.seq,
      actor,
      card,
      targets,
      kind: responding ? 'response' : 'use',
      processing: processing(declaration.processing),
    });
    const { beneficiary } = declaration;
    return `${actor}${responding && beneficiary && beneficiary !== actor ? `为${beneficiary}` : ''}${responding ? '打出' : '使用'}【${card.name}】${tuples.length ? ` → ${tuples.map(([first, ...rest]) => (rest.length ? `${first}（→ ${rest.join('、')}）` : first)).join('、')}` : ''}`;
  });
  on(
    Collateral.weaponTaken,
    ({ declaration: d }) =>
      `${d.actor}因【借刀杀人】获得 ${d.holder} 的${d.cards.map(cardName).join('、')}`,
  );
  on(Skill.invoked, ({ actor, skill, declaration }, fact, play) => {
    const voice = skillVoice(actor, skill ?? '', fact.seq);
    if (voice) play({ voice });
    // 技能宣告是各技能自定的数据；作者层总会写入 label，选了角色的技能附带公开目标。
    // 不按技能 ID 拼专用文案。若本次支付把牌交到别人手牌（pay: give），从变更里读出交牌叙述。
    const declared = declaration as { readonly label?: string; readonly targets?: unknown };
    const targets = Array.isArray(declared.targets) ? declared.targets.map(String) : [];
    const handoffs = fact.data.changes.flatMap((change) =>
      change.kind === 'move' && change.to.endsWith(':hand') && !change.to.startsWith(`${actor}:`)
        ? [change]
        : [],
    );
    const given =
      handoffs.length === 0
        ? ''
        : `。${actor}将 ${handoffs.reduce((n, move) => n + move.cards.length, 0)} 张牌交给 ${handoffs[0]!.to.slice(0, -':hand'.length)}`;
    return `${actor}发动【${declared.label || '技能'}】${targets.length ? `，目标 ${targets.join('、')}` : ''}${given}`;
  });
  on(
    Discard.limited,
    (d) => `${d.actor}有无法弃置的手牌，本阶段需弃置 ${d.count} 张（原需 ${d.required} 张）`,
  );
  on(Weapon.followUp, (d) => `${d.actor}通过【${d.name}】追杀`);
  // 效果弃牌按来源（技能名或牌名）统一叙述，内容不另记日志事实。
  const sourceName = (id: string) => {
    try {
      return match.skills.definition(id).name;
    } catch {
      // 装备技能以 `${牌}-ability` 为 ID，名称即牌名。
      return cardDef(match.room, id.replace(/-ability$/, '')).label;
    }
  };
  on(Discard.committed, ({ declaration: d }) => {
    const cards = d.cards.map(cardName).join('');
    return d.actor === d.owner
      ? `${d.actor}因【${sourceName(d.reason)}】弃置${cards}`
      : `${d.actor}以【${sourceName(d.reason)}】弃置 ${d.owner} 的${cards}`;
  });
  on(Weapon.damageReplaced, (d) => `${d.actor}发动【${d.name}】防止对 ${d.target} 的伤害`);
  on(Equipment.ignored, (d) => `${d.actor}的【青釭剑】使此杀忽略目标防具`);
  on(Equipment.blocked, (d) => `${d.actor}的【仁王盾】抵消黑色杀`);
  on(Draw.completed, (d, _fact, play) => {
    play({ effect: 'draw' });
    return `${d.input.player}摸了 ${d.cards.length} 张牌`;
  });
  on(Damage.dealt, (d, _fact, play) => {
    const { nature, origin } = d.input;
    play({
      effect:
        nature === 'fire' ? 'fire-damage' : nature === 'thunder' ? 'thunder-damage' : 'damage',
    });
    const natures: Readonly<Record<string, string>> = { normal: '', fire: '火焰', thunder: '雷电' };
    return `${d.input.to}受到 ${d.amount} 点${natures[nature] ?? '属性'}伤害（${d.beforeHp} → ${d.afterHp}）${d.shieldLost > 0 ? `，护盾吸收 ${d.shieldLost} 点` : ''}${origin?.kind === 'chain' || (origin?.kind === 'transfer' && origin.chain) ? '，连环传播' : ''}${origin?.kind === 'transfer' ? '，转移伤害' : ''}${d.unchained ? '，解除连环' : ''}`;
  });
  on(Damage.transferring, (d) => `${d.player}将 ${d.amount} 点伤害转移给${d.target}`);
  on(
    Shield.changed,
    (d) =>
      `${d.player}${d.amount > 0 ? '获得' : '失去'} ${Math.abs(d.amount)} 点护盾（${d.before} → ${d.after}）`,
  );
  on(Chain.changed, (d) => `${d.player}${d.after ? '进入连环' : '解除连环'}`);
  on(Hp.recovered, (d) => `${d.input.to}回复 ${d.amount} 点体力`);
  on(Hp.lost, (d) => `${d.input.player}失去 ${d.amount} 点体力`);
  on(PlayerEvent.died, ({ player }, _fact, play) => {
    const voice = generalMedia(player)?.deathVoice;
    if (voice) play({ voice });
    return `${player}阵亡，身份为${roleNames[roleOf(world, player)] ?? '未知'}`;
  });
  on(Cards.discarded, (d) => `${d.actor}弃置 ${d.cards.length} 张牌`);
  on(Cards.peeked, ({ declaration: d }) => `${d.player}查看牌堆顶 ${d.cards.length} 张牌`);
  on(
    Cards.arranged,
    ({ declaration: d }) =>
      `${d.player}整理牌堆：${d.top.length} 张置顶，${d.bottom.length} 张置底`,
  );
  on(Cards.given, ({ declaration: d }, fact) => {
    if (!d.visible) return `${d.actor}将 ${d.count} 张牌交给 ${d.target}`;
    const cards = (d.cards ?? []).map((id) => printedCardView(match, id));
    // 逆序读取事实时，单条事实中的多个动作也要逆序，最终统一恢复显示顺序。
    for (const card of [...cards].reverse())
      actions.push({
        seq: fact.seq,
        actor: d.actor,
        targets: [d.target],
        card,
        kind: 'reveal',
        processing: false,
      });
    return `${d.actor}将 ${d.count} 张牌交给 ${d.target}，公开：${cards.map((card) => `【${card.name}】${card.suit}${card.rank}`).join('、')}`;
  });
  on(
    Cards.distributed,
    ({ declaration: d }) =>
      `${d.actor}分配牌：${d.allocations.map((entry) => `${entry.target} ${entry.count} 张`).join('、')}`,
  );
  on(Fanjian.guessed, (d) => {
    const suits: Readonly<Record<string, string>> = {
      spade: '黑桃',
      heart: '红桃',
      club: '梅花',
      diamond: '方块',
    };
    return `${d.actor}为反间选择${suits[d.suit] ?? '未知花色'}`;
  });
  on(Turn.started, (d) => `${d.owner}的${d.origin.kind === 'extra' ? '额外回合' : '回合'}`);
  on(Game.finished, (d, _fact, play) => {
    play({ effect: 'finish' });
    return `对局结束：${d.winners.join('、') || '无人'}获胜`;
  });
  on(Cards.revealed, (d) => `公开展示 ${d.cards.length} 张牌`);
  on(Delayed.placed, ({ declaration: d }) => `${d.owner}的判定区置入【${label(d.source.card)}】`);
  on(Delayed.resolving, ({ declaration: d }, fact) => {
    const card = presentCard(match, `action:${fact.seq}`, d.entry.source.card);
    const actor = d.entry.owner;
    actions.push({
      seq: fact.seq,
      actor,
      card,
      targets: [actor],
      kind: 'delayed',
      processing: processing(d.processing),
    });
    return `${actor}结算【${card.name}】`;
  });
  on(Judgment.finished, (d, fact) => {
    if (d.card === null) return;
    const card = presentCard(match, `action:${fact.seq}`, d.card);
    actions.push({
      seq: fact.seq,
      actor: d.player,
      card,
      targets: [],
      kind: 'judgment',
      processing: processing(d.processing),
    });
    return `${d.player}的${rulesOf(match.room).cards.get(d.reason)?.label ?? '判定'}结果：${card.suit}${card.rank}【${card.name}】`;
  });
  on(Judgment.cardObtained, ({ declaration: d }) => `${d.player}获得判定牌${cardName(d.card)}`);
  on(
    Use.materialsObtained,
    ({ declaration: d }) => `${d.actor}获得造成伤害的材料牌${d.cards.map(cardName).join('')}`,
  );
  on(Judgment.replaced, ({ declaration: d }, fact) => {
    const card = presentCard(match, `action:${fact.seq}`, d.card);
    const invoked = d.invocation;
    const label = invoked ? (invoked.declaration as { readonly label?: string }).label : '';
    return `${invoked ? `${invoked.actor}发动【${label ?? ''}】，` : ''}${d.player}的判定牌改为 ${card.suit}${card.rank}【${card.name}】`;
  });
  on(Phase.skipped, (d) => {
    const labels: Readonly<Record<string, string>> = {
      prepare: '准备',
      judge: '判定',
      draw: '摸牌',
      play: '出牌',
      discard: '弃牌',
      finish: '结束',
    };
    return `${d.owner}跳过了${labels[d.kind] ?? d.kind}阶段`;
  });
  on(
    CardEvent.takenDelayed,
    (d) => `${d.actor}移除了 ${d.target} 的【${label(d.card)}】，获得 ${d.cards.length} 张材料牌`,
  );
  on(Equipment.equipped, ({ declaration: d }) =>
    d.replaced.length
      ? `${d.owner}装备${cardName(d.card)}，替换${d.replaced.map(cardName).join('')}`
      : `${d.owner}装备${cardName(d.card)}`,
  );
  on(Counter.finished, (d) => {
    if (d.by === null) return;
    const { subject } = d;
    if (subject.kind === 'effect')
      return d.kind === 'countered'
        ? `【${label(subject.effect.card)}】对 ${subject.effect.target} 的效果被【${label(d.by.card)}】抵消`
        : `对 ${subject.effect.target} 的原效果继续生效`;
    if (d.kind === 'countered')
      return `${subject.use.actor} 的【${label(subject.use.card)}】被反制`;
  });
  on(
    CardEvent.taken,
    ({ declaration: d }) =>
      `${d.actor}从 ${d.target} 获得${d.open ? cardName(d.card) : '一张手牌'}`,
  );
  on(
    CardEvent.takenPublic,
    ({ declaration: d }) => `${d.actor}获得${d.cards.map(cardName).join('')}`,
  );
  // 结果只展示最近 100 条日志和 3 个动作；从末尾解释到满足实际输出为止。
  // 仍按当前投影解释角色、牌名与处理区，不缓存过去的 World 或格式化结果。
  for (
    let index = facts.length - 1;
    index >= 0 && (log.length < 100 || actions.length < 3);
    index--
  ) {
    const fact = facts[index]!;
    let audio: LogView['audio'];
    const message = narrate.get(fact.data.kind)?.(fact, (value) => (audio = value)) ?? '';
    if (message && log.length < 100)
      log.push({ seq: fact.seq, text: message, ...(audio ? { audio } : {}) });
    if (actions.length > 3) actions.length = 3;
  }
  // 旧事实仍决定存活公开牌池和动作的最终目标，不能随可见日志一起截断。
  // 只解释当前区域及三个可见动作需要的数据，保持函数无状态与 Map 的首次出现顺序。
  const zones = new Set(world.snapshot.zones.map((zone) => zone.id));
  const revealed = new Map<string, readonly string[]>();
  const neededUses = new Set(actionUses.values());
  const finishedTargets = new Map<string, readonly string[]>();
  for (const fact of history.facts(Cards.revealed)) {
    const { zone, cards } = fact.data.detail;
    if (zones.has(zone)) revealed.set(zone, cards);
  }
  for (const fact of history.facts(CardEvent.finished)) {
    const use = fact.data.detail;
    if (neededUses.has(use.id) && !declarations.has(use.id))
      finishedTargets.set(use.id, targetsOf(use.effects, use.edits));
  }
  const pools = [...revealed].flatMap(([zone, ids]) =>
    world.snapshot.zones.some((item) => item.id === zone)
      ? [
          {
            zone,
            visibility: 'public' as const,
            cards: ids.filter((id) => world.position(id) === zone).map(projectCard),
          },
        ]
      : [],
  );
  return {
    actions: actions.reverse().map((action) => {
      const use = actionUses.get(action.seq);
      return use === undefined
        ? action
        : {
            ...action,
            targets: declarations.get(use) ?? finishedTargets.get(use) ?? action.targets,
          };
    }),
    log: log.reverse(),
    pools,
  };
}

export function projectMatch(
  match: RoleMatch,
  viewer: string | null,
  request: DecisionRequest | null,
  error = '',
  focus: string | null = viewer,
): GameView {
  return match.room.inspect((ctx) => {
    const world = ctx.world;
    const assigned = match.progress !== null;
    const active = activeTurn.of(world);
    const phase = activePhase.of(world);
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
    // 停止后的错误视图不再执行可能正是故障来源的牌面查询。
    const projectCard = (id: string) =>
      error || match.room.status === 'faulted'
        ? printedCardView(match, id)
        : presentCard(match, id, face(ctx, id));
    const publicData = publicHistory(match, match.room.history, world, projectCard);
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
      control: null,
      paused: false,
      deckName: match.deckName,
      hand: authorized ? world.zone(`${authorized}:hand`).cards.map(projectCard) : [],
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
          ...(id && match.content?.generalViews[id]?.portrait
            ? { portrait: match.content.generalViews[id].portrait }
            : {}),
          self: focus === player.id,
          color: ['#b7a16e', '#779ba3', '#b98c72', '#91a085'][i % 4]!,
          handCount: world.zone(`${player.id}:hand`).cards.length,
          role: role ? roleNames[role]! : null,
          equipment: world.zone(`${player.id}:equipment`).cards.map(projectCard),
          judgment: delayedCards(world, player.id).map((entry) =>
            presentCard(match, entry.id, entry.source.card),
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
              active: Boolean(definition.active?.length || definition.viewAs?.length),
              effective: world.snapshot.skills.some(
                (skill) =>
                  skill.owner === player.id &&
                  skill.skill === id &&
                  skillEffective(world, skill.id),
              ),
            };
          }),
        };
      }),
      decision: request && !handoff ? decisionView(match, request) : null,
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
            cards: pool.cards.map(projectCard),
          })),
      ],
      result: match.result,
      error,
    });
  });
}
