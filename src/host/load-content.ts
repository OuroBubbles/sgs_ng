import { createHash } from 'node:crypto';
import type {
  AuthoredCard,
  CardPresentation,
  ContentDefinition,
  GeneralPresentation,
  PackDefinition,
} from '../content/catalog';
import type { GeneralDefinition } from '../rules/characters/general';
import type { SkillDefinition } from '../rules/skills/skills';

/**
 * 内容树：内容根（`src/content`）与公开媒体根（`public`）下的文件，路径一律为正斜杠相对路径并已排序。
 * 主持端从磁盘读取（[content-tree](./content-tree.ts)）；加载器本身不碰文件系统。
 */
export interface ContentTree {
  /** 报错时显示的根路径，例如 `src/content`、`public`。 */
  readonly root: string;
  readonly mediaRoot: string;
  readonly files: readonly string[];
  readonly media: readonly string[];
  /** 文本内容，用于 contentHash。 */
  read(file: string): Promise<string>;
  /** 动态 import 一个内容模块，返回模块命名空间。 */
  load(file: string): Promise<unknown>;
}

export interface LoadedPack {
  /** 包 ID 即目录名，也是武将/牌/技能文件 ID 的前缀与媒体目录名。 */
  readonly id: string;
  readonly practice: boolean;
  readonly definition: ContentDefinition;
}

export interface LoadedContent {
  readonly packs: readonly LoadedPack[];
  /** 已启用包目录下全部源码的 SHA-256；握手与大厅目录携带，不强求客户端相同。 */
  readonly hash: string;
}

type General = GeneralDefinition & { readonly abilities?: readonly SkillDefinition[] };

const packName = /^[a-z][a-z0-9_-]*$/;
const portraitTypes = ['jpg', 'png', 'webp'];
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** 标准包固定先行（与 FreeKill 先装标包同理），其余按目录名排列。 */
const packOrder = (a: string, b: string) =>
  Number(b === 'standard') - Number(a === 'standard') || compare(a, b);
const localId = (id: string) => id.slice(id.indexOf(':') + 1);
const stemOf = (file: string) => file.slice(file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.trim() !== '';
const isSkill = (value: unknown): value is SkillDefinition =>
  record(value) && text(value.id) && text(value.name);
const cardTypes = ['basic', 'trick', 'equipment'];
const cardKinds = ['slash', 'peach', 'dodge', 'duel', 'draw', 'trick', 'equipment', 'other'];
const isCard = (value: unknown): value is AuthoredCard =>
  record(value) &&
  text(value.id) &&
  text(value.label) &&
  text(value.description) &&
  cardTypes.includes(value.type as string) &&
  (value.kind === undefined || cardKinds.includes(value.kind as string));
const isGeneral = (value: unknown): value is General =>
  record(value) &&
  text(value.id) &&
  text(value.name) &&
  text(value.kingdom) &&
  Number.isInteger(value.maxHp) &&
  (value.maxHp as number) > 0 &&
  Array.isArray(value.skills) &&
  value.skills.every(text) &&
  (value.abilities === undefined ||
    (Array.isArray(value.abilities) && value.abilities.every(isSkill)));

/**
 * 发现并装入内容包（类 FreeKill `packages/<包>/init.lua`）：内容根下每个含 `package.ts` 的目录即一个包
 * （目录名以 `.disabled` 结尾则跳过）；包内 `generals/*.ts`、`cards/*.ts` 与 `skills/*.ts` 的默认导出
 * 自动并入，不维护登记表。顺序确定：标准包先行，其余按目录名；武将按 `order` 后接文件名，牌与技能按文件名。
 * 定义不合约定时启动即报错并指出文件。
 */
export async function loadContent(tree: ContentTree): Promise<LoadedContent> {
  const where = (file: string) => `${tree.root}/${file}`;
  const fail = (file: string, message: string, cause?: unknown): never => {
    throw new Error(`Content ${where(file)}: ${message}`, cause === undefined ? {} : { cause });
  };
  const exported = async (file: string) => {
    let module: unknown;
    try {
      module = await tree.load(file);
    } catch (error) {
      fail(
        file,
        `failed to load (${error instanceof Error ? error.message : String(error)})`,
        error,
      );
    }
    if (!record(module) || !('default' in module)) fail(file, 'missing default export.');
    return (module as { default: unknown }).default;
  };
  const ids = tree.files
    .flatMap((file) => /^([^/]+)\/package\.ts$/.exec(file)?.[1] ?? [])
    .filter((id) => !id.endsWith('.disabled'))
    .sort(packOrder);
  const skillSource = new Map<string, { skill: SkillDefinition; file: string }>();
  const claimSkill = (skill: SkillDefinition, file: string) => {
    const known = skillSource.get(skill.id);
    if (known && known.skill !== skill)
      fail(file, `skill ${skill.id} is also defined in ${where(known.file)}.`);
    if (!known) skillSource.set(skill.id, { skill, file });
  };
  const packs: LoadedPack[] = [];
  for (const id of ids) {
    const descriptorFile = `${id}/package.ts`;
    if (!packName.test(id))
      fail(descriptorFile, 'pack directory name must match [a-z][a-z0-9_-]* (it prefixes IDs).');
    const mediaFiles = tree.media.flatMap((file) =>
      file.startsWith(id + '/') ? [file.slice(id.length + 1)] : [],
    );
    const mediaSet = new Set(mediaFiles);
    const media = (file: string) => (mediaSet.has(file) ? `/${id}/${file}` : undefined);
    const descriptor = await exported(descriptorFile);
    if (!record(descriptor))
      fail(descriptorFile, 'default export must be a pack definition object.');
    const { practice = false, order = [], ...definition } = descriptor as PackDefinition;
    for (const key of ['generals', 'cards', 'skills'])
      if (key in definition)
        fail(descriptorFile, `${key} are not listed here: each lives in its own ${key}/<name>.ts.`);
    const scan = (folder: string) =>
      tree.files.filter(
        (file) =>
          file.startsWith(`${id}/${folder}/`) &&
          !file.slice(id.length + folder.length + 2).includes('/') &&
          file.endsWith('.ts') &&
          !file.endsWith('.test.ts') &&
          !file.endsWith('.d.ts'),
      );
    const generalFiles = scan('generals');
    const stems = generalFiles.map(stemOf);
    const listed: unknown = order;
    if (!Array.isArray(listed) || !listed.every((stem) => typeof stem === 'string'))
      fail(descriptorFile, 'order must list general file names.');
    for (const [index, stem] of order.entries()) {
      if (!stems.includes(stem))
        fail(descriptorFile, `order lists "${stem}" but generals/${stem}.ts does not exist.`);
      if (order.indexOf(stem) !== index) fail(descriptorFile, `order lists "${stem}" twice.`);
    }
    const ordered = [...order, ...stems.filter((stem) => !order.includes(stem))];
    const owned = async <T extends { readonly id: string }>(
      file: string,
      check: (value: unknown) => value is T,
      shape: string,
    ) => {
      const value = await exported(file);
      if (!check(value)) return fail(file, `default export must be ${shape}.`);
      const expected = `${id}:${stemOf(file)}`;
      if (value.id !== expected)
        fail(file, `ID must be "${expected}" (file name inside pack "${id}"), got "${value.id}".`);
      return value;
    };
    // ID 即「包:文件名」，跨文件不会重名；只有被多处引用的技能对象需要核对是同一个。
    const generals: General[] = [];
    for (const stem of ordered) {
      const file = `${id}/generals/${stem}.ts`;
      const general = await owned(file, isGeneral, 'general(...)');
      for (const skill of general.abilities ?? []) claimSkill(skill, file);
      generals.push(general);
    }
    const skills: SkillDefinition[] = [];
    for (const file of scan('skills')) {
      const skill = await owned(file, isSkill, 'skill(...)');
      claimSkill(skill, file);
      skills.push(skill);
    }
    const cards: AuthoredCard[] = [];
    for (const file of scan('cards'))
      cards.push(await owned(file, isCard, 'card(...), equipment(...) or delayedCard(...)'));

    // 展示按约定从 public/<包>/ 取：武将 portraits/<名>.(jpg|png|webp)、audio/death/<名>.mp3、
    // audio/skill/<技能名><n>.mp3；牌 cards/<名>.png、icons/<名>.png（或 marks/<名>.png）、
    // audio/card/<male|female>/<名>.mp3，装备缺省时用 icons/<栏位>.png 与 audio/card/common/<栏位>.mp3
    // （两种坐骑栏位都记作 horse）。约定目录里没有对应武将或牌的文件多半是拼错，启动即报。
    const names = new Set(generals.map((general) => localId(general.id)));
    const cardNames = new Set(cards.map((card) => localId(card.id)));
    for (const file of mediaFiles) {
      if (
        (file.startsWith('portraits/') || file.startsWith('audio/death/')) &&
        !names.has(stemOf(file))
      )
        fail(`${id}/${file}`, `no general "${id}:${stemOf(file)}" in pack "${id}".`);
      if (file.startsWith('cards/') && !cardNames.has(stemOf(file)))
        fail(`${id}/${file}`, `no card "${id}:${stemOf(file)}" in pack "${id}".`);
    }
    const explicitCards = new Set((definition.cardViews ?? []).map((view) => view.id));
    const derivedCards = cards.flatMap((card): CardPresentation[] => {
      if (explicitCards.has(card.id)) return [];
      const name = localId(card.id);
      const slot = card.equipment?.slot.replace(/^(offensive|defensive)-horse$/, 'horse');
      const icon =
        media(`icons/${name}.png`) ??
        media(`marks/${name}.png`) ??
        (slot ? media(`icons/${slot}.png`) : undefined);
      const image = media(`cards/${name}.png`);
      const voices = Object.fromEntries(
        (['male', 'female'] as const).flatMap((gender) => {
          const voice =
            media(`audio/card/${gender}/${name}.mp3`) ??
            (slot ? media(`audio/card/common/${slot}.mp3`) : undefined);
          return voice ? [[gender, voice]] : [];
        }),
      );
      const view = {
        ...(card.kind ? { kind: card.kind } : {}),
        ...(icon ? { icon } : {}),
        ...(image ? { image } : {}),
        ...(Object.keys(voices).length ? { voices } : {}),
      };
      return Object.keys(view).length ? [{ id: card.id, ...view }] : [];
    });
    const explicit = new Set((definition.generalViews ?? []).map((view) => view.id));
    const derived = generals.flatMap((general): GeneralPresentation[] => {
      if (explicit.has(general.id)) return [];
      const name = localId(general.id);
      const portrait = portraitTypes
        .map((type) => media(`portraits/${name}.${type}`))
        .find(Boolean);
      const deathVoice = media(`audio/death/${name}.mp3`);
      const voices = Object.fromEntries(
        general.skills.flatMap((skill) => {
          const prefix = `audio/skill/${localId(skill)}`;
          const files = mediaFiles.filter(
            (file) => file.startsWith(prefix) && /^\d+\.mp3$/.test(file.slice(prefix.length)),
          );
          return files.length ? [[skill, files.map((file) => `/${id}/${file}`)]] : [];
        }),
      );
      if (!portrait && !deathVoice && !Object.keys(voices).length) return [];
      return [
        {
          id: general.id,
          ...(portrait ? { portrait } : {}),
          ...(deathVoice ? { deathVoice } : {}),
          voices,
        },
      ];
    });
    packs.push({
      id,
      practice: practice === true,
      definition: {
        ...definition,
        generals,
        cards,
        skills,
        generalViews: [...(definition.generalViews ?? []), ...derived],
        cardViews: [...(definition.cardViews ?? []), ...derivedCards],
      },
    });
  }
  const hash = createHash('sha256');
  for (const file of tree.files) {
    if (!ids.some((id) => file.startsWith(id + '/')) || file.endsWith('.test.ts')) continue;
    // 换行不随 Git 工作树设置变化。
    const content = Buffer.from((await tree.read(file)).replaceAll('\r\n', '\n'));
    hash.update(`${file}:${content.length}\0`);
    hash.update(content);
  }
  return { packs, hash: hash.digest('hex') };
}
