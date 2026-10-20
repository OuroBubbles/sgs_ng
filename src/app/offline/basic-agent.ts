import type { DecisionRequest } from '../../core/decisions/hub';
import type { AgentCard, AgentObservation } from './agent-observation';

export type AgentAnswer =
  | { readonly kind: 'submit'; readonly value: unknown }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'unsupported'; readonly reason: string };
export interface AgentPreview {
  readonly valid: boolean;
  readonly feedback: unknown;
}
type Inspect = (value: unknown) => AgentPreview | null;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const list = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
const submit = (value: unknown): AgentAnswer => ({ kind: 'submit', value });

/** 小型确定性启发式。只消费观察与当前请求，通过与人类相同的 preview/submit 取得合法性。
 * 不读 World、牌堆或其他席位的身份/手牌，不承担任意扩展技能的通用求解。
 */
export function decideBasic(
  observation: AgentObservation,
  request: DecisionRequest,
  inspect: Inspect,
): AgentAnswer {
  const data = object(request.data);
  const self = observation.players.find((player) => player.id === observation.actor)!;
  const ownCards = [...observation.hand, ...self.equipment, ...observation.pools];
  // 正值表示愿意攻击；未知身份只用自己的阵营与公开主公位置估计。
  const hostility = (id: string): number => {
    if (id === self.id) return -1;
    const target = observation.players.find((player) => player.id === id);
    if (!target?.alive) return 0;
    if (self.role === 'lord' || self.role === 'loyalist')
      return target.role === 'lord' || target.role === 'loyalist' ? -1 : 0.7;
    if (self.role === 'rebel')
      return target.role === 'lord' ? 1.3 : target.role === 'rebel' ? -1 : 0.25;
    return target.role === 'lord' && observation.players.filter((p) => p.alive).length > 2
      ? -0.2
      : 0.8;
  };
  const value = (card: AgentCard): number => {
    if (card.name === 'standard:peach') return 12;
    if (card.name === 'standard:jink') return 8;
    if (card.name === 'standard:nullification') return 7;
    if (card.name === 'standard:slash') return 5;
    return card.slot ? 4 + card.range / 4 : 4;
  };
  const cost = (id: string): number => {
    const card = ownCards.find((card) => card.id === id);
    return card ? value(card) + (self.equipment.some((item) => item.id === id) ? 3 : 0) : 0;
  };
  const decline = (): AgentAnswer =>
    request.optional
      ? { kind: 'cancel' }
      : { kind: 'unsupported', reason: `基础 AI 无法完成必选决策：${request.kind}` };
  switch (request.kind) {
    case 'seat-ready':
      return submit(true);
    case 'invoke':
      // 寒冰剑的替代伤害不是必然有利；基础策略优先保留伤害。
      return submit(data.skill !== 'standard:ice_sword-ability');
    case 'arrange': {
      const initial = object(data.initial);
      const groups = Array.isArray(initial.groups)
        ? initial.groups.map(object).map((g) => ({ id: String(g.id), items: [...list(g.items)] }))
        : [];
      if (data.reason === 'standard:guanxing') {
        const top = groups.find((g) => g.id === 'top');
        if (top) top.items.sort((a, b) => cost(b) - cost(a));
      }
      const choice = { groups };
      return inspect(choice)?.valid ? submit(choice) : decline();
    }
    case 'trigger-order': {
      const first = list(data.options).find((id) => inspect(id)?.valid);
      return first ? submit(first) : decline();
    }
    case 'choose-option': {
      const options = Array.isArray(data.options) ? data.options.map(object) : [];
      const first = options.find(
        (option) => typeof option.id === 'string' && inspect(option.id)?.valid,
      );
      return first ? submit(first.id) : decline();
    }
    case 'cards-targets': {
      if (data.reason === 'standard:liuli' || data.reason === 'workshop:relay') {
        const feedback = object(inspect({ cards: [], targets: [] })?.feedback);
        const previous = list(data.previousTargets);
        const cards = (Array.isArray(feedback.cards) ? feedback.cards.map(object) : [])
          .filter((item) => typeof item.id === 'string' && item.selectable === true)
          .map((item) => String(item.id))
          .sort((a, b) => cost(a) - cost(b));
        // 每次费用都重新问合法性；避免基础策略在多个流离角色间循环转移。
        for (const card of cards) {
          const preview = object(inspect({ cards: [card], targets: [] })?.feedback);
          const targets = (Array.isArray(preview.targets) ? preview.targets.map(object) : [])
            .filter(
              (item) =>
                typeof item.id === 'string' &&
                item.selectable === true &&
                !previous.includes(item.id) &&
                hostility(item.id) > 0,
            )
            .sort((a, b) => hostility(String(b.id)) - hostility(String(a.id)));
          for (const target of targets) {
            const choice = { cards: [card], targets: [String(target.id)] };
            if (inspect(choice)?.valid) return submit(choice);
          }
        }
        return decline();
      }
      if (data.reason === 'standard:zhiheng') {
        const feedback = object(inspect({ cards: [], targets: [] })?.feedback);
        const candidates = (Array.isArray(feedback.cards) ? feedback.cards.map(object) : [])
          .filter((item) => typeof item.id === 'string' && item.selectable === true)
          .map((item) => String(item.id))
          .sort((a, b) => cost(a) - cost(b));
        const cheap = candidates.filter((id) => cost(id) <= 4);
        const choice = { cards: cheap.length ? cheap : candidates.slice(0, 1), targets: [] };
        return inspect(choice)?.valid ? submit(choice) : decline();
      }
      if (data.reason === 'standard:rende') {
        const preview = object(inspect({ cards: [], targets: [] })?.feedback);
        const targets = (Array.isArray(preview.targets) ? preview.targets.map(object) : []).filter(
          (item) =>
            typeof item.id === 'string' && item.selectable === true && hostility(item.id) < 0,
        );
        const cards = (Array.isArray(preview.cards) ? preview.cards.map(object) : [])
          .filter((item) => typeof item.id === 'string' && item.selectable === true)
          .map((item) => String(item.id))
          .sort((a, b) => cost(a) - cost(b))
          .slice(0, 2);
        const choice = { cards, targets: targets.slice(0, 1).map((item) => String(item.id)) };
        return inspect(choice)?.valid ? submit(choice) : decline();
      }
      if (data.reason === 'standard:tuxi') {
        const empty = { cards: [], targets: [] };
        const feedback = object(inspect(empty)?.feedback);
        const choices = (Array.isArray(feedback.targets) ? feedback.targets.map(object) : [])
          .filter(
            (item) =>
              typeof item.id === 'string' && item.selectable === true && hostility(item.id) > 0,
          )
          .sort((a, b) => hostility(String(b.id)) - hostility(String(a.id)));
        const targets = choices.slice(0, 2).map((item) => String(item.id));
        const choice = { cards: [], targets };
        return targets.length && inspect(choice)?.valid ? submit(choice) : decline();
      }
      if (data.reason === 'standard:guicai') {
        const judgment = object(data.judgment);
        const good = (card: Record<string, unknown>): boolean | null => {
          switch (judgment.reason) {
            case 'standard:indulgence':
              return card.suit === 'heart';
            case 'standard:lightning':
              return !(card.suit === 'spade' && Number(card.rank) >= 2 && Number(card.rank) <= 9);
            case 'standard:eight_diagram':
              return (
                card.color === 'red' ||
                (card.color === undefined && ['heart', 'diamond'].includes(String(card.suit)))
              );
            case 'standard:luoshen':
              return (
                card.color === 'black' ||
                (card.color === undefined && ['spade', 'club'].includes(String(card.suit)))
              );
            default:
              return null;
          }
        };
        const wanted = hostility(String(judgment.player)) < 0;
        const current = good(object(judgment.card));
        if (current === null || current === wanted) return decline();
        const candidates = observation.hand.slice().sort((a, b) => cost(a.id) - cost(b.id));
        const selected = candidates.find(
          (card) =>
            good(
              Array.isArray(judgment.alternatives)
                ? object(
                    judgment.alternatives.find((value: unknown) => object(value).id === card.id),
                  )
                : { suit: card.suit, rank: card.rank, color: card.color },
            ) === wanted && inspect({ cards: [card.id], targets: [] })?.valid,
        );
        return selected ? submit({ cards: [selected.id], targets: [] }) : decline();
      }
      const selection: { cards: string[]; targets: string[] } = { cards: [], targets: [] };
      // 每一步跟随可完成性反馈。强制弃牌保留桃/闪；暗选只能使用不透明选项。
      for (let step = 0; step < 128; step++) {
        const preview = inspect(selection);
        if (preview?.valid) return submit(selection);
        const feedback = object(preview?.feedback);
        let added = false;
        for (const key of ['cards', 'targets'] as const) {
          const candidates = Array.isArray(feedback[key]) ? feedback[key].map(object) : [];
          const choices = candidates
            .filter(
              (item) =>
                typeof item.id === 'string' &&
                item.selectable === true &&
                !selection[key].includes(item.id),
            )
            .sort((a, b) =>
              key === 'cards'
                ? cost(String(a.id)) - cost(String(b.id))
                : ['standard:jieyin', 'standard:yiji', 'standard:qingnang'].includes(
                      String(data.reason),
                    )
                  ? hostility(String(a.id)) - hostility(String(b.id))
                  : hostility(String(b.id)) - hostility(String(a.id)),
            );
          if (choices[0]) {
            selection[key].push(String(choices[0].id));
            added = true;
            break;
          }
        }
        if (!added) break;
      }
      return decline();
    }
    case 'card-response':
    case 'use-card':
    case 'play-action':
      break;
    default:
      return decline();
  }
  const play = request.kind === 'play-action';
  if (!play) {
    const beneficiary =
      typeof data.beneficiary === 'string' ? data.beneficiary : list(data.targets)[0];
    if (
      (data.timing === 'rescue' || request.kind === 'card-response') &&
      beneficiary &&
      hostility(beneficiary) > 0
    )
      return decline();
    if (data.timing === 'counter') {
      const counter = object(data.counter);
      const ally = hostility(String(counter.target)) < 0;
      const helpful = [
        'standard:peach',
        'standard:ex_nihilo',
        'standard:god_salvation',
        'standard:amazing_grace',
      ].includes(String(counter.card));
      const opposeRoot = ally !== helpful;
      // 深一层无懈会反转上层；只依据公开根效果与反制深度，不解析提示文字。
      if (typeof counter.depth !== 'number' || opposeRoot !== (counter.depth % 2 === 0))
        return decline();
    }
    if (data.timing === 'effect' && beneficiary && hostility(beneficiary) < 0) return decline();
  }
  const score = (
    name: string,
    materials: readonly string[],
    targets: readonly string[],
  ): number => {
    const expense = materials.reduce((sum, id) => sum + cost(id), 0);
    if (!play) return 100 - expense;
    if (name === 'standard:lightning') return -100;
    if (name === 'standard:peach') return 80 - expense;
    if (name === 'standard:ex_nihilo') return 65 - expense;
    if (name === 'workshop:ward') return self.shield < 2 ? 45 - expense : -1;
    if (name === 'workshop:bind')
      return (
        targets.reduce((sum, id) => {
          const player = observation.players.find((player) => player.id === id)!;
          return sum + hostility(id) * (player.chained ? -18 : 18);
        }, 0) - expense
      );
    if (name === 'workshop:ember') {
      const target = observation.players.find((player) => player.id === targets[0]);
      const affected = target?.chained
        ? observation.players.filter((player) => player.alive && player.chained)
        : target
          ? [target]
          : [];
      if (affected.some((player) => player.id === self.id && player.hp <= 1 && player.shield === 0))
        return -100;
      return (
        affected.reduce(
          (sum, player) => sum + hostility(player.id) * (30 + Math.max(0, 4 - player.hp) * 4),
          0,
        ) - expense
      );
    }
    if (name === 'standard:amazing_grace') return 12 - expense;
    if (name === 'standard:god_salvation')
      return (
        targets.reduce((sum, id) => {
          const player = observation.players.find((player) => player.id === id)!;
          return sum - hostility(id) * Math.min(1, player.maxHp - player.hp) * 20;
        }, 0) - expense
      );
    const physical = ownCards.find((card) => materials.length === 1 && card.id === materials[0]);
    if (physical?.slot && physical.name === name) {
      const old = self.equipment.find((card) => card.slot === physical.slot);
      // 替换必须确有收益，防止新旧装备在手牌与装备区之间反复交换。
      return old ? (value(physical) - value(old)) * 5 - 1 : 25 - expense;
    }
    if (name === 'standard:analeptic')
      return observation.hand.some((card) => card.name === 'standard:slash') ? 8 - expense : -1;
    return (
      targets.reduce((sum, id) => {
        const target = observation.players.find((player) => player.id === id)!;
        return sum + hostility(id) * (30 + Math.max(0, 4 - target.hp) * 4);
      }, 0) - expense
    );
  };
  const activeScore = (skill: unknown): number => {
    switch (skill) {
      case 'standard:lijian':
        return ownCards.some((card) => cost(card.id) <= 5) &&
          observation.players.filter(
            (player) =>
              player.alive && player.id !== self.id && ['male', 'dual'].includes(player.gender),
          ).length >= 2
          ? 16
          : -1;
      case 'standard:fanjian':
        return observation.hand.some((card) => cost(card.id) <= 5) &&
          observation.players.some((player) => player.alive && hostility(player.id) > 0)
          ? 12
          : -1;
      case 'standard:zhiheng':
        return observation.hand.some((card) => cost(card.id) <= 4) ? 14 : -1;
      case 'standard:kurou':
        return self.hp > 2 && observation.hand.length < 6 ? 15 : -1;
      case 'standard:jieyin':
        return self.hp < self.maxHp &&
          observation.players.some(
            (player) =>
              player.alive &&
              player.id !== self.id &&
              player.hp < player.maxHp &&
              ['male', 'dual'].includes(player.gender) &&
              hostility(player.id) < 0,
          )
          ? 40
          : -1;
      case 'standard:qingnang':
        return observation.players.some(
          (player) => player.alive && player.hp < player.maxHp && hostility(player.id) < 0,
        )
          ? 42
          : -1;
      case 'standard:rende':
        return self.hp < self.maxHp &&
          observation.hand.length >= Math.max(2, self.hp + 1) &&
          observation.players.some(
            (player) => player.id !== self.id && player.alive && hostility(player.id) < 0,
          )
          ? 18
          : -1;
      default:
        return -1;
    }
  };
  let best: { value: unknown; score: number } | null = null;
  for (const raw of Array.isArray(data.offers) ? data.offers : []) {
    const offer = object(raw);
    const source = object(offer.choice);
    if (offer.kind === 'active') {
      const input = { skill: source.instance, action: source.action };
      const rating = activeScore(offer.skill);
      if (play && rating > 0 && inspect(input)?.valid && (!best || rating > best.score))
        best = { value: input, score: rating };
      continue;
    }
    const count = object(offer.count);
    const materials = list(offer.materials)
      .slice()
      .sort((a, b) => cost(a) - cost(b));
    const min = typeof count.min === 'number' ? count.min : 0;
    const max = Math.min(
      count.max === 'all' ? materials.length : Number(count.max),
      materials.length,
    );
    const sets =
      offer.kind === 'physical' ? [[String(source.card)]] : combinations(materials, min, max);
    for (const chosen of sets) {
      const choice =
        offer.kind === 'physical'
          ? { kind: 'physical', card: source.card }
          : { kind: 'viewAs', instance: source.instance, recipe: source.recipe, materials: chosen };
      const visit = (targets: readonly string[]): void => {
        const input = play ? { choice, targets } : choice;
        const preview = inspect(input);
        const feedback = object(preview?.feedback);
        if (preview?.valid) {
          const targetsUsed = play
            ? list(feedback.fixedTargets).length
              ? list(feedback.fixedTargets)
              : targets
            : list(data.targets);
          const rating = score(list(offer.names)[0] ?? '', chosen, targetsUsed);
          if (!best || rating > best.score) best = { value: input, score: rating };
        }
        if (!play || targets.length >= 3) return;
        const options = Array.isArray(feedback.targets) ? feedback.targets.map(object) : [];
        for (const target of options) {
          if (
            typeof target.id === 'string' &&
            target.selectable === true &&
            !targets.includes(target.id)
          )
            visit([...targets, target.id]);
        }
      };
      visit([]);
    }
  }
  return best && best.score > 0 ? submit(best.value) : decline();
}

/** 基础内容只有一/两材料转换；限制枚举，避免把普通决策变成无界搜索。 */
function combinations(cards: readonly string[], min: number, max: number): readonly string[][] {
  const result: string[][] = [];
  const visit = (start: number, chosen: string[]): void => {
    if (result.length >= 64) return;
    if (chosen.length >= min) result.push(chosen);
    if (chosen.length >= Math.min(max, 4)) return;
    for (let i = start; i < cards.length && result.length < 64; i++)
      visit(i + 1, [...chosen, cards[i]!]);
  };
  visit(0, []);
  return result;
}
