import { expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createContent } from '../../src/sdk';
import standard from '../../src/content/standard';
import assets from '../../src/content/standard/assets.json';
import { createRoleMatch, defaultContent } from '../../src/host/content';
import { projectMatch } from '../../src/host/projection';
import { observeAgent } from '../../src/host/agent-observation';
import { rebuildWorld } from '../../src/core/history/rebuild';

const general = {
  id: 'portrait:guest',
  name: '来客',
  kingdom: '群',
  gender: 'male' as const,
  maxHp: 4,
  skills: [],
};
it('缺图允许轮廓，空路径、重复和未知武将展示在组合时诊断', () => {
  expect(createContent({ generals: [general] }).generalViews).toEqual({});
  const voiceOnly = createContent({
    generals: [general],
    generalViews: [{ id: general.id, deathVoice: 'guest.mp3', voices: { skill: ['skill.mp3'] } }],
  });
  expect(voiceOnly.generalViews[general.id]).not.toHaveProperty('portrait');
  expect(Object.isFrozen(voiceOnly.generalViews[general.id]!.voices!.skill)).toBe(true);
  expect(() =>
    createContent({ generals: [general], generalViews: [{ id: general.id, portrait: ' ' }] }),
  ).toThrow(/portrait URL/);
  const view = { id: general.id, portrait: 'guest.jpg' };
  expect(() => createContent({ generals: [general], generalViews: [view, view] })).toThrow(
    /Duplicate general presentation/,
  );
  expect(() => createContent({ generalViews: [view] })).toThrow(/unknown general/);
});

it('公开武将图随当前武将投影，身份和手牌权限不变，图像不进入 AI、状态或事实重建', async () => {
  const portrait = 'data:image/png;base64,only-presentation';
  const views = [{ id: general.id, portrait }];
  const content = createContent(standard, {
    generals: [general],
    generalViews: views,
  });
  views[0]!.portrait = 'changed';
  expect(Object.isFrozen(content.generalViews[general.id])).toBe(true);
  const match = createRoleMatch({
    seed: 1,
    preset: 'standard:identity',
    lineup: [general.id, 'standard:guanyu'],
    content,
  });
  expect(match.generals.definition(general.id)).not.toHaveProperty('portrait');
  await match.prepare();
  const view = projectMatch(match, '甲席', null);
  expect(view.players[0]).toMatchObject({ title: '来客', portrait });
  expect(view.players[1]?.portrait).toBe(content.generalViews['standard:guanyu']?.portrait);
  const observation = observeAgent(match, '甲席');
  expect(observation.players.every((player) => !('portrait' in player))).toBe(true);
  expect(observation.hand.map((card) => card.id)).toEqual(view.hand.map((card) => card.id));
  expect(observation.players.map((player) => player.role)).toEqual(
    view.players.map(
      (player) =>
        ({ 主公: 'lord', 忠臣: 'loyalist', 反贼: 'rebel', 内奸: 'renegade' })[player.role ?? ''] ??
        null,
    ),
  );
  expect(JSON.stringify(match.room.world.snapshot)).not.toContain(portrait);
  expect(JSON.stringify(match.room.history.facts())).not.toContain(portrait);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
});

it('二十五将立绘与目录一一对应，标准包媒体按清单原字节放在 public/standard', async () => {
  expect(Object.keys(defaultContent.generalViews).sort()).toEqual(
    defaultContent.generals.map((entry) => entry.id).sort(),
  );
  expect(assets.portraits).toHaveLength(25);
  for (const entry of assets.portraits)
    expect(defaultContent.generalViews[entry.id]?.portrait).toBe(`/standard/${entry.file}`);
  const listed = [...assets.resources, ...assets.portraits];
  for (const entry of listed) {
    const data = await readFile(`public/standard/${entry.file}`);
    expect(data.byteLength).toBe(entry.bytes);
    expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
  }
  const files = (await readdir('public/standard', { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative('public/standard', join(entry.parentPath, entry.name)).replaceAll('\\', '/'),
    );
  expect(files.sort()).toEqual([...listed.map((entry) => entry.file), 'SOURCE-LICENSE.txt'].sort());
});
