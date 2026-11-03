import type { CardPresentation } from '../catalog';

const files = import.meta.glob<string>('../../assets/freekill/audio/{card,skill,death}/**/*.mp3', {
  eager: true,
  import: 'default',
  query: '?url',
});
const icons = import.meta.glob<string>('../../assets/freekill/{icons,marks}/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
});
const pictures = import.meta.glob<string>('../../assets/freekill/cards/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
});
const root = '../../assets/freekill/';

export function standardSkillVoices(id: string): readonly string[] {
  const name = id.slice('standard:'.length);
  return Object.entries(files)
    .filter(([path]) => new RegExp('/skill/' + name + '\\d+\\.mp3$').test(path))
    .map(([, url]) => url);
}

export function standardDeathVoice(id: string): string | undefined {
  return files[root + 'audio/death/' + id.slice('standard:'.length) + '.mp3'];
}

/** 普通资源声明；图标与语音不参与牌的合法性或结算。 */
export function standardCardMedia(id: string): Pick<CardPresentation, 'icon' | 'image' | 'voices'> {
  const name = id.slice('standard:'.length);
  const horse = ['chitu', 'dayuan', 'zixing', 'jueying', 'dilu', 'zhuahuangfeidian'].includes(name);
  const icon =
    icons[root + 'icons/' + (horse ? 'horse' : name) + '.png'] ??
    icons[root + 'marks/' + name + '.png'];
  const equipment = horse
    ? 'horse'
    : ['eight_diagram', 'nioh_shield'].includes(name)
      ? 'armor'
      : icon && !icons[root + 'marks/' + name + '.png']
        ? 'weapon'
        : null;
  const voices = Object.fromEntries(
    ['male', 'female'].flatMap((gender) => {
      const url =
        files[root + 'audio/card/' + gender + '/' + name + '.mp3'] ??
        (equipment ? files[root + 'audio/card/common/' + equipment + '.mp3'] : undefined);
      return url ? [[gender, url]] : [];
    }),
  );
  const image = pictures[root + 'cards/' + name + '.png'];
  return {
    ...(icon ? { icon } : {}),
    ...(image ? { image } : {}),
    ...(Object.keys(voices).length ? { voices } : {}),
  };
}
