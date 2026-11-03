const frames = import.meta.glob<string>('../../assets/freekill/ui/frames/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
});
const pictures = import.meta.glob<string>('../../assets/freekill/{ui,cards}/**/*.{png,jpg}', {
  eager: true,
  import: 'default',
  query: '?url',
});

/** 路径只来自本地皮肤声明，不查询规则或参考项目目录。 */
export function skinImage(path: string): string {
  return pictures['../../assets/freekill/' + path] ?? '';
}

export function photoFrames(kind: 'playing' | 'selected' | 'selectable'): readonly string[] {
  return Object.entries(pictures)
    .filter(([path]) => path.includes('/ui/animation/' + kind + '/'))
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([, url]) => url);
}

const roles: Readonly<Record<string, string>> = {
  主公: 'lord',
  忠臣: 'loyalist',
  反贼: 'rebel',
  内奸: 'renegade',
};

export function roleImage(role: string | null, dead = false): string {
  return skinImage(`ui/${dead ? 'death' : 'role'}/${roles[role ?? ''] ?? 'unknown'}.png`);
}

export function suitImage(suit: string, color?: 'red' | 'black' | 'none'): string {
  const names: Readonly<Record<string, string>> = {
    '♠': 'spade',
    '♥': 'heart',
    '♣': 'club',
    '♦': 'diamond',
  };
  return skinImage(
    'cards/suit/' + (names[suit] ?? (color === 'none' ? 'nocolor' : color) ?? 'nocolor') + '.png',
  );
}

export function numberImage(rank: string, red: boolean): string {
  const number =
    ({ A: '1', J: '11', Q: '12', K: '13' } as Readonly<Record<string, string>>)[rank] ?? rank;
  return skinImage(`cards/number/${red ? 'red' : 'black'}/${number}.png`);
}

export function seatFrame(kingdom: string): string {
  const root = '../../assets/freekill/ui/frames/';
  const names: Readonly<Record<string, string>> = { 魏: 'wei', 蜀: 'shu', 吴: 'wu', 群: 'qun' };
  return frames[root + (names[kingdom] ?? kingdom) + '.png'] ?? frames[root + 'unknown.png']!;
}
