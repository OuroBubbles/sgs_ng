import { packs } from '../../src/host/content';

/** 主持端发现的标准包（与对局所用同一份定义），供场景测试按引用组合。 */
export const standard = packs.find((pack) => pack.id === 'standard')!.definition;
/** 标准武将按包内顺序（package.ts 的 order，新文件追加）。 */
export const standardGenerals = standard.generals!;
export const standardGeneralSkills = standardGenerals.flatMap((general) => general.abilities ?? []);
/** 标准牌定义（cards/*.ts，按文件名）。 */
export const standardCards = standard.cards!;
