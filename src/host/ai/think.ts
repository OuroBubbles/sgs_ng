import type { DecisionRequest } from '../../core/decisions/hub';
import type { Room } from '../../core/runtime/room';
import { counterNames } from '../../rules/cards/counter';
import { useCard } from '../../rules/cards/use';
import type { RoleMatch } from '../role-match';
import { imagineFlow, resumeTurn } from './imagine';
import type { Reply } from './imagine';
import { seatOf } from './seat';
import type { Seat, Table } from './seat';
import { equipWorth, keepWorth, worth } from './worth';

/**
 * 托管 AI：一个独立系统，自己给决策定权重，内容作者不写任何 AI。
 *
 * - 出牌阶段：枚举全部合法的出牌/主动技能选择，在“想象的局面”（按本席所知重新洗配的完整副本）
 *   里接着进行当前回合，各走一步到下一次出牌时机，用同一个局面估值比较前后差值，取最好的一个。
 * - 本人回合里、不在用牌结算中的其他决策（发动与否、选目标、选项）：同样从当前阶段重新进入，
 *   每个候选各推演到回合结束，取估值最高者。
 * - 其余（别人回合里的响应、救援、反制、中途选择）：通用反射——立场决定帮谁害谁，
 *   反制先推演一次被反制的效果看它对己方是好是坏。
 * 推演中的每个决策由对应席位以更浅的前瞻作答；前瞻层数有上限。
 */

export type AgentAnswer =
  | { readonly kind: 'submit'; readonly value: unknown }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'unsupported'; readonly reason: string };
export interface AgentPreview {
  readonly valid: boolean;
  readonly feedback: unknown;
}
export type Inspect = (value: unknown) => AgentPreview | null;

/** 前瞻预算：depth 为推演层数；lookahead 为此处能否再开副本。 */
export interface Mind {
  readonly depth: number;
  readonly lookahead: boolean;
}
const LIVE: Mind = { depth: 0, lookahead: true };
const MAX_DEPTH = 2;
/** 出牌须比“结束出牌”至少好这么多，避免为噪声出牌。 */
const MARGIN = 0.25;
/** 留牌价值不超过它的牌可当作可有可无的费用。 */
const JUNK = 3;
const PLAY_OPTIONS = 40;
const BRANCHES = 6;

type Record_ = Record<string, unknown>;
const object = (value: unknown): Record_ =>
  value !== null && typeof value === 'object' ? (value as Record_) : {};
const list = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
const selectable = (feedback: unknown, key: 'cards' | 'targets'): string[] => {
  const items = object(feedback)[key];
  return Array.isArray(items)
    ? items
        .map(object)
        .filter((item) => typeof item.id === 'string' && item.selectable === true)
        .map((item) => String(item.id))
    : [];
};
const submit = (value: unknown): AgentAnswer => ({ kind: 'submit', value });
const CANCEL: AgentAnswer = { kind: 'cancel' };

/** 决策身份：同一席位、同一种类、同一来源（技能/牌）。推演中据此找回“同一个”决策。 */
const signature = (request: DecisionRequest): string => {
  const data = object(request.data);
  const source = [data.reason, data.skill].find((value) => typeof value === 'string') ?? '';
  return `${request.player}|${request.kind}|${source}`;
};
/** 推演种子只由决策身份决定：同一局面同一决策总是同样的想象，回放可复现。 */
const seedOf = (request: DecisionRequest): number => {
  let hash = 0x811c9dc5;
  for (const char of `${request.id}:${request.token}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
};

/** 主持端入口：以该席位的观察作答原局中的决策。 */
export function decide(source: Table | RoleMatch, request: DecisionRequest): Promise<AgentAnswer> {
  const table = 'match' in source ? source : { match: source, room: source.room };
  return think(
    seatOf(table, request.player),
    request,
    (input) => table.room.decisions.preview(request.id, input),
    LIVE,
  );
}

export async function think(
  seat: Seat,
  request: DecisionRequest,
  inspect: Inspect,
  mind: Mind = LIVE,
): Promise<AgentAnswer> {
  if (request.kind === 'play-action') return play(seat, request, inspect, mind);
  const turn = seat.turn;
  if (
    mind.lookahead &&
    turn?.owner === seat.view.actor &&
    !turn.resolving &&
    ['invoke', 'cards-targets', 'choose-option'].includes(request.kind)
  ) {
    const chosen = await rollout(seat, request, inspect, mind);
    if (chosen) return chosen;
  }
  return reflex(seat, request, inspect, mind);
}

// —— 推演 ——

const toReply = (answer: AgentAnswer, request: DecisionRequest): Reply =>
  answer.kind === 'submit'
    ? answer
    : answer.kind === 'cancel' || request.optional
      ? { kind: 'cancel' }
      : { kind: 'stop' };

/** 副本里的决策交给对应席位，以给定前瞻作答。 */
const answerIn = async (seat: Seat, room: Room, request: DecisionRequest, mind: Mind) =>
  toReply(
    await think(
      seat.seatIn(room, request.player),
      request,
      (input) => room.decisions.preview(request.id, input),
      mind,
    ),
    request,
  );

/**
 * 从当前阶段开头重新进入本回合：遇到“同一个”决策前，本人已经做过的可选决策一律放弃（不重复），
 * 遇到时记下估值并给出候选答案；之后 step 推演到本人下一次出牌时机为止，rollout 推演到回合结束。
 * 返回估值差；没能重现该决策或推演失败为 null。
 */
async function trial(
  seat: Seat,
  request: DecisionRequest,
  answer: Reply,
  mind: Mind,
  horizon: 'step' | 'rollout',
): Promise<number | null> {
  const actor = seat.view.actor;
  const seed = seedOf(request);
  const key = signature(request);
  const value = (room: Room) => worth(room, seat.rules, actor, seat.stance);
  const quiet: Mind = { depth: mind.depth + 1, lookahead: false };
  const inner: Mind =
    horizon === 'step' ? quiet : { depth: mind.depth + 1, lookahead: mind.depth + 1 < MAX_DEPTH };
  let base: number | null = null;
  const phases = horizon === 'step' ? (['play'] as const) : seat.turn!.phases;
  const imagined = await resumeTurn(seat, seat.imagine(seed), seed, phases, async (room, next) => {
    if (base === null) {
      if (signature(next) === key) {
        base = value(room);
        return answer;
      }
      if (next.player === actor && next.optional) return { kind: 'cancel' };
      if (next.player === actor && next.kind === 'invoke') return { kind: 'submit', value: false };
      return answerIn(seat, room, next, quiet);
    }
    if (horizon === 'step' && next.player === actor && next.kind === 'play-action')
      return { kind: 'stop' };
    return answerIn(seat, room, next, inner);
  });
  try {
    return base === null || imagined.outcome === 'failed' ? null : value(imagined.room) - base;
  } finally {
    await imagined.dispose();
  }
}

/** 出牌阶段：逐个候选推演一步，取估值增益最大且超过阈值者，否则结束出牌。 */
async function play(
  seat: Seat,
  request: DecisionRequest,
  inspect: Inspect,
  mind: Mind,
): Promise<AgentAnswer> {
  const turn = seat.turn;
  if (!mind.lookahead || turn?.owner !== seat.view.actor || turn.phase?.kind !== 'play')
    return CANCEL;
  let best: { readonly input: unknown; readonly score: number } | null = null;
  for (const input of playOptions(seat, request, inspect)) {
    const score = await trial(seat, request, { kind: 'submit', value: input }, mind, 'step');
    if (score !== null && score > (best?.score ?? MARGIN)) best = { input, score };
  }
  return best ? submit(best.input) : CANCEL;
}

/** 本人回合中的其他决策：各候选推演到回合结束，先列出的反射答案在平手时优先。 */
async function rollout(
  seat: Seat,
  request: DecisionRequest,
  inspect: Inspect,
  mind: Mind,
): Promise<AgentAnswer | null> {
  const prior = reflex(seat, request, inspect, { ...mind, lookahead: false });
  const options: AgentAnswer[] = [];
  const add = (answer: AgentAnswer) => {
    if (answer.kind === 'unsupported') return;
    const key = JSON.stringify(answer);
    if (!options.some((option) => JSON.stringify(option) === key)) options.push(answer);
  };
  add(await prior);
  const data = object(request.data);
  if (request.kind === 'invoke') [true, false].forEach((value) => add(submit(value)));
  if (request.kind === 'choose-option')
    for (const option of Array.isArray(data.options) ? data.options.map(object) : [])
      if (typeof option.id === 'string' && inspect(option.id)?.valid) add(submit(option.id));
  if (request.kind === 'cards-targets')
    for (const selection of selections(seat, {}, inspect, BRANCHES)) add(submit(selection));
  if (request.optional) add(CANCEL);
  if (options.length < 2) return null;
  let best: { readonly answer: AgentAnswer; readonly score: number } | null = null;
  for (const answer of options.slice(0, BRANCHES + 1)) {
    const score = await trial(seat, request, toReply(answer, request), mind, 'rollout');
    if (score !== null && (!best || score > best.score)) best = { answer, score };
  }
  return best?.answer ?? null;
}

/** 推演一张牌对目标的效果，返回己方估值差；用于判断要不要反制。 */
async function oracle(
  seat: Seat,
  request: DecisionRequest,
  name: string,
  actor: string,
  target: string,
  mind: Mind,
): Promise<number | null> {
  const seed = seedOf(request);
  const value = (room: Room) => worth(room, seat.rules, seat.view.actor, seat.stance);
  let base = 0;
  const imagined = await imagineFlow(
    seat,
    seat.imagine(seed),
    seed,
    (ctx) =>
      useCard(ctx, {
        actor,
        choice: { kind: 'generated', face: { name }, materials: [], reason: 'ai:oracle' },
        targets: [target],
        timing: { kind: 'effect', ignoreDistance: true },
        prohibitedCounters: counterNames,
      }),
    (room, next) => answerIn(seat, room, next, { depth: mind.depth + 1, lookahead: false }),
    (room) => (base = value(room)),
  );
  try {
    return imagined.outcome === 'finished' ? value(imagined.room) - base : null;
  } finally {
    await imagined.dispose();
  }
}

// —— 候选枚举 ——

/** 本人一张牌（手牌、装备或私有牌池）留着的价值；看不到的牌为 0。 */
function cost(seat: Seat, id: string): number {
  const self = seat.view.players.find((player) => player.id === seat.view.actor)!;
  const card = [...seat.view.hand, ...seat.view.pools].find((item) => item.id === id);
  if (card)
    return keepWorth(
      seat.rules,
      card.name,
      seat.view.hand.filter((item) => item.name === card.name).length,
    );
  const equipped = self.equipment.find((item) => item.id === id);
  return equipped ? equipWorth(seat.rules.cards.get(equipped.name)) + 1 : 0;
}

/**
 * 牌与目标的联合选择：牌按留牌价值从低到高逐张加入；目标在每一步分别展开（偏向 prefer 排序）。
 * 只沿可完成性反馈前进，收集至多 limit 个合法选择。
 */
function selections(
  seat: Seat,
  base: Record_,
  inspect: Inspect,
  limit: number,
  prefer: (a: string, b: string) => number = (a, b) => seat.stance(a) - seat.stance(b),
): { cards: string[]; targets: string[] }[] {
  const found: { cards: string[]; targets: string[] }[] = [];
  const seen = new Set<string>();
  const visit = (cards: string[], targets: string[]) => {
    const key = `${cards.join()}|${targets.join()}`;
    if (found.length >= limit || seen.has(key)) return;
    seen.add(key);
    const preview = inspect({ ...base, cards, targets });
    if (!preview) return;
    if (preview.valid) found.push({ cards, targets });
    const card = selectable(preview.feedback, 'cards')
      .filter((id) => !cards.includes(id))
      .sort((a, b) => cost(seat, a) - cost(seat, b))[0];
    if (card && cards.length < 4) visit([...cards, card], targets);
    if (targets.length < 2)
      for (const target of selectable(preview.feedback, 'targets')
        .filter((id) => !targets.includes(id))
        .sort(prefer)
        .slice(0, BRANCHES))
        visit(cards, [...targets, target]);
  };
  visit([], []);
  return found;
}

/** 至多 max 张的材料组合，按留牌价值从低到高，只取前几种。 */
function materialSets(sorted: readonly string[], min: number, max: number): string[][] {
  const result: string[][] = [];
  const visit = (start: number, chosen: string[]) => {
    if (result.length >= 3) return;
    if (chosen.length >= min) result.push(chosen);
    if (chosen.length >= Math.min(max, 2)) return;
    for (let i = start; i < sorted.length && result.length < 3; i++)
      visit(i + 1, [...chosen, sorted[i]!]);
  };
  visit(0, []);
  return result;
}

/** 出牌阶段的全部候选：实体牌、转换牌（几种最便宜的材料）与主动技能，各配合法目标。 */
function playOptions(seat: Seat, request: DecisionRequest, inspect: Inspect): unknown[] {
  const options: unknown[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(object(request.data).offers)
    ? (object(request.data).offers as unknown[])
    : []) {
    const offer = object(raw);
    const source = object(offer.choice);
    if (offer.kind === 'active') {
      for (const selection of selections(seat, source, inspect, BRANCHES))
        options.push({ ...source, ...selection });
      continue;
    }
    const count = object(offer.count);
    const materials = [...list(offer.materials)].sort((a, b) => cost(seat, a) - cost(seat, b));
    const min = typeof count.min === 'number' ? count.min : 0;
    const max = Math.min(
      count.max === 'all' ? materials.length : Number(count.max),
      materials.length,
    );
    const sets =
      offer.kind === 'physical' ? [[String(source.card)]] : materialSets(materials, min, max);
    for (const chosen of sets) {
      const choice =
        offer.kind === 'physical'
          ? { kind: 'physical', card: source.card }
          : { kind: 'viewAs', instance: source.instance, recipe: source.recipe, materials: chosen };
      if (offer.kind === 'physical') {
        // 同名同花色的实体牌效果相同，只推演一张。
        const card = seat.view.hand.find((item) => item.id === source.card);
        const key = card ? `${card.name}|${card.suit}` : String(source.card);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      let found = 0;
      const visit = (targets: readonly string[]) => {
        if (found >= BRANCHES) return;
        const preview = inspect({ choice, targets });
        if (!preview) return;
        if (preview.valid) {
          options.push({ choice, targets });
          found++;
        }
        if (targets.length >= 3) return;
        for (const target of selectable(preview.feedback, 'targets').filter(
          (id) => !targets.includes(id),
        ))
          visit([...targets, target]);
      };
      visit([]);
    }
  }
  return options.slice(0, PLAY_OPTIONS);
}

// —— 反射 ——

/** 不推演时的通用策略：立场决定帮谁、害谁，牌按留牌价值从低到高花。 */
async function reflex(
  seat: Seat,
  request: DecisionRequest,
  inspect: Inspect,
  mind: Mind,
): Promise<AgentAnswer> {
  const data = object(request.data);
  const decline = (): AgentAnswer =>
    request.optional
      ? CANCEL
      : { kind: 'unsupported', reason: `AI 无法完成必选决策：${request.kind}` };
  switch (request.kind) {
    case 'seat-ready':
    case 'invoke':
      return submit(true);
    case 'trigger-order':
      return firstValid(list(data.options), inspect) ?? decline();
    case 'choose-option':
      return (
        firstValid(
          (Array.isArray(data.options) ? data.options.map(object) : []).map((option) =>
            String(option.id),
          ),
          inspect,
        ) ?? decline()
      );
    case 'arrange': {
      const initial = object(data.initial);
      const groups = (Array.isArray(initial.groups) ? initial.groups.map(object) : []).map(
        (group) => ({
          id: String(group.id),
          items: [...list(group.items)].sort((a, b) => cost(seat, b) - cost(seat, a)),
        }),
      );
      const choice = { groups };
      if (inspect(choice)?.valid) return submit(choice);
      return inspect(initial)?.valid ? submit(initial) : decline();
    }
    case 'cards-targets':
      return data.purpose === 'owned-card'
        ? pickOwned(seat, data, inspect, decline)
        : select(seat, request, inspect, decline);
    case 'card-response':
    case 'use-card':
      return respond(seat, request, inspect, mind, decline);
    case 'play-action':
      return CANCEL;
    default:
      return decline();
  }
}

function firstValid(ids: readonly string[], inspect: Inspect): AgentAnswer | null {
  const id = ids.find((option) => inspect(option)?.valid);
  return id === undefined ? null : submit(id);
}

/**
 * 通用选择：自己也在可选目标里时视为“给予”（偏向自己与友方），否则视为“施加”（偏向敌方）。
 * 可放弃的选择若只能落到错的一方、或只是花掉有用的牌，就放弃。
 */
function select(
  seat: Seat,
  request: DecisionRequest,
  inspect: Inspect,
  decline: () => AgentAnswer,
): AgentAnswer {
  const actor = seat.view.actor;
  const first = inspect({ cards: [], targets: [] });
  const giving = selectable(first?.feedback, 'targets').includes(actor);
  const prefer = giving
    ? (a: string, b: string) => seat.stance(b) - seat.stance(a)
    : (a: string, b: string) => seat.stance(a) - seat.stance(b);
  const choice = { cards: [] as string[], targets: [] as string[] };
  for (let step = 0; step < 64; step++) {
    const preview = inspect(choice);
    if (preview?.valid) {
      if (!request.optional) return submit(choice);
      const wrong = choice.targets.some((id) =>
        giving ? seat.stance(id) <= 0 : seat.stance(id) >= 0,
      );
      const wasteful = !choice.targets.length && choice.cards.some((id) => cost(seat, id) > JUNK);
      return wrong || wasteful ? CANCEL : submit(choice);
    }
    const card = selectable(preview?.feedback, 'cards')
      .filter((id) => !choice.cards.includes(id))
      .sort((a, b) => cost(seat, a) - cost(seat, b))[0];
    const target = selectable(preview?.feedback, 'targets')
      .filter((id) => !choice.targets.includes(id))
      .sort(prefer)[0];
    if (card) choice.cards.push(card);
    else if (target) choice.targets.push(target);
    else break;
  }
  return decline();
}

/** 选一名角色的一张牌：敌方取最值钱的装备否则手牌，友方与自己优先清判定区。 */
function pickOwned(
  seat: Seat,
  data: Record_,
  inspect: Inspect,
  decline: () => AgentAnswer,
): AgentAnswer {
  const owner = String(data.target);
  const hostile = owner !== seat.view.actor && seat.stance(owner) < 0;
  const rank = (item: Record_): number => {
    const face = object(item.face);
    const name = typeof face.name === 'string' ? face.name : null;
    switch (item.area) {
      case 'judgment':
        return hostile ? -10 : 20;
      case 'equipment':
        return hostile
          ? 10 + equipWorth(name ? seat.rules.cards.get(name) : undefined)
          : -cost(seat, String(item.id));
      default:
        return hostile ? 5 : -cost(seat, String(item.id));
    }
  };
  const items = (Array.isArray(data.ownedCards) ? data.ownedCards.map(object) : []).sort(
    (a, b) => rank(b) - rank(a),
  );
  for (const item of items) {
    const choice = { cards: [String(item.id)], targets: [] };
    if (inspect(choice)?.valid) return submit(choice);
  }
  return decline();
}

/** 响应、救援、反制与效果用牌：先定要不要出，再用最便宜的合法牌。 */
async function respond(
  seat: Seat,
  request: DecisionRequest,
  inspect: Inspect,
  mind: Mind,
  decline: () => AgentAnswer,
): Promise<AgentAnswer> {
  const data = object(request.data);
  const beneficiary =
    typeof data.beneficiary === 'string' ? data.beneficiary : list(data.targets)[0];
  if (data.timing === 'counter') {
    const counter = object(data.counter);
    const actor = String(counter.actor);
    const target = String(counter.target);
    // 先推演被反制的效果本身；推不出来时，假定用牌者对自己是好意、对别人是恶意。
    const simulated =
      mind.lookahead && mind.depth < MAX_DEPTH
        ? await oracle(seat, request, String(counter.card), actor, target, mind)
        : null;
    const good = simulated
      ? simulated > 0
      : actor === target
        ? seat.stance(target) > 0
        : seat.stance(target) < 0;
    // 深一层的反制推翻上一层：偶数层反对原效果，奇数层维护原效果。
    if (typeof counter.depth !== 'number' || good === (counter.depth % 2 === 0)) return decline();
  } else if (beneficiary) {
    const self = beneficiary === seat.view.actor;
    // 响应与救援只为自己和友方；效果用牌（如被借刀）不帮自己人以外的人出力。
    if (!self && seat.stance(beneficiary) <= 0 && data.timing !== 'effect') return decline();
    if (data.timing === 'effect' && !self && seat.stance(beneficiary) > 0) return decline();
  }
  let best: { readonly input: unknown; readonly spent: number } | null = null;
  for (const raw of Array.isArray(data.offers) ? data.offers : []) {
    const offer = object(raw);
    const source = object(offer.choice);
    if (offer.kind === 'physical') {
      const input = { kind: 'physical', card: source.card };
      const spent = cost(seat, String(source.card));
      if ((!best || spent < best.spent) && inspect(input)?.valid) best = { input, spent };
      continue;
    }
    if (offer.kind !== 'viewAs') continue;
    const count = object(offer.count);
    const materials = [...list(offer.materials)].sort((a, b) => cost(seat, a) - cost(seat, b));
    const min = typeof count.min === 'number' ? count.min : 0;
    const max = Math.min(
      count.max === 'all' ? materials.length : Number(count.max),
      materials.length,
    );
    for (const chosen of materialSets(materials, min, max)) {
      const input = {
        kind: 'viewAs',
        instance: source.instance,
        recipe: source.recipe,
        materials: chosen,
      };
      const spent = chosen.reduce((sum, id) => sum + cost(seat, id), 0);
      if ((!best || spent < best.spent) && inspect(input)?.valid) best = { input, spent };
    }
  }
  return best ? submit(best.input) : decline();
}
