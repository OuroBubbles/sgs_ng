import type { AuthoredGeneral } from '../../../sdk';

/** 一武将一文件：新增文件即登记，技能随武将的 skills 自动装配。 */
const modules = import.meta.glob<AuthoredGeneral>('./*.ts', { eager: true, import: 'default' });

export const standardGenerals: readonly AuthoredGeneral[] = Object.entries(modules)
  .filter(([path]) => path !== './index.ts')
  .map(([, general]) => general);
export const standardGeneralSkills = standardGenerals.flatMap((general) => general.abilities);
