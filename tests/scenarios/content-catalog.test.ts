import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import {
  defineSkill,
  rulesOf,
  defineWindow,
  defineQuery,
  on,
  moveCards,
  loseHp,
  createContent,
  CardBook,
  SkillBook,
  GeneralBook,
  EffectBook,
} from '../../src/sdk';
import type {
  Card,
  CardDefinition,
  DeckDefinition,
  GeneralDefinition,
  SkillDefinition,
  SkillTrigger,
  SkillTriggerDefinition,
  SkillTriggerInput,
  SkillHandle,
  SkillModifier,
  Context,
  CardEffectInput,
  CardExecuteInput,
  UseTiming,
} from '../../src/sdk';
import {
  createOfflineMatch,
  defaultContent,
  practiceContent,
} from '../../src/app/offline/practice';
import { cardView } from '../../src/app/offline/projection';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { decideBasic } from '../../src/app/offline/basic-agent';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { nextRequest } from '../fixtures/room';
import { RoleMatch } from '../../src/app/offline/role-match';
import standard from '../../src/content/standard';
import { room } from '../fixtures/room';
import { luoyiAftereffect } from '../../src/content/standard/generals/xuchu';

it('目录索引和重复检查使用最终声明，不重新读取原对象的身份', async () => {
  const changing = <T extends object>(prefix: string, fields: T) => {
    let latest = '';
    let reads = 0;
    return {
      definition: Object.assign(
        new (class {
          get id() {
            return (latest = `${prefix}:${++reads}`);
          }
        })(),
        fields,
      ),
      latest: () => latest,
    };
  };
  const card = changing('card', { label: '牌', type: 'basic' as const });
  const cards = new CardBook([card.definition], new SkillBook());
  expect(card.latest()).toBe('card:1');
  expect(cards.definition(card.latest()).id).toBe(card.latest());

  const skill = changing('skill', { name: '技能' });
  const skills = new SkillBook([skill.definition]);
  expect(skills.definition(skill.latest()).id).toBe(skill.latest());

  for (const [kind, slot, fields] of [
    [
      'trigger',
      'triggers',
      {
        window: {},
        bind: () => {
          throw new Error('Must not execute.');
        },
      },
    ],
    ['view-as recipe', 'viewAs', { make: { name: 'card:1' } }],
    ['active action', 'active', { run() {} }],
  ] as const) {
    const entries = [changing('local', fields).definition, changing('local', fields).definition];
    expect(() => new SkillBook([{ id: 'duplicate', name: '重复', [slot]: entries }])).toThrow(
      `[duplicate] Duplicate ${kind} ID: local:1.`,
    );
  }

  const effect = changing('effect', {
    name: '效果',
    accepts: (value: unknown): value is null => value === null,
    create: () => ({}),
  });
  const effects = new EffectBook();
  effects.register([effect.definition]);
  expect(effect.latest()).toBe('effect:1');
  const registered = {
    id: effect.latest(),
    name: effect.definition.name,
    accepts: effect.definition.accepts,
    create: effect.definition.create,
  };
  const game = room();
  const initial = game.world.snapshot;
  effects.attach(game);
  await game.run('registered-effect', (ctx) =>
    effects.add(ctx, registered, { owner: 'a', data: null }),
  );
  expect(effects.instances(game.world)[0]?.type).toBe(registered.id);
  expect(rebuildWorld(initial, game.history.facts())).toEqual(game.world.snapshot);
  game.abort('done');

  let hpReads = 0;
  const general = {
    id: 'general',
    name: '武将',
    kingdom: '群',
    gender: 'none',
    skills: [],
    get maxHp() {
      return ++hpReads <= 2 ? 4 : 0;
    },
  } satisfies GeneralDefinition;
  const generals = new GeneralBook([general], skills);
  expect(generals.definition('general').maxHp).toBe(4);
  expect(hpReads).toBe(1);

  let skillReads = 0;
  const generalSkills = [skill.latest()];
  Object.defineProperty(generalSkills, '0', {
    get: () => (++skillReads === 1 ? skill.latest() : ''),
  });
  const classGeneral = changing('general', {
    name: '武将',
    kingdom: '群',
    gender: 'none' as const,
    maxHp: 4,
    skills: generalSkills,
  });
  const classGenerals = new GeneralBook([classGeneral.definition], skills);
  expect(classGenerals.definition('general:1').id).toBe(classGeneral.latest());
  expect(classGenerals.definition('general:1').skills).toEqual([skill.latest()]);
  expect(skillReads).toBe(1);

  const colliding = (id: string) => {
    let reads = 0;
    return {
      get id() {
        return reads++ === 0 ? 'same' : id;
      },
      name: '武将',
      kingdom: '群',
      gender: 'none' as const,
      skills: [],
      maxHp: 4,
    };
  };
  expect(() => new GeneralBook([colliding('one'), colliding('two')], new SkillBook())).toThrow(
    'Duplicate general',
  );

  const cardView = changing('card-view', { kind: 'other' as const, description: '牌面说明' });
  const generalView = changing('general-view', { portrait: 'guest.jpg' });
  let portraitReads = 0;
  Object.defineProperty(generalView.definition, 'portrait', {
    get: () => (++portraitReads === 1 ? 'guest.jpg' : ''),
  });
  const content = createContent({
    cards: [{ id: 'card-view:1', label: '牌', type: 'basic' }],
    generals: [
      { id: 'general-view:1', name: '客', kingdom: '群', gender: 'none', maxHp: 4, skills: [] },
    ],
    cardViews: [cardView.definition],
    generalViews: [generalView.definition],
  });
  expect(Object.keys(content.cardViews)).toEqual([cardView.latest()]);
  expect(content.cardViews['card-view:1']).toMatchObject({
    id: 'card-view:1',
    kind: 'other',
    description: '牌面说明',
  });
  expect(Object.keys(content.generalViews)).toEqual([generalView.latest()]);
  expect(content.generalViews['general-view:1']).toMatchObject({
    id: 'general-view:1',
    portrait: 'guest.jpg',
  });
  expect(portraitReads).toBe(1);
});

it('普通源码直接组合无命名空间的定义，保留时点身份、本局目录和真实技能结算', async () => {
  const window = defineWindow<{ player: string }>('plain.window');
  const catalog = createContent(
    {
      cards: [{ id: 'ink', label: '墨', type: 'basic' }],
      decks: [
        {
          id: 'play',
          label: '试局',
          create: () => [{ id: 'one', name: 'ink', suit: 'spade', rank: 1 }],
        },
      ],
    },
    {
      skills: [
        defineSkill({
          id: 'study',
          name: '研习',
          triggers: [
            on(window, {
              id: 'lose',
              when: (_ctx, { payload: event, self }) => event.player === self.owner,
              run: (ctx, { self }) =>
                loseHp(ctx, { player: self.owner, amount: 1, reason: self.skill }),
            }),
          ],
        }),
      ],
      generals: [
        { id: 'scholar', name: '学士', kingdom: '群', gender: 'male', maxHp: 4, skills: ['study'] },
      ],
    },
  );
  const first = catalog.createBooks();
  const second = catalog.createBooks();
  expect(first.book).not.toBe(second.book);
  expect(first.skills.definition('study').triggers[0]!.window).toBe(window);
  const match = new RoleMatch({
    id: 'plain',
    seed: 1,
    content: catalog,
    deck: 'play',
    players: [
      { id: 'a', general: 'scholar' },
      { id: 'b', general: 'scholar' },
    ],
  });
  match.room.inspect((ctx) => expect(rulesOf(ctx)).toBe(match.book));
  await match.prepare();
  const hp = match.room.world.player('a').hp;
  await match.room.run('plain', (ctx) => ctx.window(window, { player: 'a' }));
  expect(match.room.world.player('a').hp).toBe(hp - 1);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('done');
});

it('内置源码显式组合标准与演武牌、武将和牌组，不自动发现目录', () => {
  // 独立效果可经普通定义组合；技能工厂不能再偷偷重复登记它。
  const content = createContent({ ...standard, effects: [] }, { effects: [luoyiAftereffect] });
  const first = content.createBooks();
  const second = content.createBooks();
  expect(first.skills.definition('standard:luoyi').name).toBe('裸衣');
  expect(second.book.effects).not.toBe(first.book.effects);
  for (const { book } of [first, second])
    expect(() => book.effects.register([luoyiAftereffect])).toThrow(/Duplicate effect/);
  expect(defaultContent.cards).toHaveLength(32);
  expect(defaultContent.generals).toHaveLength(25);
  expect(defaultContent.createDeck('standard:identity')).toHaveLength(108);
  expect(defaultContent.createDeck('standard:mechanics')).toHaveLength(288);
  expect(() => defaultContent.createDeck('workshop:showcase')).toThrow(/Unknown deck/);
  expect(practiceContent.cards).toHaveLength(37);
  expect(practiceContent.generals).toHaveLength(30);
  for (const [id, count] of [
    ['faces', 40],
    ['showcase', 44],
    ['relics', 40],
    ['chains', 48],
    ['defense', 48],
  ] as const)
    expect(practiceContent.createDeck('workshop:' + id)).toHaveLength(count);
});

it('声明列表在组合时固定，每局目录独立且技能经 rulesOf 读取本局目录', () => {
  const plain = { id: 'plain', name: '普通技能' };
  const skills: SkillDefinition[] = [plain];
  const content = createContent({ skills });
  skills.length = 0;
  plain.name = '后续修改';
  const one = content.createBooks();
  const two = content.createBooks();
  expect(one.skills.definition('plain').name).toBe('普通技能');
  expect(one.skills.definition('plain').triggers).toEqual([]);
  expect(two.book).not.toBe(one.book);
  expect(two.skills).not.toBe(one.skills);
});

it('组合拒绝重复定义和失效引用，另一局已经创建的目录保持独立', () => {
  const card = { id: 'card', label: '牌', type: 'basic' as const };
  expect(() => createContent({ cards: [card] }, { cards: [card] })).toThrow(/Duplicate card/);
  const skill = defineSkill({ id: 'skill', name: '技' });
  const valid = createContent({ skills: [skill] }).createBooks();
  expect(() => createContent({ skills: [skill, { ...skill }] }).createBooks()).toThrow(/Duplicate/);
  expect(() =>
    createContent({
      generals: [
        { id: 'guest', name: '客', kingdom: '群', gender: 'none', maxHp: 4, skills: ['missing'] },
      ],
    }).createBooks(),
  ).toThrow(/Unknown skill/);
  expect(valid.skills.definition('skill')).toMatchObject({ id: 'skill', name: '技' });
  expect(() =>
    createContent({ cardViews: [{ id: 'missing', kind: 'other', description: '' }] }),
  ).toThrow(/unknown card/);
});

it('普通定义与预装配目录共用牌组和效果装配，单机入口无需预先组合目录', async () => {
  for (const content of [standard, createContent(standard)]) {
    const offline = createOfflineMatch({
      seed: 1,
      content,
      lineup: ['standard:guanyu', 'standard:caocao'],
    });
    expect(offline.deckName).toBe('标准＋EX（108 张）');
    expect(offline.initial.cards).toHaveLength(108);
    await offline.prepare();
    expect(rebuildWorld(offline.initial, offline.room.history.facts())).toEqual(
      offline.room.world.snapshot,
    );
    offline.room.abort('done');
    const match = new RoleMatch({
      id: 'content',
      seed: 1,
      players: [{ id: 'a' }, { id: 'b' }],
      deck: 'standard:identity',
      content,
    });
    await match.room.run('effect', (ctx) =>
      match.book.effects.add(ctx, luoyiAftereffect, {
        owner: 'a',
        data: { actor: 'a', turn: 'probe' },
      }),
    );
    expect(match.book.effects.instances(match.room.world, luoyiAftereffect)[0]?.data).toEqual({
      actor: 'a',
      turn: 'probe',
    });
    expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
      match.room.world.snapshot,
    );
    match.room.abort('done');
  }
});

it('组合固定卡牌和静态技能声明，后续修改原对象不改变新旧对局或牌堆引用', async () => {
  const window = defineWindow<null>('plain.snapshot');
  const power = defineQuery<null, number>('plain.power', (sum, value) => sum + value);
  const count = { min: 1, max: 1 };
  const timings: UseTiming['kind'][] = ['effect'];
  let useReads = 0;
  let canUseReads = 0;
  class Use {
    count = count;
    timings = timings;
    #amount = 1;

    get canUse() {
      canUseReads++;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- 故意返回原方法，验证声明入口绑定原接收者。
      return this.canUseCard;
    }

    canUseCard() {
      return this.#amount > 0 ? null : 'Unavailable.';
    }

    prepare() {
      return { ok: true as const, value: this.#amount };
    }

    target() {
      return this.#amount > 0;
    }

    canResolve() {
      return this.#amount > 0;
    }

    execute(ctx: Context, { resolveTargets }: CardExecuteInput) {
      expect(this.#amount).toBe(1);
      return resolveTargets(ctx);
    }

    resolve(ctx: Context, { effect }: CardEffectInput) {
      return loseHp(ctx, { player: effect.target, amount: this.#amount, reason: 'ink' });
    }
  }
  const originalUse = new Use();
  const originalCard = {
    id: 'ink',
    label: '墨',
    type: 'basic',
    get use() {
      useReads++;
      return originalUse;
    },
  } satisfies CardDefinition;
  class TriggerDefinition implements SkillTriggerDefinition<null> {
    id = 'lose';
    #amount = 1;

    times() {
      return this.#amount;
    }

    when() {
      return this.#amount > 0;
    }

    run(ctx: Context, { self }: SkillTriggerInput<null>) {
      return loseHp(ctx, { player: self.owner, amount: this.#amount, reason: self.skill });
    }
  }
  const originalTrigger = new TriggerDefinition();
  class BoundTrigger implements SkillTrigger {
    id = 'lose';
    window = window;
    #effect = on(window, originalTrigger);

    bind(self: SkillHandle) {
      return this.#effect.bind(self);
    }
  }
  class Modifier implements SkillModifier {
    query = power;
    #bonus = 2;

    contribution() {
      return this.#bonus;
    }
  }
  const originalEffect = new BoundTrigger();
  const originalModifier = new Modifier();
  class Skill implements SkillDefinition {
    #id = 'study';
    get id() {
      return this.#id;
    }
    set id(value: string) {
      this.#id = value;
    }
    get name() {
      return '研习';
    }
    get description() {
      return '原型上的技能元数据';
    }
    get lord() {
      return false;
    }
    triggers = [originalEffect];
    modifiers = [originalModifier];
  }
  const originalSkill = new Skill();
  class General implements GeneralDefinition {
    id = 'scholar';
    name = '学士';
    kingdom = '群';
    gender = 'male' as const;
    skills = ['study'];
    #maxHp = 4;

    get maxHp() {
      return this.#maxHp;
    }

    set maxHp(value: number) {
      this.#maxHp = value;
    }
  }
  const originalGeneral = new General();
  class Deck implements DeckDefinition {
    id = 'play';
    label = '试局';
    #cards: Card[] = [{ id: 'one', name: 'ink', suit: 'spade', rank: 1 }];

    create(): readonly Card[] {
      return this.#cards;
    }
  }
  const originalDeck = new Deck();
  const content = createContent({
    cards: [originalCard],
    skills: [originalSkill],
    generals: [originalGeneral],
    decks: [originalDeck],
  });
  const first = content.createBooks();
  expect(useReads).toBe(1);
  expect(canUseReads).toBe(1);
  expect(first.skills.definition('study')).toMatchObject({
    id: 'study',
    name: '研习',
    description: '原型上的技能元数据',
    lord: false,
  });
  originalTrigger.times = () => 0;
  originalTrigger.when = () => false;
  originalTrigger.run = () => {
    throw new Error('Changed trigger callback must not run.');
  };
  originalCard.id = 'changed-card';
  originalCard.label = '改写';
  count.min = count.max = 2;
  timings[0] = 'play';
  originalUse.resolve = () => {
    throw new Error('Changed callback must not run.');
  };
  originalSkill.id = 'changed-skill';
  originalSkill.triggers.length = 0;
  originalSkill.modifiers.length = 0;
  originalGeneral.id = 'changed-general';
  originalGeneral.maxHp = 0;
  originalGeneral.skills.length = 0;
  originalEffect.id = 'changed-effect';
  originalEffect.window = defineWindow<null>('plain.changed');
  originalEffect.bind = () => {
    throw new Error('Changed trigger factory must not run.');
  };
  originalModifier.query = defineQuery<null, number>(
    'plain.changed-power',
    (sum, value) => sum + value,
  );
  originalModifier.contribution = () => {
    throw new Error('Changed modifier must not run.');
  };
  originalDeck.id = 'changed-deck';
  originalDeck.label = '改写';
  originalDeck.create = () => {
    throw new Error('Changed deck factory must not run.');
  };
  expect(content.decks).toEqual([{ id: 'play', label: '试局' }]);
  expect(Object.isFrozen(originalDeck)).toBe(false);
  expect(Object.isFrozen(originalGeneral)).toBe(false);
  expect(Object.isFrozen(originalEffect)).toBe(false);
  expect(Object.isFrozen(originalTrigger)).toBe(false);
  expect(Object.isFrozen(originalModifier)).toBe(false);

  const second = content.createBooks();
  expect(second.skills.definition('study')).toBe(first.skills.definition('study'));
  for (const { book, skills } of [first, second]) {
    expect(book.definition('ink')).toMatchObject({
      label: '墨',
      use: { count: { min: 1, max: 1 }, timings: ['effect'] },
    });
    expect(book.definition('ink')).toBe(content.cards[0]);
    expect(skills.definition('study').triggers[0]!.window).toBe(window);
    expect(skills.definition('study').modifiers![0]!.query).toBe(power);
  }
  const match = new RoleMatch({
    id: 'snapshot',
    seed: 1,
    content,
    deck: content.createDeck('play'),
    players: [
      { id: 'a', general: 'scholar' },
      { id: 'b', general: 'scholar' },
    ],
  });
  await match.prepare();
  await match.room.run('source-snapshot', async (ctx) => {
    await ctx.window(window, null);
    expect(match.skills.query(ctx, power, null, 0)).toBe(4);
    expect(
      await match.book.use(ctx, {
        actor: 'a',
        targets: ['b'],
        timing: { kind: 'effect' },
        choice: { kind: 'generated', face: { name: 'ink' }, materials: [], reason: 'snapshot' },
      }),
    ).toMatchObject({ kind: 'used' });
  });
  expect(match.room.world.player('a').hp).toBe(3);
  expect(match.room.world.player('b').hp).toBe(2);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('done');
});

it('实体牌按固定快照验证，重复实体与未知牌组明确失败', () => {
  const make = (name: string, duplicate = false) =>
    createContent({
      cards: [{ id: 'card', label: '牌', type: 'basic' }],
      decks: [
        {
          id: 'deck',
          label: '牌组',
          create: () => {
            const card = { id: 'one', name, suit: 'heart' as const, rank: 1 };
            return duplicate ? [card, card] : [card];
          },
        },
      ],
    });
  expect(() => make('missing').createDeck('deck')).toThrow(/Unknown card/);
  expect(() => make('card', true).createDeck('deck')).toThrow(/Duplicate physical card/);
  expect(() => make('card').createDeck('unknown')).toThrow(/Unknown deck/);

  let reads = 0;
  const physical = {
    id: 'physical',
    get name() {
      return ++reads === 1 ? 'card' : 'missing';
    },
    suit: 'heart' as const,
    rank: 1,
  };
  const match = new RoleMatch({
    id: 'snapshot',
    seed: 1,
    players: [{ id: 'a' }, { id: 'b' }],
    content: { cards: [{ id: 'card', label: '牌', type: 'basic' }] },
    deck: [physical],
  });
  expect(reads).toBe(1);
  expect(match.initial.cards[0]?.name).toBe('card');
  expect(Object.isFrozen(physical)).toBe(false);
  match.room.abort('done');
});

for (const branch of ['draw', 'recover'] as const) {
  it(`演武源码经实际目录完成闻策与整备 ${branch} 分支，使用普通选择并清理材料`, async () => {
    const match = createOfflineMatch({
      seed: 1,
      preset: 'workshop:showcase',
      lineup: ['workshop:guest', 'standard:guanyu'],
      content: practiceContent,
    });
    await match.prepare();
    const id = 'workshop-card-41';
    const view = cardView(match, id);
    expect(view).toMatchObject({ id, name: '整备', kind: 'trick' });
    expect(view.description).toContain('回复 1 点体力');
    expect(
      match.room.world.snapshot.skills
        .filter((skill) => skill.owner === '甲席')
        .map((skill) => skill.skill)
        .sort(),
    ).toEqual(['standard:wusheng', 'workshop:hearing']);
    await match.room.run('fixture', async (ctx) => {
      await moveCards(
        ctx,
        [{ cards: [id], from: ctx.world.position(id), to: '甲席:hand', place: 'bottom' }],
        'fixture',
      );
      if (branch === 'recover') await loseHp(ctx, { player: '甲席', amount: 1, reason: 'fixture' });
    });
    const before = match.room.world.zone('甲席:hand').cards.length;
    const hp = match.room.world.player('甲席').hp;
    const running = match.room.run('test-use', (ctx) =>
      match.book.use(ctx, {
        actor: '甲席',
        choice: { kind: 'physical', card: id },
        targets: ['甲席'],
        timing: { kind: 'effect' },
      }),
    );
    const trigger = await nextRequest(match.room);
    expect(trigger.prompt).toContain('闻策');
    expect(match.room.decisions.submit(trigger.id, trigger.token, true)).toEqual({
      kind: 'accepted',
    });
    const option = await nextRequest(match.room);
    expect(option.kind).toBe('choose-option');
    expect(
      decideBasic(observeAgent(match, '甲席'), option, (input) =>
        match.room.decisions.preview(option.id, input),
      ),
    ).toEqual({ kind: 'submit', value: 'draw' });
    if (branch === 'draw')
      expect(match.room.decisions.preview(option.id, 'recover')?.valid).toBe(false);
    expect(match.room.decisions.submit(option.id, option.token, branch)).toEqual({
      kind: 'accepted',
    });
    expect(await running).toMatchObject({
      kind: 'resolved',
      value: { kind: 'used' },
    });
    expect(match.room.world.zone('甲席:hand').cards).toHaveLength(
      before + (branch === 'draw' ? 2 : 0),
    );
    expect(match.room.world.player('甲席').hp).toBe(hp + (branch === 'recover' ? 1 : 0));
    expect(match.room.world.position(id)).toBe('discard');
    expect(match.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
    expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
      match.room.world.snapshot,
    );
  });
}

it('混合内容的闻策也能响应标准锦囊，工厂未捕获另一套规则目录', async () => {
  const match = createOfflineMatch({
    seed: 1,
    preset: 'workshop:showcase',
    lineup: ['workshop:guest', 'standard:guanyu'],
    content: practiceContent,
  });
  await match.prepare();
  const id = 'workshop-card-37';
  await match.room.run('fixture', (ctx) =>
    moveCards(
      ctx,
      [{ cards: [id], from: ctx.world.position(id), to: '甲席:hand', place: 'bottom' }],
      'fixture',
    ),
  );
  const running = match.room.run('use', (ctx) =>
    match.book.use(ctx, {
      actor: '甲席',
      choice: { kind: 'physical', card: id },
      targets: ['甲席'],
      timing: { kind: 'effect' },
    }),
  );
  const trigger = await nextRequest(match.room);
  expect(trigger.prompt).toContain('闻策');
  match.room.decisions.submit(trigger.id, trigger.token, false);
  expect(await running).toMatchObject({ kind: 'resolved' });
});

it('演武源码与基础 AI 共用标准动作/具名选项，真实完成整局，无必选卡死', async () => {
  const match = createOfflineMatch({
    seed: 42,
    preset: 'workshop:showcase',
    lineup: ['workshop:guest', 'standard:guanyu', 'workshop:guest', 'standard:zhaoyun'],
    content: practiceContent,
  });
  const running = match.start();
  let decisions = 0;
  try {
    while (!match.result && decisions < 1800) {
      await setImmediate();
      const request = match.room.decisions.pending[0];
      if (!request) {
        expect(match.room.status).not.toBe('faulted');
        continue;
      }
      const answer = decideBasic(observeAgent(match, request.player), request, (input) =>
        match.room.decisions.preview(request.id, input),
      );
      expect(answer.kind, request.prompt).not.toBe('unsupported');
      if (answer.kind === 'unsupported') break;
      const reply =
        answer.kind === 'cancel'
          ? match.room.decisions.cancel(request.id, request.token)
          : match.room.decisions.submit(request.id, request.token, answer.value);
      expect(reply, request.prompt).toEqual({ kind: 'accepted' });
      decisions++;
    }
    expect(match.result, `${decisions} decisions`).not.toBeNull();
    expect(await running).toMatchObject({ kind: 'resolved' });
  } finally {
    match.room.abort('test finished');
    await running;
  }
}, 60_000);
