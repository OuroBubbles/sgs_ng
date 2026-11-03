import type { GeneralPresentation } from '../catalog';
import { standardGenerals } from './generals';
import { standardDeathVoice, standardSkillVoices } from './media';

// Vite 为宿主输出有哈希的本地文件；作者模块构建则将同类 import 内联到单个模块。
const portraits = import.meta.glob<string>('./portraits/*.jpg', {
  eager: true,
  import: 'default',
  query: '?url',
});

export const standardGeneralViews: readonly GeneralPresentation[] = Object.entries(portraits).map(
  ([path, portrait]) => {
    const id = `standard:${path.slice('./portraits/'.length, -'.jpg'.length)}`;
    const general = standardGenerals.find((general) => general.id === id);
    const deathVoice = standardDeathVoice(id);
    return {
      id,
      portrait,
      ...(deathVoice ? { deathVoice } : {}),
      voices: Object.fromEntries(
        (general?.skills ?? []).flatMap((skill) => {
          const voices = standardSkillVoices(skill);
          return voices.length ? [[skill, voices]] : [];
        }),
      ),
    };
  },
);
