import type { CardPresentation, GeneralPresentation } from '../catalog';
import { standardGenerals } from './generals';
import assets from './assets.json';

/**
 * 标准包媒体按原字节放在 public/standard，以稳定 URL 提供：宿主（Bun）、浏览器与 Tauri
 * 解析同一路径，无需构建期资源表。assets.json 是该目录的来源清单，也是存在性的唯一依据。
 */
const root = '/standard/';
const files = new Set([...assets.resources, ...assets.portraits].map((entry) => entry.file));
const url = (file: string) => (files.has(file) ? root + file : undefined);
const sorted = [...files].sort();

/** 普通资源声明；图标与语音不参与牌的合法性或结算。 */
export function standardCardMedia(id: string): Pick<CardPresentation, 'icon' | 'image' | 'voices'> {
  const name = id.slice('standard:'.length);
  const horse = ['chitu', 'dayuan', 'zixing', 'jueying', 'dilu', 'zhuahuangfeidian'].includes(name);
  const mark = url('marks/' + name + '.png');
  const icon = url('icons/' + (horse ? 'horse' : name) + '.png') ?? mark;
  const equipment = horse
    ? 'horse'
    : ['eight_diagram', 'nioh_shield'].includes(name)
      ? 'armor'
      : icon && !mark
        ? 'weapon'
        : null;
  const voices = Object.fromEntries(
    ['male', 'female'].flatMap((gender) => {
      const voice =
        url('audio/card/' + gender + '/' + name + '.mp3') ??
        (equipment ? url('audio/card/common/' + equipment + '.mp3') : undefined);
      return voice ? [[gender, voice]] : [];
    }),
  );
  const image = url('cards/' + name + '.png');
  return {
    ...(icon ? { icon } : {}),
    ...(image ? { image } : {}),
    ...(Object.keys(voices).length ? { voices } : {}),
  };
}

function skillVoices(id: string): readonly string[] {
  const pattern = new RegExp('^audio/skill/' + id.slice('standard:'.length) + '\\d+\\.mp3$');
  return sorted.filter((file) => pattern.test(file)).map((file) => root + file);
}

export const standardGeneralViews: readonly GeneralPresentation[] = [...assets.portraits]
  .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  .map(({ id, file }) => {
    const general = standardGenerals.find((general) => general.id === id);
    const deathVoice = url('audio/death/' + id.slice('standard:'.length) + '.mp3');
    return {
      id,
      portrait: root + file,
      ...(deathVoice ? { deathVoice } : {}),
      voices: Object.fromEntries(
        (general?.skills ?? []).flatMap((skill) => {
          const voices = skillVoices(skill);
          return voices.length ? [[skill, voices]] : [];
        }),
      ),
    };
  });
