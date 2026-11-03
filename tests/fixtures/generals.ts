import { standardGeneralSkills } from '../../src/content/standard/generals';
import { cardGame } from './cards';

/** 标准武将场景：目录装配全部标准武将技能，a 默认空手；技能需另行 grant。 */
export const generalGame = (options: Parameters<typeof cardGame>[0] = {}) =>
  cardGame({
    ...options,
    hands: { a: [], ...options.hands },
    skills: options.skills ?? standardGeneralSkills,
  });
