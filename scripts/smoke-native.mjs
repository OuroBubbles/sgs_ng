import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { resourceBundleRecord } from './resource-bundle-proof.mjs';

const browser = await chromium.connectOverCDP(
  process.env.SGS_NATIVE_CDP ?? 'http://127.0.0.1:9223',
);
const page = browser
  .contexts()[0]
  ?.pages()
  .find((page) => page.url().includes('tauri.localhost'));
if (!page) throw new Error('没有找到 sgs_ng 的原生 WebView 页面。');
const errors = [];
const errorDetails = [];
const buildKind = process.env.SGS_NATIVE_BUILD ?? 'unspecified';
const verificationProfile = process.env.SGS_NATIVE_PROFILE;
if (!verificationProfile)
  throw new Error('Use verify-windows.ps1 with an isolated content profile.');
if (!['debug', 'release', 'unspecified'].includes(buildKind))
  throw new Error('Unknown native build kind.');
page.on('pageerror', (error) => {
  errors.push(error.message);
  errorDetails.push({ message: error.message, stack: error.stack, url: page.url() });
});
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const hand = page.getByTestId('hand-cards').locator('button');
const confirm = page.getByRole('button', { name: '确认当前选择', exact: true });
await mkdir('.artifacts/ui', { recursive: true });
async function contentReady() {
  await page.locator('[data-content-ready="true"]').waitFor();
}
async function cleanLobby() {
  await page.reload();
  await page.getByText('WebGL 战场已就绪').waitFor({ state: 'attached' });
  await contentReady();
  const clear = page.getByRole('button', { name: '清空已保存内容', exact: true });
  if (await clear.count()) {
    await clear.click();
    await clear.waitFor({ state: 'detached' });
    await contentReady();
  }
}
async function start(
  count,
  seed,
  preset = 'standard:mechanics',
  manual = true,
  general = 'standard:guanyu',
  aiGeneral = 'preset',
  packages = [],
) {
  await cleanLobby();
  assert.equal(
    await page.getByRole('combobox', { name: '牌组', exact: true }).inputValue(),
    'standard:identity',
  );
  for (const name of packages) {
    await page.getByRole('checkbox', { name, exact: true }).check();
    await contentReady();
  }
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption(String(count));
  await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption(preset);
  await page.getByRole('spinbutton').fill(String(seed));
  if (manual) await page.getByRole('checkbox', { name: '手动演练（内容调试）' }).check();
  else {
    await page.getByRole('combobox', { name: '你的武将', exact: true }).selectOption(general);
    await page.getByRole('combobox', { name: 'AI 武将', exact: true }).selectOption(aiGeneral);
  }
  await page.getByRole('button', { name: '开始单机对局' }).click();
}
async function discardCurrent(keepRed = false) {
  const prompt = await page.getByTestId('decision-hint').textContent();
  const amount = Number(prompt?.match(/弃置 (\d+)/)?.[1]);
  assert.ok(amount > 0);
  const cards = keepRed
    ? [
        ...(await page.getByTestId('hand-cards').locator('button:not(.red)').all()),
        ...(await page.getByTestId('hand-cards').locator('button.red').all()),
      ]
    : await hand.all();
  for (let i = 0; i < amount; i++) await cards[i].click();
  assert.ok(await confirm.isEnabled());
  await confirm.click();
}
async function passUntil(kind = 'cards-targets', prompt) {
  for (let step = 0; step < 64; step++) {
    if (await page.getByRole('dialog', { name: /请交给/ }).count()) {
      assert.equal(await hand.count(), 0);
      await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
      continue;
    }
    const current = await page.locator('[data-decision-kind]').getAttribute('data-decision-kind');
    if (
      current === kind &&
      (!prompt || (await page.getByTestId('decision-hint').textContent())?.includes(prompt))
    )
      return;
    if (current === 'use-card' || current === 'card-response') {
      await page.getByRole('button', { name: /放弃反制|放弃响应/ }).click();
      continue;
    }
    if (current) throw new Error(`Unexpected decision: ${current}, expected ${kind}`);
    await page.waitForFunction(
      () =>
        document.querySelector('.seat-curtain[open]') ||
        document.querySelector('[data-decision-kind]')?.getAttribute('data-decision-kind'),
    );
  }
  throw new Error('Judgment did not reach the skipped play phase.');
}

async function reachOwnSkill(wanted, installArmor = false, fromJournal = false) {
  let installed = false;
  for (let step = 0; step < (fromJournal ? 160 : 70); step++) {
    const reached = async () =>
      (await page.getByTestId(fromJournal ? 'journal' : 'decision-hint').textContent())?.includes(
        wanted,
      );
    if (await reached()) return;
    const kind = await page.locator('[data-decision-kind]').getAttribute('data-decision-kind');
    if (!kind) {
      await page.waitForFunction(
        (needle) =>
          document.querySelector('[data-decision-kind]')?.getAttribute('data-decision-kind') ||
          document.querySelector('[aria-label="对局结果"]') ||
          (needle &&
            document.querySelector('[data-testid="journal"]')?.textContent?.includes(needle)),
        fromJournal ? wanted : null,
      );
      if (await reached()) return;
      assert.equal(await page.getByRole('region', { name: '对局结果' }).count(), 0);
      continue;
    }
    const prompt = await page.getByTestId('decision-hint').textContent();
    if (prompt?.includes(wanted)) return;
    if (await page.getByRole('button', { name: wanted, exact: true }).count()) return;
    if (kind === 'play-action') {
      if (installArmor && !installed) {
        await hand
          .filter({ has: page.locator('.card-name', { hasText: '八卦阵' }) })
          .first()
          .click();
        await confirm.click();
        await page
          .getByTestId('equipment-甲席')
          .getByRole('button', { name: /^八卦阵 / })
          .waitFor();
        installed = true;
      } else await page.getByRole('button', { name: '结束出牌', exact: true }).click();
    } else if (kind === 'invoke')
      await page
        .getByRole('button', { name: prompt?.includes('八卦阵') ? '发动' : '不发动', exact: true })
        .click();
    else if (kind === 'cards-targets') {
      if (await page.locator('.decision-actions .cancel-button').isEnabled())
        await page.locator('.decision-actions .cancel-button').click();
      else await discardCurrent(wanted === '濒死');
    } else if (kind === 'card-response' || kind === 'use-card')
      await page.locator('.decision-actions .cancel-button').click();
    else throw new Error(`Unexpected decision before ${wanted}: ${kind}`);
  }
  throw new Error(`Skill not reached: ${wanted}`);
}

await start(4, 255);
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^丈八蛇矛 / })
  .click();
await confirm.click();
await page.getByRole('button', { name: '丈八蛇矛', exact: true }).waitFor();
assert.equal(await hand.count(), 5);
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^诸葛连弩 / })
  .first()
  .click();
await confirm.click();
await page
  .getByTestId('equipment-甲席')
  .getByRole('button', { name: /^诸葛连弩 / })
  .waitFor();
assert.equal(await page.getByRole('button', { name: '丈八蛇矛', exact: true }).count(), 0);
assert.equal(await hand.count(), 4);
assert.ok((await page.getByTestId('journal').textContent()).includes('替换【丈八蛇矛】'));
const surface = await page.getByTestId('battle-canvas').boundingBox();
const ownSeat = await page.locator('.target-hitbox.self').boundingBox();
const handArea = await page.getByTestId('hand-cards').boundingBox();
const decisionArea = await page.locator('.decision-bar').boundingBox();
assert.ok(ownSeat.x > surface.x + surface.width * 0.7);
assert.ok(ownSeat.y + ownSeat.height / 2 > surface.y + surface.height * 0.65);
assert.ok(handArea.x + handArea.width < ownSeat.x);
assert.ok(decisionArea.y + decisionArea.height < handArea.y);
await page.screenshot({
  path: `.artifacts/ui/native-reference-layout-${buildKind}.png`,
  fullPage: true,
});
await page.getByRole('button', { name: '结算记录', exact: true }).click();
const journal = page.getByRole('complementary', { name: '结算记录' });
await journal.waitFor();
assert.ok((await journal.boundingBox()).x < surface.width * 0.25);
await page.getByRole('button', { name: '关闭记录', exact: true }).click();
await page.screenshot({ path: `.artifacts/ui/native-equipment-${buildKind}.png`, fullPage: true });

await start(4, 70);
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^乐不思蜀 / })
  .first()
  .click();
await page.getByTestId('target-乙席').click();
await confirm.click();
await page
  .getByTestId('judgment-乙席')
  .getByRole('button', { name: /^乐不思蜀 / })
  .waitFor();
await page.getByRole('button', { name: '结束出牌', exact: true }).click();
await page.locator('[data-decision-kind="cards-targets"]').waitFor();
await discardCurrent();
await page.getByRole('dialog', { name: /请交给/ }).waitFor();
await passUntil();
const judgmentLog = await page.getByTestId('journal').textContent();
assert.ok(judgmentLog.includes('乙席的乐不思蜀结果：♦Q【大宛】'));
assert.ok(judgmentLog.includes('乙席跳过了出牌阶段'));
assert.equal(await page.getByTestId('judgment-乙席').count(), 0);
await page.screenshot({ path: `.artifacts/ui/native-judgment-${buildKind}.png`, fullPage: true });

await start(4, 366);
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^八卦阵 / })
  .first()
  .click();
await confirm.click();
await page.getByRole('button', { name: '结束出牌', exact: true }).click();
await page.locator('[data-decision-kind="cards-targets"]').waitFor();
await discardCurrent();
await page.getByRole('dialog', { name: /请交给/ }).waitFor();
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
await page.getByTestId('target-甲席').click();
await confirm.click();
await page.getByRole('dialog', { name: /请交给/ }).waitFor();
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
await page.locator('[data-decision-kind="invoke"]').waitFor();
assert.equal(await page.getByTestId('decision-hint').textContent(), '是否发动【八卦阵】进行判定？');
await page.getByRole('button', { name: '发动', exact: true }).click();
await passUntil('play-action');
assert.ok((await page.getByTestId('target-甲席').getAttribute('aria-label')).includes('体力4/4'));
assert.ok(
  (await page.getByTestId('journal').textContent()).includes('甲席的八卦阵结果：♦2【寒冰剑】'),
);
assert.ok((await page.getByTestId('journal').textContent()).includes('甲席使用【闪】'));
await page.screenshot({ path: `.artifacts/ui/native-armor-${buildKind}.png`, fullPage: true });

await start(4, 173);
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^诸葛连弩 / })
  .click();
await confirm.click();
await page.getByRole('button', { name: '结束出牌', exact: true }).click();
await page.locator('[data-decision-kind="cards-targets"]').waitFor();
await discardCurrent();
await page.getByRole('dialog', { name: /请交给/ }).waitFor();
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
const swordsBeforeCollateral = await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^诸葛连弩 / })
  .count();
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^借刀杀人 / })
  .first()
  .click();
await page.getByTestId('target-甲席').click();
await confirm.click();
await page.locator('[data-decision-kind="cards-targets"]').waitFor();
assert.equal(
  await page.getByTestId('decision-hint').textContent(),
  '借刀杀人：选择 甲席 使用杀的目标',
);
assert.ok(!(await page.getByTestId('journal').textContent()).includes('乙席使用【借刀杀人】'));
await page.getByTestId('target-乙席').click();
await confirm.click();
await passUntil('use-card', '借刀杀人：对');
await page.getByRole('button', { name: '放弃使用', exact: true }).click();
await passUntil('play-action');
assert.equal(await page.getByTestId('equipment-甲席').count(), 0);
assert.equal(
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^诸葛连弩 / })
    .count(),
  swordsBeforeCollateral + 1,
);
assert.ok(
  (await page.getByTestId('journal').textContent()).includes(
    '乙席因【借刀杀人】获得 甲席 的【诸葛连弩】',
  ),
);
await page.screenshot({ path: `.artifacts/ui/native-collateral-${buildKind}.png`, fullPage: true });

async function weaponAttack(seed, weapon, target) {
  await start(4, seed);
  await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: new RegExp(`^${weapon} `) })
    .first()
    .click();
  await confirm.click();
  await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
  await page.getByTestId(`target-${target}`).click();
  await confirm.click();
  await page.getByRole('dialog', { name: /请交给/ }).waitFor();
  await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
  await page.getByTestId('hand-cards').getByRole('button', { name: /^闪 / }).first().click();
  await confirm.click();
  await page.getByRole('dialog', { name: /请交给/ }).waitFor();
  await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
}

await weaponAttack(93, '贯石斧', '丁席');
assert.equal(
  await page.getByTestId('decision-hint').textContent(),
  '贯石斧：弃置两张其他牌，使此杀仍造成伤害',
);
assert.ok(await page.getByRole('button', { name: '不发动', exact: true }).isEnabled());
await hand.nth(0).click();
await hand.nth(1).click();
await confirm.click();
await passUntil('play-action');
assert.ok((await page.getByTestId('target-丁席').getAttribute('aria-label')).includes('体力3/4'));
assert.equal(await hand.count(), 2);
await page.screenshot({ path: `.artifacts/ui/native-axe-${buildKind}.png`, fullPage: true });

await weaponAttack(498, '青龙偃月刀', '甲席');
await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
await confirm.click();
await passUntil('play-action');
assert.ok((await page.getByTestId('target-甲席').getAttribute('aria-label')).includes('体力3/4'));
assert.ok((await page.getByTestId('journal').textContent()).includes('丁席通过【青龙偃月刀】追杀'));
await page.screenshot({ path: `.artifacts/ui/native-blade-${buildKind}.png`, fullPage: true });

await start(4, 14);
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
const otherWeapons = page
  .getByTestId('hand-cards')
  .locator('button:not([aria-label^="杀 "]):not([aria-label^="方天画戟 "])');
while (await otherWeapons.count()) {
  await otherWeapons.first().click();
  await confirm.click();
}
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^方天画戟 / })
  .click();
await confirm.click();
await hand.first().click();
for (const name of ['甲席', '丙席', '丁席']) await page.getByTestId(`target-${name}`).click();
assert.equal(await page.locator('.target-hitbox[aria-pressed="true"]').count(), 3);
await page.screenshot({ path: `.artifacts/ui/native-halberd-${buildKind}.png`, fullPage: true });
await confirm.click();
await passUntil('play-action');
for (const name of ['甲席', '丙席', '丁席'])
  assert.ok(
    (await page.getByTestId(`target-${name}`).getAttribute('aria-label')).includes('体力3/4'),
  );

await start(4, 120);
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^绝影 / })
  .click();
await confirm.click();
await page.getByRole('button', { name: '结束出牌', exact: true }).click();
await page.locator('[data-decision-kind="cards-targets"]').waitFor();
await discardCurrent();
await page.getByRole('dialog', { name: /请交给/ }).waitFor();
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^麒麟弓 / })
  .first()
  .click();
await confirm.click();
await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
await page.getByTestId('target-乙席').click();
await confirm.click();
await passUntil('cards-targets');
await page.locator('.choice-options').getByRole('button', { name: '绝影', exact: true }).click();
await confirm.click();
await passUntil('play-action');
assert.equal(await page.getByTestId('equipment-乙席').count(), 0);
assert.ok((await page.getByTestId('target-乙席').getAttribute('aria-label')).includes('体力3/4'));
await page.screenshot({ path: `.artifacts/ui/native-bow-${buildKind}.png`, fullPage: true });

await start(4, 3);
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
assert.ok((await page.getByTestId('target-乙席').getAttribute('aria-label')).includes('性别女'));
assert.ok((await page.getByTestId('target-丙席').getAttribute('aria-label')).includes('性别男'));
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^雌雄双股剑 / })
  .first()
  .click();
await confirm.click();
await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
await page.getByTestId('target-丙席').click();
await confirm.click();
assert.equal(
  await page.getByTestId('decision-hint').textContent(),
  '是否对 丙席 发动【雌雄双股剑】？',
);
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.getByRole('dialog', { name: /请交给/ }).waitFor();
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
assert.ok(
  (await page.getByTestId('decision-hint').textContent()).includes('雌雄双股剑：弃置一张手牌'),
);
assert.ok(await page.getByRole('button', { name: '令对方摸牌', exact: true }).isEnabled());
await hand.first().click();
await confirm.click();
await passUntil('play-action');
assert.ok(
  (await page.getByTestId('target-丙席').getAttribute('aria-label')).includes('体力3/4，手牌3'),
);
assert.equal(await hand.count(), 4);
await page.screenshot({
  path: `.artifacts/ui/native-double-swords-${buildKind}.png`,
  fullPage: true,
});

await start(4, 36);
await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
await page
  .getByTestId('hand-cards')
  .getByRole('button', { name: /^寒冰剑 / })
  .first()
  .click();
await confirm.click();
await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
await page.getByTestId('target-丁席').click();
await confirm.click();
await passUntil('invoke');
assert.ok((await page.getByTestId('decision-hint').textContent()).includes('是否发动【寒冰剑】'));
await page.getByRole('button', { name: '发动', exact: true }).click();
for (let ordinal = 1; ordinal <= 2; ordinal++) {
  assert.equal(
    await page.getByTestId('decision-hint').textContent(),
    `寒冰剑：弃置 丁席 的第 ${ordinal} 张牌`,
  );
  const options = page.locator('.choice-options button');
  assert.equal(await options.count(), 5 - ordinal);
  for (const option of await options.all()) assert.match(await option.textContent(), /未知手牌/);
  await options.first().click();
  await confirm.click();
}
await passUntil('play-action');
assert.ok(
  (await page.getByTestId('target-丁席').getAttribute('aria-label')).includes('体力4/4，手牌2'),
);
assert.ok(
  (await page.getByTestId('journal').textContent()).includes(
    '丙席发动【寒冰剑】防止对 丁席 的伤害',
  ),
);
await page.screenshot({ path: `.artifacts/ui/native-ice-sword-${buildKind}.png`, fullPage: true });

// 正式选将与零材料主动动作；费用和摸牌仍来自规则结算。
await start(2, 42, 'standard:identity', false, 'standard:huanggai');
await page.locator('[data-decision-kind="play-action"]').waitFor();
assert.match(
  await page.getByTestId('target-甲席').getAttribute('aria-label'),
  /甲席·黄盖.*体力4\/4/,
);
const beforeKurou = await hand.count();
await page.getByRole('button', { name: '苦肉', exact: true }).click();
assert.ok(await confirm.isEnabled());
await confirm.click();
await page.waitForFunction(() =>
  document
    .querySelector('[data-testid="target-甲席"]')
    ?.getAttribute('aria-label')
    ?.includes('体力3/4'),
);
assert.equal(await hand.count(), beforeKurou + 2);
await page.screenshot({ path: `.artifacts/ui/native-kurou-${buildKind}.png`, fullPage: true });

await start(2, 42, 'standard:identity', false, 'standard:zhaoyun');
await page.locator('[data-decision-kind="play-action"]').waitFor();
await page.getByRole('button', { name: '龙胆 · 杀', exact: true }).click();
await hand.filter({ has: page.locator('.card-name', { hasText: '闪' }) }).click();
await page.getByTestId('target-乙席').click();
assert.ok(await confirm.isEnabled());
await confirm.click();
await page.waitForFunction(() =>
  document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席使用【杀】'),
);
await page.locator('[data-decision-kind="play-action"]').waitFor();
assert.equal(await hand.filter({ has: page.locator('.card-name', { hasText: '闪' }) }).count(), 0);
await page.getByRole('button', { name: '查看武将技能说明', exact: true }).click();
await page.getByRole('dialog', { name: '赵云 · 技能' }).waitFor();
assert.ok((await page.getByRole('dialog', { name: '赵云 · 技能' }).textContent()).includes('龙胆'));
await page.screenshot({ path: `.artifacts/ui/native-longdan-${buildKind}.png`, fullPage: true });
await page.getByRole('button', { name: '关闭技能说明', exact: true }).click();

await start(2, 42, 'standard:identity', false, 'standard:xuchu');
await page.locator('[data-decision-kind="invoke"]').waitFor();
assert.ok((await page.getByTestId('decision-hint').textContent()).includes('裸衣'));
assert.equal(await hand.count(), 4);
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.locator('[data-decision-kind="play-action"]').waitFor();
assert.equal(await hand.count(), 5);
assert.ok((await page.getByTestId('journal').textContent()).includes('甲席发动【裸衣】'));
await page.screenshot({ path: `.artifacts/ui/native-luoyi-${buildKind}.png`, fullPage: true });

await start(2, 4, 'standard:identity', false, 'standard:zhenji');
await page.locator('[data-decision-kind="invoke"]').waitFor();
assert.ok((await page.getByTestId('decision-hint').textContent()).includes('洛神'));
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.getByText('是否继续【洛神】？', { exact: true }).waitFor();
assert.equal(await hand.count(), 5);
assert.ok((await page.getByTestId('journal').textContent()).includes('甲席获得判定牌'));
await page.getByRole('button', { name: '不发动', exact: true }).click();
await page.locator('[data-decision-kind="play-action"]').waitFor();
assert.equal(await hand.count(), 7);
await page.screenshot({ path: `.artifacts/ui/native-luoshen-${buildKind}.png`, fullPage: true });

await start(2, 23, 'standard:identity', false, 'standard:simayi');
await reachOwnSkill('鬼才：', true);
const retrialMaterial = await hand.first().getAttribute('data-testid');
assert.ok(retrialMaterial);
await hand.first().click();
assert.ok(await confirm.isEnabled());
await confirm.click();
await page.waitForFunction(() =>
  document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席发动【鬼才】'),
);
assert.equal(await page.getByTestId('hand-cards').getByTestId(retrialMaterial).count(), 0);
await page.screenshot({ path: `.artifacts/ui/native-guicai-${buildKind}.png`, fullPage: true });

await start(2, 59, 'standard:identity', false, 'standard:simayi', 'standard:simayi');
await reachOwnSkill('鬼才：', true);
assert.match(await page.locator('.turn-label').textContent(), /乙席/);
assert.match(await page.getByTestId('journal').textContent(), /乙席发动【鬼才】/);
assert.doesNotMatch(await page.getByTestId('journal').textContent(), /甲席发动【鬼才】/);
const orderVitality = (await page.getByTestId('target-甲席').getAttribute('aria-label')).match(
  /体力\d+\/\d+/,
)[0];
assert.equal(
  await hand.filter({ has: page.locator('.card-name').filter({ hasText: /^闪$/ }) }).count(),
  0,
);
const orderMaterial = page
  .getByTestId('hand-cards')
  .getByRole('button', { name: '桃 ♥4', exact: true });
const orderMaterialId = await orderMaterial.getAttribute('data-testid');
await orderMaterial.click();
await confirm.click();
await page.waitForFunction(() =>
  document
    .querySelector('[data-testid="journal"]')
    ?.textContent?.includes('甲席的八卦阵结果：♥4【桃】'),
);
const orderSequence = async (label) =>
  Number(
    (
      await page
        .getByTestId('journal')
        .locator('.journal-entry')
        .filter({ hasText: label })
        .first()
        .locator('small')
        .textContent()
    ).slice(1),
  );
assert.ok((await orderSequence('乙席发动【鬼才】')) < (await orderSequence('甲席发动【鬼才】')));
assert.match(await page.getByTestId('journal').textContent(), /甲席使用【闪】/);
assert.match(
  await page.getByTestId('target-甲席').getAttribute('aria-label'),
  new RegExp(orderVitality),
);
assert.equal(await page.getByTestId('hand-cards').getByTestId(orderMaterialId).count(), 0);
assert.equal(await page.getByRole('dialog', { name: /请交给/ }).count(), 0);
await page.screenshot({
  path: `.artifacts/ui/native-action-order-guicai-${buildKind}.png`,
  fullPage: true,
});

await start(2, 27, 'standard:identity', false, 'standard:guojia');
await reachOwnSkill('是否发动【遗计】');
const beforeYiji = await hand.count();
await page.getByRole('button', { name: '发动', exact: true }).click();
const privatePool = page.getByRole('group', { name: '仅本人可见的牌池', exact: true });
await privatePool.waitFor();
assert.equal(await privatePool.locator('button').count(), 2);
assert.equal(await hand.count(), beforeYiji);
const privatePoolBox = await privatePool.boundingBox();
const privateDecisionBox = await page.locator('.decision-bar').boundingBox();
assert.ok(privatePoolBox.y + privatePoolBox.height <= privateDecisionBox.y + 1);
await page.getByRole('button', { name: '暂停对局', exact: true }).click();
assert.equal(await privatePool.count(), 0);
assert.equal(await hand.count(), 0);
await page.getByRole('button', { name: '继续对局', exact: true }).click();
assert.equal(await privatePool.locator('button').count(), 2);
await page.screenshot({ path: `.artifacts/ui/native-yiji-${buildKind}.png`, fullPage: true });
await privatePool.locator('button').first().click();
await page.getByTestId('target-乙席').click();
assert.ok(await confirm.isEnabled());
await confirm.click();
await page.waitForFunction(
  () =>
    document.querySelector('[aria-label="仅本人可见的牌池"]')?.querySelectorAll('button').length ===
    1,
);
assert.equal(await privatePool.locator('button').count(), 1);
await page.getByRole('button', { name: '保留余牌', exact: true }).click();
await privatePool.waitFor({ state: 'detached' });
assert.equal(await privatePool.count(), 0);
assert.equal(await hand.count(), beforeYiji + 1);

await start(2, 1, 'standard:identity', false, 'standard:guojia', 'standard:xuchu');
await reachOwnSkill('是否发动【遗计】');
assert.match(await page.getByTestId('target-甲席').getAttribute('aria-label'), /体力1\/3/);
assert.match(await page.getByTestId('decision-hint').textContent(), /第 1\/2 次/);
const repeatedYijiHand = await hand.count();
await page.getByRole('button', { name: '发动', exact: true }).click();
await privatePool.waitFor();
assert.equal(await privatePool.locator('button').count(), 2);
const repeatedYijiCards = await privatePool
  .locator('button')
  .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''));
await page.getByRole('button', { name: '保留余牌', exact: true }).click();
await page.waitForFunction(() =>
  document.querySelector('[data-testid="decision-hint"]')?.textContent?.includes('第 2/2 次'),
);
assert.equal(await hand.count(), repeatedYijiHand + 2);
await page.getByRole('button', { name: '发动', exact: true }).click();
await privatePool.waitFor();
assert.equal(await privatePool.locator('button').count(), 2);
repeatedYijiCards.push(
  ...(await privatePool
    .locator('button')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''))),
);
await page.screenshot({
  path: `.artifacts/ui/native-yiji-occurrences-${buildKind}.png`,
  fullPage: true,
});
await page.getByRole('button', { name: '保留余牌', exact: true }).click();
await privatePool.waitFor({ state: 'detached' });
assert.equal(new Set(repeatedYijiCards).size, 4);
for (const id of repeatedYijiCards)
  await page.getByTestId('hand-cards').getByTestId(id).waitFor({ state: 'attached' });
assert.equal(
  await page
    .getByTestId('journal')
    .locator('.journal-entry')
    .filter({ hasText: '甲席将 2 张牌交给 甲席' })
    .count(),
  2,
);
assert.equal(
  (await page.getByTestId('journal').textContent()).match(/甲席发动【遗计】/g)?.length,
  2,
);

await start(2, 23, 'standard:identity', false, 'standard:guojia');
await reachOwnSkill('是否发动【天妒】', true);
const beforeTiandu = await hand.count();
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.waitForFunction(() =>
  document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席获得判定牌'),
);
assert.equal(await hand.count(), beforeTiandu + 1);
await page.screenshot({ path: `.artifacts/ui/native-tiandu-${buildKind}.png`, fullPage: true });

await start(2, 42, 'standard:identity', false, 'standard:zhangliao');
await page.getByText('突袭：选择一至两名角色，获得各一张手牌', { exact: true }).waitFor();
assert.equal(await hand.count(), 4);
await page.getByTestId('target-乙席').click();
await confirm.click();
const stolenOptions = page.locator('.choice-options button');
await stolenOptions.first().waitFor();
assert.equal(await stolenOptions.count(), 4);
for (const option of await stolenOptions.all())
  assert.match(await option.textContent(), /未知手牌/);
await stolenOptions.first().click();
await confirm.click();
await page.locator('[data-decision-kind="play-action"]').waitFor();
assert.equal(await hand.count(), 5);
assert.ok((await page.getByTestId('journal').textContent()).includes('甲席从 乙席 获得一张手牌'));
await page.screenshot({ path: `.artifacts/ui/native-tuxi-${buildKind}.png`, fullPage: true });

await start(2, 27, 'standard:identity', false, 'standard:caocao');
await reachOwnSkill('是否发动【奸雄】');
const beforeJianxiong = await hand.count();
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.waitForFunction(() =>
  document
    .querySelector('[data-testid="journal"]')
    ?.textContent?.includes('甲席获得造成伤害的材料牌'),
);
assert.equal(await hand.count(), beforeJianxiong + 1);
await page.screenshot({ path: `.artifacts/ui/native-jianxiong-${buildKind}.png`, fullPage: true });

await start(8, 8, 'standard:identity', false, 'standard:caocao');
await reachOwnSkill('是否发动【护驾】');
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.waitForFunction(() =>
  document.querySelector('[data-testid="journal"]')?.textContent?.includes('为甲席打出【闪】'),
);
assert.equal(await page.getByRole('dialog', { name: /请交给/ }).count(), 0);
await page.screenshot({ path: `.artifacts/ui/native-hujia-${buildKind}.png`, fullPage: true });

await start(2, 42, 'standard:identity', false, 'standard:liubei');
await page.getByRole('button', { name: '仁德', exact: true }).click();
await confirm.click();
const beforeRende = await hand.count();
await hand.nth(0).click();
await hand.nth(1).click();
await page.getByTestId('target-乙席').click();
await confirm.click();
await page.waitForFunction(() =>
  document
    .querySelector('[data-testid="journal"]')
    ?.textContent?.includes('甲席发动【仁德】，将 2 张牌交给 乙席'),
);
assert.equal(await hand.count(), beforeRende - 2);
await page.screenshot({ path: `.artifacts/ui/native-rende-${buildKind}.png`, fullPage: true });

await start(4, 6, 'standard:identity', false, 'standard:liubei');
await page.getByRole('button', { name: '激将', exact: true }).click();
await page.getByTestId('target-乙席').click();
await confirm.click();
await page.getByText('是否发动【激将】请求其他蜀角色为此次用杀供牌？', { exact: true }).waitFor();
const beforeJijiang = await hand.count();
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.waitForFunction(
  () =>
    document
      .querySelector('[data-testid="journal"]')
      ?.textContent?.includes('丁席为甲席打出【杀】') &&
    document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席使用【杀】'),
);
await page.locator('[data-decision-kind="play-action"]').waitFor();
assert.equal(await hand.count(), beforeJijiang);
await page.screenshot({ path: `.artifacts/ui/native-jijiang-${buildKind}.png`, fullPage: true });

await start(2, 27, 'standard:identity', false, 'standard:huatuo');
await reachOwnSkill('青囊');
let healTarget = '';
let healBefore = 0;
for (const id of ['甲席', '乙席']) {
  const vitality = (await page.getByTestId(`target-${id}`).getAttribute('aria-label')).match(
    /体力(\d+)\/(\d+)/,
  );
  if (Number(vitality[1]) < Number(vitality[2])) {
    healTarget = id;
    healBefore = Number(vitality[1]);
    break;
  }
}
assert.ok(healTarget);
await page.getByRole('button', { name: '青囊', exact: true }).click();
await confirm.click();
const beforeQingnang = await hand.count();
await hand.first().click();
await page.getByTestId(`target-${healTarget}`).click();
await confirm.click();
await page.waitForFunction(
  ({ target, hp }) =>
    document
      .querySelector(`[data-testid="target-${target}"]`)
      ?.getAttribute('aria-label')
      ?.includes(`体力${hp}/`),
  { target: healTarget, hp: healBefore + 1 },
);
assert.equal(await hand.count(), beforeQingnang - 1);
await page.screenshot({ path: `.artifacts/ui/native-qingnang-${buildKind}.png`, fullPage: true });

await start(2, 2, 'standard:identity', false, 'standard:huatuo');
await reachOwnSkill('濒死');
await page.getByRole('button', { name: '急救', exact: true }).click();
await page.getByTestId('hand-cards').locator('button[aria-disabled="false"]').first().click();
await confirm.click();
await page.waitForFunction(() =>
  document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席使用【桃】'),
);
await page.screenshot({ path: `.artifacts/ui/native-jijiu-${buildKind}.png`, fullPage: true });

await start(2, 42, 'standard:identity', false, 'standard:sunquan');
await page.getByRole('button', { name: '制衡', exact: true }).click();
await confirm.click();
const beforeZhiheng = await hand.count();
const zhihengFirst = await hand.nth(0).getAttribute('data-testid');
const zhihengSecond = await hand.nth(1).getAttribute('data-testid');
await hand.nth(0).click();
await hand.nth(1).click();
await confirm.click();
await page.locator('[data-decision-kind="play-action"]').waitFor();
assert.equal(await hand.count(), beforeZhiheng);
assert.equal(await page.getByTestId('hand-cards').getByTestId(zhihengFirst).count(), 0);
assert.equal(await page.getByTestId('hand-cards').getByTestId(zhihengSecond).count(), 0);
assert.equal(await page.getByRole('button', { name: '制衡', exact: true }).count(), 0);
await page.screenshot({ path: `.artifacts/ui/native-zhiheng-${buildKind}.png`, fullPage: true });

await start(2, 42, 'standard:identity', false, 'standard:lvmeng');
await page.getByRole('button', { name: '结束出牌', exact: true }).click();
await page.getByText('是否发动【克己】跳过弃牌阶段？', { exact: true }).waitFor();
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.waitForFunction(() =>
  document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席跳过了弃牌阶段'),
);
await page.screenshot({ path: `.artifacts/ui/native-keji-${buildKind}.png`, fullPage: true });

await start(2, 5, 'standard:identity', false, 'standard:luxun');
await reachOwnSkill('是否发动【连营】');
assert.equal(await hand.count(), 0);
await page.getByRole('button', { name: '查看武将技能说明', exact: true }).click();
await page.getByRole('dialog', { name: '陆逊 · 技能' }).waitFor();
assert.ok((await page.getByRole('dialog', { name: '陆逊 · 技能' }).textContent()).includes('谦逊'));
await page.screenshot({ path: `.artifacts/ui/native-lianying-${buildKind}.png`, fullPage: true });
await page.getByRole('button', { name: '关闭技能说明', exact: true }).click();
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席发动【连营】') &&
    document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席摸了 1 张牌'),
);

await start(4, 68, 'standard:identity', false, 'standard:sunquan');
await reachOwnSkill('甲席回复 2 点体力', false, true);
assert.equal(await page.getByText(/尚未开局/).count(), 0);
await page.getByRole('button', { name: '结算记录', exact: true }).click();
const journalBox = await page.getByTestId('journal').boundingBox();
const journalMessageBox = await page
  .getByTestId('journal')
  .locator('.journal-entry p')
  .first()
  .boundingBox();
assert.ok(journalMessageBox.y + journalMessageBox.height <= journalBox.y + journalBox.height + 1);
await page.screenshot({ path: `.artifacts/ui/native-jiuyuan-${buildKind}.png`, fullPage: true });

await start(2, 1, 'standard:identity', false, 'standard:huangyueying');
await reachOwnSkill('结束出牌');
const jizhiBefore = await hand.count();
await hand.filter({ has: page.locator('.card-name', { hasText: '过河拆桥' }) }).click();
await page.getByTestId('target-乙席').click();
await confirm.click();
await page.getByTestId('decision-hint').filter({ hasText: '集智' }).waitFor();
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席发动【集智】') &&
    document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席摸了 1 张牌'),
);
assert.equal(await hand.count(), jizhiBefore);
await page.screenshot({ path: '.artifacts/ui/native-jizhi-' + buildKind + '.png', fullPage: true });

await start(2, 2, 'standard:identity', false, 'standard:lvbu');
await reachOwnSkill('结束出牌');
await hand
  .filter({ has: page.locator('.card-name', { hasText: /^杀$/ }) })
  .first()
  .click();
await page.getByTestId('target-乙席').click();
await confirm.click();
await page.waitForFunction(
  () =>
    [...document.querySelectorAll('[data-testid="journal"] .journal-entry')].filter((entry) =>
      entry.textContent?.includes('乙席使用【闪】'),
    ).length === 2,
);
assert.ok((await page.getByTestId('target-乙席').getAttribute('aria-label')).includes('体力4/4'));
await page.screenshot({
  path: '.artifacts/ui/native-wushuang-' + buildKind + '.png',
  fullPage: true,
});

await start(2, 42, 'standard:identity', false, 'standard:daqiao');
await reachOwnSkill('结束出牌');
await page.getByRole('button', { name: '国色', exact: true }).click();
const guoseMaterial = page
  .getByTestId('hand-cards')
  .locator('button[aria-disabled="false"]')
  .first();
const guoseId = await guoseMaterial.getAttribute('data-testid');
await guoseMaterial.click();
await page.getByTestId('target-乙席').click();
await confirm.click();
await page.getByTestId('judgment-乙席').filter({ hasText: '乐' }).waitFor();
assert.equal(await page.getByTestId('hand-cards').getByTestId(guoseId).count(), 0);
await page.screenshot({ path: '.artifacts/ui/native-guose-' + buildKind + '.png', fullPage: true });

await start(4, 1, 'standard:identity', false, 'standard:daqiao');
await reachOwnSkill('流离：');
const liuliMaterial = page
  .getByTestId('hand-cards')
  .locator('button[aria-disabled="false"]')
  .first();
const liuliId = await liuliMaterial.getAttribute('data-testid');
await page.getByTestId('target-乙席').click();
await liuliMaterial.click();
await confirm.click();
await page
  .getByTestId('table-cards')
  .locator('[aria-label$="杀 → 乙席"]')
  .first()
  .waitFor({ state: 'attached' });
assert.ok((await page.getByTestId('journal').textContent()).includes('将杀从 甲席 转移给 乙席'));
assert.equal(await page.getByTestId('hand-cards').getByTestId(liuliId).count(), 0);
await page.screenshot({ path: '.artifacts/ui/native-liuli-' + buildKind + '.png', fullPage: true });

await start(2, 2, 'standard:identity', false, 'standard:machao');
await reachOwnSkill('结束出牌');
await hand
  .filter({ has: page.locator('.card-name', { hasText: /^杀$/ }) })
  .first()
  .click();
await page.getByTestId('target-乙席').click();
await confirm.click();
await page.getByTestId('decision-hint').filter({ hasText: '铁骑' }).waitFor();
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.waitForFunction(() =>
  document
    .querySelector('[data-testid="target-乙席"]')
    ?.getAttribute('aria-label')
    ?.includes('体力3/4'),
);
assert.ok((await page.getByTestId('target-乙席').getAttribute('aria-label')).includes('手牌4'));
assert.ok(!(await page.getByTestId('journal').textContent()).includes('乙席打出【闪】'));
assert.ok(!(await page.getByTestId('journal').textContent()).includes('乙席使用【闪】'));
await page.screenshot({ path: '.artifacts/ui/native-tieqi-' + buildKind + '.png', fullPage: true });

await start(2, 1, 'standard:identity', false, 'standard:zhouyu');
await reachOwnSkill('是否发动【英姿】');
const yingziBefore = await hand.count();
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.getByRole('button', { name: '反间', exact: true }).waitFor();
assert.equal(await hand.count(), yingziBefore + 3);
await page.getByRole('button', { name: '反间', exact: true }).click();
await confirm.click();
await page.getByTestId('target-乙席').click();
await confirm.click();
await page.waitForFunction(() =>
  document
    .querySelector('[data-testid="journal"]')
    ?.textContent?.includes('甲席将 1 张牌交给 乙席，公开：'),
);
assert.equal(await hand.count(), yingziBefore + 2);
assert.equal(await page.getByRole('button', { name: '反间', exact: true }).count(), 0);
await page.screenshot({
  path: '.artifacts/ui/native-yingzi-fanjian-' + buildKind + '.png',
  fullPage: true,
});

await start(2, 1, 'standard:identity', false, 'standard:guanyu', 'standard:zhouyu');
await reachOwnSkill('反间：先猜一种花色');
const fanjianBefore = await hand.count();
await page.getByRole('button', { name: '♠ 黑桃', exact: true }).waitFor();
assert.ok((await page.locator('.decision-copy').textContent()).includes('请选择上方的一项'));
await page.getByRole('button', { name: '暂停对局', exact: true }).click();
assert.equal(await hand.count(), 0);
assert.equal(await page.getByRole('button', { name: '♠ 黑桃', exact: true }).count(), 0);
await page.getByRole('button', { name: '继续对局', exact: true }).click();
assert.equal(await hand.count(), fanjianBefore);
await page.screenshot({
  path: '.artifacts/ui/native-fanjian-guess-' + buildKind + '.png',
  fullPage: true,
});
await page.getByRole('button', { name: '♠ 黑桃', exact: true }).click();
await page.getByRole('button', { name: '未知手牌 1', exact: true }).click();
await confirm.click();
await page.waitForFunction(() =>
  document
    .querySelector('[data-testid="journal"]')
    ?.textContent?.includes('乙席将 1 张牌交给 甲席，公开：【闪】♦2'),
);
assert.equal(await hand.count(), fanjianBefore + 1);
assert.ok((await page.getByTestId('target-甲席').getAttribute('aria-label')).includes('体力2/4'));
await page.screenshot({
  path: '.artifacts/ui/native-fanjian-target-' + buildKind + '.png',
  fullPage: true,
});

await start(4, 2, 'standard:identity', false, 'standard:diaochan');
await reachOwnSkill('结束出牌');
await page.getByRole('button', { name: '离间', exact: true }).click();
await confirm.click();
const lijianMaterial = page
  .getByTestId('hand-cards')
  .locator('button[aria-disabled="false"]')
  .first();
const lijianId = await lijianMaterial.getAttribute('data-testid');
await lijianMaterial.click();
await page.getByTestId('target-乙席').click();
await page.getByTestId('target-丁席').click();
assert.ok((await page.getByTestId('target-乙席').getAttribute('aria-label')).includes('选择顺序1'));
assert.ok((await page.getByTestId('target-丁席').getAttribute('aria-label')).includes('选择顺序2'));
await confirm.click();
await page.waitForFunction(() =>
  document
    .querySelector('[data-testid="journal"]')
    ?.textContent?.includes('丁席使用【决斗】 → 乙席'),
);
assert.equal(await page.getByTestId('hand-cards').getByTestId(lijianId).count(), 0);
assert.equal(await page.getByRole('button', { name: '离间', exact: true }).count(), 0);
await page.screenshot({
  path: '.artifacts/ui/native-lijian-' + buildKind + '.png',
  fullPage: true,
});

await start(2, 42, 'standard:identity', false, 'standard:diaochan');
await reachOwnSkill('是否发动【闭月】');
const biyueBefore = await hand.count();
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.waitForFunction(() =>
  document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席发动【闭月】'),
);
assert.equal(await hand.count(), biyueBefore + 1);
await page.screenshot({ path: '.artifacts/ui/native-biyue-' + buildKind + '.png', fullPage: true });

await start(4, 2, 'standard:identity', false, 'standard:zhugeliang');
await reachOwnSkill('观星：是否');
const guanxingHand = await hand.count();
await page.getByRole('button', { name: '发动', exact: true }).click();
const arrangement = page.getByRole('dialog', { name: '观星：整理牌顶与牌底的顺序' });
const arrangedTop = page.getByTestId('arrange-top');
const arrangedBottom = page.getByTestId('arrange-bottom');
await arrangement.waitFor();
assert.equal(await arrangedTop.locator('article').count(), 4);
const arrangementIds = await arrangedTop
  .locator('article')
  .evaluateAll((items) => items.map((item) => item.getAttribute('data-item-id')));
await arrangement.getByRole('button', { name: '暂停并隐藏', exact: true }).click();
await page.getByRole('dialog', { name: '对局已暂停' }).waitFor();
assert.equal(await arrangement.count(), 0);
assert.equal(await page.locator('[data-item-id]').count(), 0);
assert.equal(await hand.count(), 0);
await page.getByRole('button', { name: '继续对局', exact: true }).click();
await arrangement.waitFor();
for (const index of [0, 3])
  await arrangedTop
    .locator(`[data-item-id="${arrangementIds[index]}"]`)
    .getByRole('button', { name: '移至牌底', exact: true })
    .click();
await arrangedTop.locator('article').nth(1).getByRole('button', { name: /^前移/ }).click();
await arrangedBottom.locator('article').nth(1).getByRole('button', { name: /^前移/ }).click();
assert.deepEqual(
  await arrangedTop
    .locator('article')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-item-id'))),
  [arrangementIds[2], arrangementIds[1]],
);
assert.deepEqual(
  await arrangedBottom
    .locator('article')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-item-id'))),
  [arrangementIds[3], arrangementIds[0]],
);
await page.screenshot({ path: `.artifacts/ui/native-guanxing-${buildKind}.png`, fullPage: true });
await arrangement.getByRole('button', { name: '确认顺序', exact: true }).click();
await page.waitForFunction(() =>
  document
    .querySelector('[data-testid="journal"]')
    ?.textContent?.includes('甲席整理牌堆：2 张置顶，2 张置底'),
);
assert.equal(await hand.count(), guanxingHand + 2);
for (const id of [arrangementIds[2], arrangementIds[1]])
  assert.equal(await page.getByTestId('hand-cards').getByTestId(`card-${id}`).count(), 1);
await page.getByRole('button', { name: '查看武将技能说明' }).click();
assert.match(await page.getByRole('dialog', { name: /诸葛亮.*技能/ }).textContent(), /空城/);
await page.getByRole('button', { name: '关闭技能说明' }).click();

await start(2, 1, 'standard:identity', false, 'standard:guanyu', 'standard:zhugeliang');
await reachOwnSkill('乙席整理牌堆', false, true);
assert.equal(await page.getByRole('dialog', { name: /观星：整理/ }).count(), 0);
assert.equal(await page.getByRole('group', { name: '仅本人可见的牌池' }).count(), 0);
assert.equal(await page.getByRole('dialog', { name: /请交给/ }).count(), 0);

await start(2, 2, 'workshop:showcase', false, 'workshop:guest', 'standard:guanyu', ['作者演武']);
await reachOwnSkill('结束出牌');
assert.match(await page.getByTestId('target-甲席').getAttribute('aria-label'), /甲席·演武客/);
const packageHand = await hand.count();
const packageCard = page.getByTestId('hand-cards').getByTestId('card-workshop-card-42');
await packageCard.click();
await page.getByTestId('target-甲席').click();
await confirm.click();
assert.match(await page.getByTestId('decision-hint').textContent(), /闻策/);
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.locator('[data-decision-kind="choose-option"]').waitFor();
assert.equal(await page.getByRole('button', { name: '回复一点体力', exact: true }).count(), 0);
await page.getByRole('button', { name: '摸两张牌', exact: true }).click();
await page.waitForFunction(
  (amount) => document.querySelectorAll('[data-testid="hand-cards"] button').length === amount,
  packageHand + 2,
);
assert.equal(await packageCard.count(), 0);
assert.match(await page.getByTestId('journal').textContent(), /甲席发动【闻策】/);
await page.getByRole('button', { name: '查看武将技能说明' }).click();
assert.match(await page.getByRole('dialog', { name: /演武客.*技能/ }).textContent(), /武圣/);
await page.getByRole('button', { name: '关闭技能说明' }).click();
await page.screenshot({
  path: `.artifacts/ui/native-author-package-${buildKind}.png`,
  fullPage: true,
});

await start(2, 2, 'workshop:faces', false, 'workshop:vermilion_guest', 'standard:guanyu', [
  '作者演武',
]);
await reachOwnSkill('结束出牌');
const faceMaterial = page.getByTestId('card-face-card-26');
assert.match(await faceMaterial.getAttribute('aria-label'), /闪.*♥/);
assert.match(await faceMaterial.getAttribute('class'), /red/);
const faceHandBefore = await hand.count();
await page.screenshot({
  path: `.artifacts/ui/native-card-face-hand-${buildKind}.png`,
  fullPage: true,
});
await page.getByRole('button', { name: '武圣', exact: true }).click();
await faceMaterial.click();
await page.getByTestId('target-乙席').click();
await confirm.click();
await faceMaterial.waitFor({ state: 'detached' });
await page.waitForFunction(
  (amount) => document.querySelectorAll('[data-testid="hand-cards"] button').length === amount,
  faceHandBefore - 1,
);
assert.match(await page.getByTestId('journal').textContent(), /甲席使用【杀】/);
assert.equal(await page.getByRole('dialog', { name: /请交给/ }).count(), 0);
await page.screenshot({
  path: `.artifacts/ui/native-card-face-use-${buildKind}.png`,
  fullPage: true,
});

await start(2, 4, 'workshop:defense', false, 'workshop:inquirer', 'standard:guanyu', ['作者演武']);
await reachOwnSkill('结束出牌');
await page.getByRole('button', { name: '结束出牌', exact: true }).click();
await reachOwnSkill('是否发动【余响】');
assert.match(await page.getByTestId('journal').textContent(), /甲席发动【拾慧】/);
assert.equal(await page.getByRole('dialog', { name: /请交给/ }).count(), 0);
const learnedHandBefore = await hand.count();
await page.screenshot({
  path: `.artifacts/ui/native-learned-skill-prompt-${buildKind}.png`,
  fullPage: true,
});
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.waitForFunction(
  (amount) =>
    document.querySelector('[data-testid="journal"]')?.textContent?.includes('甲席发动【余响】') &&
    document.querySelectorAll('[data-testid="hand-cards"] button').length >= amount,
  learnedHandBefore + 1,
);
assert.equal(await page.locator('.target-hitbox.self').getAttribute('data-testid'), 'target-甲席');
await page.screenshot({
  path: `.artifacts/ui/native-learned-skill-invoke-${buildKind}.png`,
  fullPage: true,
});

for (const accept of [false, true]) {
  await start(2, 10, 'workshop:relics', false, 'workshop:guest', 'standard:guanyu', ['作者演武']);
  await reachOwnSkill('结束出牌');
  const before = await hand.count();
  const jade = page.getByTestId('hand-cards').getByTestId('card-relic-card-2');
  assert.match(await jade.getAttribute('aria-label'), /遗玉/);
  await jade.click();
  await confirm.click();
  const equipment = page.getByRole('group', { name: '公开装备与判定区', exact: true });
  await equipment.getByRole('button', { name: /遗玉/ }).waitFor();
  await page.getByTestId('hand-cards').getByTestId('card-relic-card-14').click();
  await confirm.click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="decision-hint"]')
      ?.textContent?.includes('是否发动【玉碎】'),
  );
  assert.equal(await equipment.getByRole('button', { name: /遗玉/ }).count(), 0);
  assert.equal(await equipment.getByRole('button', { name: /八卦阵/ }).count(), 1);
  assert.equal(await hand.count(), before - 2);
  await page.getByRole('button', { name: accept ? '发动' : '不发动', exact: true }).click();
  await page.locator('[data-decision-kind="play-action"]').waitFor();
  assert.equal(await hand.count(), before - 2 + Number(accept));
  assert.equal(await jade.count(), 0);
  assert.equal(
    (await page.getByTestId('journal').textContent()).includes('甲席发动【玉碎】'),
    accept,
  );
  await page.screenshot({
    path: `.artifacts/ui/native-retained-equipment-${accept ? 'invoke' : 'decline'}-${buildKind}.png`,
    fullPage: true,
  });
}

// 独立种子开始身份对局，前面的机制场景不修改后续对局状态或绕过决策。
{
  await start(2, 4, 'workshop:chains', false, 'standard:guanyu', 'standard:guanyu', ['作者演武']);
  await reachOwnSkill('结束出牌');
  const before = await hand.count();
  const seats = ['甲席', '乙席'].map((id) => page.getByTestId(`target-${id}`));
  const hp = await Promise.all(
    seats.map(async (seat) =>
      Number((await seat.getAttribute('aria-label')).match(/体力(\d+)\//)[1]),
    ),
  );
  await page.getByTestId('hand-cards').getByTestId('card-chain-card-7').click();
  for (const seat of seats) await seat.click();
  await confirm.click();
  await page.waitForFunction(() =>
    ['甲席', '乙席'].every(
      (id) =>
        document.querySelector(`[data-testid="target-${id}"]`)?.getAttribute('data-chained') ===
        'true',
    ),
  );
  await page.screenshot({
    path: `.artifacts/ui/native-chain-linked-${buildKind}.png`,
    fullPage: true,
  });
  await page.getByTestId('hand-cards').getByTestId('card-chain-card-19').click();
  await seats[1].click();
  await confirm.click();
  await page.waitForFunction(() =>
    ['甲席', '乙席'].every(
      (id) =>
        document.querySelector(`[data-testid="target-${id}"]`)?.getAttribute('data-chained') ===
        'false',
    ),
  );
  for (const [index, seat] of seats.entries())
    assert.match(await seat.getAttribute('aria-label'), new RegExp(`体力${hp[index] - 1}/`));
  assert.equal(await hand.count(), before - 2);
  const journal = await page.getByTestId('journal').textContent();
  assert.match(journal, /乙席受到 1 点火焰伤害/);
  assert.match(journal, /甲席受到 1 点火焰伤害/);
  assert.match(journal, /连环传播/);
  assert.equal(await page.getByRole('dialog', { name: /请交给/ }).count(), 0);
  await page.screenshot({
    path: `.artifacts/ui/native-chain-damage-${buildKind}.png`,
    fullPage: true,
  });
}

{
  await start(2, 4, 'workshop:defense', false, 'standard:guanyu', 'standard:guanyu', ['作者演武']);
  await reachOwnSkill('结束出牌');
  const own = page.getByTestId('target-甲席');
  const other = page.getByTestId('target-乙席');
  const before = await hand.count();
  await page.getByTestId('card-defense-card-7').click();
  await own.click();
  await confirm.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="target-甲席"]')?.getAttribute('data-shield') === '2',
  );
  await page.getByTestId('card-defense-card-11').click();
  await own.click();
  await other.click();
  await confirm.click();
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  assert.equal(await hand.count(), 0);
  assert.equal(await own.getAttribute('data-shield'), '2');
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await page.screenshot({
    path: `.artifacts/ui/native-shield-linked-${buildKind}.png`,
    fullPage: true,
  });
  await page.getByTestId('card-defense-card-19').click();
  await other.click();
  await confirm.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="target-甲席"]')?.getAttribute('data-shield') === '1',
  );
  assert.match(await own.getAttribute('aria-label'), /体力4\/4/);
  assert.match(await other.getAttribute('aria-label'), /体力3\/4/);
  assert.equal(await own.getAttribute('data-chained'), 'false');
  assert.equal(await other.getAttribute('data-chained'), 'false');
  assert.equal(await hand.count(), before - 3);
  assert.match(await page.getByTestId('journal').textContent(), /护盾吸收 1 点/);
  await page.screenshot({
    path: `.artifacts/ui/native-shield-absorbed-${buildKind}.png`,
    fullPage: true,
  });
}

for (const accept of [false, true]) {
  await start(2, 4, 'workshop:defense', false, 'workshop:guardian', 'standard:guanyu', [
    '作者演武',
  ]);
  await reachOwnSkill('结束出牌');
  await page.getByRole('button', { name: '结束出牌', exact: true }).click();
  await reachOwnSkill('代受：');
  const own = page.getByTestId('target-甲席');
  const before = await hand.count();
  const hp = Number((await own.getAttribute('aria-label')).match(/体力(\d+)\//)[1]);
  if (accept) {
    await hand.first().click();
    await page.getByTestId('target-乙席').click();
    await confirm.click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="journal"]')
        ?.textContent?.includes('甲席将 1 点伤害转移给乙席'),
    );
    assert.match(await own.getAttribute('aria-label'), new RegExp(`体力${hp}/`));
    assert.equal(await hand.count(), before - 1);
  } else {
    await page.getByRole('button', { name: '不发动代受', exact: true }).click();
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector('[data-testid="target-甲席"]')
          ?.getAttribute('aria-label')
          ?.includes(`体力${expected}/`),
      hp - 1,
    );
    assert.equal(await hand.count(), before);
    assert.doesNotMatch(
      await page.getByTestId('journal').textContent(),
      /甲席将 1 点伤害转移给乙席/,
    );
  }
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  assert.equal(
    await page.locator('.target-hitbox.self').getAttribute('data-testid'),
    'target-甲席',
  );
  assert.equal(await page.getByRole('dialog', { name: /请交给/ }).count(), 0);
  await page.screenshot({
    path: `.artifacts/ui/native-damage-transfer-${accept ? 'accept' : 'decline'}-${buildKind}.png`,
    fullPage: true,
  });
}

{
  await start(2, 4, 'standard:identity', false, 'workshop:quartermaster', 'standard:guanyu', [
    '作者演武',
  ]);
  await page.getByRole('button', { name: '发动', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /分筹：他人至多一张/ });
  const own = dialog.getByTestId('arrange-甲席');
  const recipient = dialog.getByTestId('arrange-乙席');
  await own.locator('article').nth(3).waitFor();
  assert.ok(
    await own
      .locator('article:has(.arrange-card.red)')
      .first()
      .getByRole('button', { name: '分给乙席', exact: true })
      .isDisabled(),
  );
  for (let index = 0; index < 2; index++)
    await own
      .locator('article:has(.arrange-card:not(.red))')
      .first()
      .getByRole('button', { name: '分给乙席', exact: true })
      .click();
  assert.equal(await recipient.locator('article').count(), 2);
  assert.ok(await dialog.getByRole('button', { name: '确认分配', exact: true }).isDisabled());
  await recipient
    .locator('article')
    .first()
    .getByRole('button', { name: '分给自己保留', exact: true })
    .click();
  assert.ok(await dialog.getByRole('button', { name: '确认分配', exact: true }).isEnabled());
  await dialog.getByRole('button', { name: '暂停并隐藏', exact: true }).click();
  assert.equal(await dialog.count(), 0);
  assert.equal(await hand.count(), 0);
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await own.locator('article').nth(3).waitFor();
  assert.equal(await recipient.locator('article').count(), 0);
  const black = own.locator('article:has(.arrange-card:not(.red))').first();
  const given = await black.getAttribute('data-item-id');
  await black.getByRole('button', { name: '分给乙席', exact: true }).click();
  await page.screenshot({
    path: `.artifacts/ui/native-allotment-choice-${buildKind}.png`,
    fullPage: true,
  });
  await dialog.getByRole('button', { name: '确认分配', exact: true }).click();
  await reachOwnSkill('结束出牌');
  assert.equal(await hand.count(), 9);
  assert.equal(await page.getByTestId('hand-cards').getByTestId(`card-${given}`).count(), 0);
  assert.match(await page.getByTestId('target-乙席').getAttribute('aria-label'), /手牌5/);
  assert.match(await page.getByTestId('journal').textContent(), /甲席分配牌：甲席 3 张、乙席 1 张/);
  await page.screenshot({
    path: `.artifacts/ui/native-allotment-result-${buildKind}.png`,
    fullPage: true,
  });
}
{
  await start(2, 2, 'standard:identity', false, 'standard:guanyu', 'workshop:quartermaster', [
    '作者演武',
  ]);
  await reachOwnSkill('结束出牌');
  await page.getByRole('button', { name: '结束出牌', exact: true }).click();
  await page.locator('[data-decision-kind="cards-targets"]').waitFor();
  await discardCurrent();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="journal"]')?.textContent?.includes('乙席分配牌'),
  );
  assert.equal(await page.getByRole('dialog', { name: /分筹：他人至多一张/ }).count(), 0);
  assert.equal(
    await page.locator('.target-hitbox.self').getAttribute('data-testid'),
    'target-甲席',
  );
  assert.equal(await page.getByRole('dialog', { name: /请交给/ }).count(), 0);
}
{
  await cleanLobby();
  await page
    .getByLabel('导入本地内容包', { exact: true })
    .setInputFiles('.artifacts/content/harbor.sgs.mjs');
  await page.getByRole('checkbox', { name: '渡口', exact: true }).waitFor();
  assert.ok(await page.getByRole('checkbox', { name: '渡口', exact: true }).isChecked());
  await page.getByRole('combobox', { name: '你的武将', exact: true }).selectOption('harbor:guest');
  await page
    .getByRole('combobox', { name: 'AI 武将', exact: true })
    .selectOption('standard:guanyu');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption('harbor:crossing');
  await page.getByRole('spinbutton').fill('2');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill('结束出牌');
  const before = await hand.count();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="battle-canvas"] canvas')?.dataset.portraits ===
      '甲席,乙席',
  );
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: '动画验证' }).click();
    await page.getByRole('button', { name: '8 个实例' }).click();
    await page.waitForFunction(
      () => Number(document.querySelector('[data-testid="spine-frames"]')?.textContent) > 5,
    );
    await page.getByRole('button', { name: '关闭动画验证' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await hand.count(), before);
    assert.deepEqual(errors, []);
  }
  await page.getByTestId('hand-cards').getByTestId('card-harbor-card-6').click();
  await page.getByTestId('target-甲席').click();
  await confirm.click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="decision-hint"]')?.textContent?.includes('潮声'),
  );
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await page.locator('[data-decision-kind="play-action"]').waitFor();
  assert.equal(await hand.count(), before + 2);
  assert.equal(await page.getByTestId('hand-cards').getByTestId('card-harbor-card-6').count(), 0);
  assert.match(await page.getByTestId('journal').textContent(), /甲席发动【潮声】/);
  assert.equal(await page.getByRole('dialog', { name: /请交给/ }).count(), 0);
  await page.screenshot({
    path: `.artifacts/ui/native-imported-content-${buildKind}.png`,
    fullPage: true,
  });
}
{
  await cleanLobby();
  const input = page.getByLabel('导入本地内容包', { exact: true });
  await input.setInputFiles({
    name: 'wrong.sgs.mjs',
    mimeType: 'text/javascript',
    buffer: Buffer.from('export const format="wrong"; export default () => null;'),
  });
  await page.getByRole('alert').filter({ hasText: 'content:build' }).waitFor();
  await input.setInputFiles([
    '.artifacts/content/harbor.sgs.mjs',
    '.artifacts/content/harbor.sgs.mjs',
  ]);
  await page.getByRole('alert').filter({ hasText: 'Duplicate package' }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: '渡口', exact: true }).count(), 0);
  assert.ok(await page.getByRole('button', { name: '开始单机对局' }).isEnabled());
  const dependent = {
    name: 'pilot.sgs.mjs',
    mimeType: 'text/javascript',
    buffer: Buffer.from(
      'export const format="sgs-content/1"; export default sdk => sdk.definePackage({manifest:{id:"pilot",name:"领航",version:"1",requires:[{id:"harbor",version:"0.1.1"}]}});',
    ),
  };
  await input.setInputFiles([
    dependent,
    {
      name: 'harbor.sgs.mjs',
      mimeType: 'text/javascript',
      buffer: await readFile('.artifacts/content/harbor.sgs.mjs'),
    },
  ]);
  const harbor = page.getByRole('checkbox', { name: '渡口', exact: true });
  const pilot = page.getByRole('checkbox', { name: '领航', exact: true });
  await harbor.waitFor();
  assert.ok(await pilot.isChecked());
  await harbor.uncheck();
  await contentReady();
  assert.equal(await pilot.isChecked(), false);
  await pilot.check();
  await contentReady();
  assert.ok(await harbor.isChecked());
  await page.screenshot({
    path: `.artifacts/ui/native-imported-content-lobby-${buildKind}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '移除渡口', exact: true }).click();
  await contentReady();
  assert.equal(await harbor.count(), 0);
  assert.equal(await pilot.count(), 0);
}

await start(2, 42, 'standard:identity', false);
await page.getByText('2 人身份局 · 标准＋EX（108 张）', { exact: true }).waitFor();
const handoffs = 0;
let pauseChecked = false;
let steps = 0;
const decisions = new Set();
for (; steps < 160; steps++) {
  if (await page.getByRole('region', { name: '对局结果' }).count()) break;
  assert.equal(await page.getByRole('dialog', { name: /请交给/ }).count(), 0);
  assert.equal(
    await page.locator('.target-hitbox.self').getAttribute('data-testid'),
    'target-甲席',
  );
  const kind = await page.locator('[data-decision-kind]').getAttribute('data-decision-kind');
  if (kind) decisions.add(kind);
  if (kind && !pauseChecked) {
    const count = await hand.count();
    await page.getByRole('button', { name: '暂停对局', exact: true }).click();
    await page.getByRole('dialog', { name: '对局已暂停' }).waitFor();
    assert.equal(await hand.count(), 0);
    await page.getByRole('button', { name: '继续对局', exact: true }).click();
    assert.equal(await hand.count(), count);
    pauseChecked = true;
    await page.screenshot({ path: `.artifacts/ui/native-solo-${buildKind}.png`, fullPage: true });
  }
  if (kind === 'cards-targets') {
    await discardCurrent();
    continue;
  }
  if (kind === 'card-response' || kind === 'use-card') {
    await page.getByRole('button', { name: /放弃响应|放弃救援|放弃反制/ }).click();
    continue;
  }
  if (kind === 'play-action') {
    let used = false;
    for (const card of await page
      .getByTestId('hand-cards')
      .locator('button[aria-label^="杀 "], button[aria-label^="决斗 "]')
      .all()) {
      await card.click();
      const targets = page.locator('.target-hitbox[aria-disabled="false"]');
      if (await targets.count()) await targets.first().click();
      if (await confirm.isEnabled()) {
        await confirm.click();
        used = true;
        break;
      }
    }
    if (!used) await page.getByRole('button', { name: '结束出牌', exact: true }).click();
    continue;
  }
  // 只等执行者开放实际决策，不借测试脚本修改规则或主动推进空回合。
  await page.waitForFunction(
    () =>
      document.querySelector('[data-decision-kind]')?.getAttribute('data-decision-kind') ||
      document.querySelector('[aria-label="对局结果"]'),
  );
}
await page.getByRole('region', { name: '对局结果' }).waitFor();
assert.equal(pauseChecked, true);
assert.ok((await page.getByTestId('journal').textContent()).includes('乙席使用【'));
assert.ok((await page.getByTestId('journal').textContent()).includes('对局结束'));
assert.ok(await confirm.isDisabled());
await page.screenshot({ path: `.artifacts/ui/native-victory-${buildKind}.png`, fullPage: true });
await page.getByRole('button', { name: '动画验证' }).click();
await page.getByRole('button', { name: '8 个实例' }).click();
await page.waitForFunction(
  () => Number(document.querySelector('[data-testid="spine-frames"]')?.textContent) > 10,
);
assert.equal(await page.getByTestId('spine-count').textContent(), '8');
await page.screenshot({ path: `.artifacts/ui/native-spine-${buildKind}.png`, fullPage: true });
await page.getByRole('button', { name: '关闭动画验证' }).click();
// 留下已提交的真实安装，验证脚本随后关闭此进程并启动同一 exe 恢复它。
await cleanLobby();
await page
  .getByLabel('导入本地内容包', { exact: true })
  .setInputFiles(['.artifacts/content/harbor.sgs.mjs', '.artifacts/content/gallery.sgs']);
await page.getByRole('checkbox', { name: '渡口', exact: true }).waitFor();
await contentReady();
assert.equal(await page.getByTestId('content-store-status').textContent(), '已保存');
assert.equal(await page.getByRole('checkbox', { name: '画阁', exact: true }).isChecked(), true);
const externalResourceBundle = await resourceBundleRecord(page);
const processId = Number(process.env.SGS_NATIVE_PID);
assert.ok(Number.isSafeInteger(processId) && processId > 0);
if (errors.length)
  await writeFile(
    `.artifacts/ui/native-errors-${buildKind}.json`,
    JSON.stringify({ capturedAt: new Date().toISOString(), errors, errorDetails }, null, 2),
  );
assert.deepEqual(errors, []);
const executable = process.env.SGS_NATIVE_EXE;
await writeFile(
  `.artifacts/ui/native-smoke-${buildKind}.json`,
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      buildKind,
      processId,
      verificationProfile,
      restartSeed: { id: 'harbor', version: '0.1.1', installed: true },
      executable: executable ?? null,
      executableSha256: executable
        ? createHash('sha256')
            .update(await readFile(executable))
            .digest('hex')
        : null,
      browser: browser.version(),
      externalModule: {
        file: '.artifacts/content/harbor.sgs.mjs',
        sha256: createHash('sha256')
          .update(await readFile('.artifacts/content/harbor.sgs.mjs'))
          .digest('hex'),
      },
      externalResourceBundle,
      origin: new URL(page.url()).origin,
      handoffs,
      solo: { human: '甲席', pauseChecked, handoffs },
      steps,
      decisions: [...decisions],
      assertions: [
        'resource ZIP stores real Blob and source without inline image in one committed record',
        'resource bundle dependency installs with the ordinary module before actual process restart',
        'quota and per-item receiver conditions share real distribution validation',
        'private allocation pause hides and restores legal initial witness',
        'atomic card distribution changes both real hands and public counts',
        'non-human quartermaster uses basic AI without leaking private dialog or handoff',
        'static standard and inline external portraits draw in real seat layout',
        'portrait board survives three independent Spine renderer closes and real skill use',
        'newly learned skill explicitly joins the first damage window, real optional invoke and draw',
        'current card face, real spade Jink inherits red heart in Wusheng, fixed human seat',
        'content source and enabled selection durably saved before actual process restart',
        'external content module imports real card and skill using host Window identity',
        'invalid module and duplicate package import leave lobby unchanged',
        'batch module dependency closure, cascading disable and removal',
        'shield absorption, chain propagation, public markers and pause',
        'human damage transfer paid once against real AI attack',
        'human damage transfer declined without payment against real AI attack',
        'native assets and WebGL',
        'reference table positions and left journal drawer',
        'real equipment installation and replacement',
        'retired equipment recipe removed',
        'real delayed placement and judgment',
        'planned play phase skipped',
        'real armor invoke and red judgment Jink',
        'real collateral preparation and weapon transfer',
        'real axe payment and defense breakthrough',
        'real blade follow-up Slash',
        'real last-hand halberd three targets',
        'real kylin bow public horse choice',
        'public genders and double swords victim choice',
        'ice sword replacement and two fresh opaque choices',
        'standard deck selected by default',
        'general selection and real Kurou HP loss and draw',
        'Zhao Yun Longdan Jink as Slash and skill description dialog',
        'Xu Chu Luoyi explicit draw phase reduction',
        'Zhen Ji Luoshen black judgment obtained and explicit stop',
        'Sima Yi Guicai physical hand retrial',
        'two Sima Yi retrials follow the active AI turn, then human red armor judgment',
        'Guo Jia Yiji private pool, split transfer and pause concealment',
        'real Xu Chu AI two-point damage and two independent Yiji occurrences',
        'Guo Jia Tiandu obtains final armor judgment',
        'Zhang Liao Tuxi replaces draw with opaque hand acquisition',
        'Cao Cao Jianxiong obtains real damage materials',
        'Cao Cao lord Hujia receives real AI Wei Jink',
        'Liu Bei Rende transfers two real hand cards',
        'Liu Bei Jijiang uses real Shu AI supplied Slash',
        'Hua Tuo Qingnang discards hand cost and heals',
        'Hua Tuo Jijiu uses red material as Peach in real rescue',
        'Sun Quan Zhiheng exchanges two real hand cards',
        'Lv Meng Keji skips discard after a real play phase',
        'Lu Xun Lianying draws after losing the last hand and Qianxun description',
        'Sun Quan lord Jiuyuan heals two from a real Wu AI Peach',
        'readable journal body and accurate between-turn label',
        'Huang Yueying Jizhi draws before the real ordinary trick effect',
        'Lv Bu Wushuang requires two real AI Jink uses',
        'Da Qiao Guose diamond material persists as Indulgence',
        'Da Qiao Liuli atomic discard and public replacement target',
        'Ma Chao Tieqi red judgment blocks real AI Jink responses',
        'Zhou Yu Yingzi phase draw and Fanjian real AI suit guess and hand transfer',
        'human suit choice and opaque selection against selected Zhou Yu AI',
        'Diao Chan Lijian ordered male targets and real AI Duel declaration',
        'Diao Chan Biyue draws in the real finish phase',
        'Zhuge Liang private arrangement, both ordered groups and real next draw',
        'arrangement pause concealment, resume and Kongcheng skill description',
        'Zhuge Liang AI arranges without exposing private choices to the human',
        'source package selection, cross-package general skill, Hearing and Prepare choice',
        'retained equipment source: real jade replacement, optional decline and invoke',
        'chain content: public links, real fire propagation, fixed human seat and single card payment',
        'manual authoring mode private handoffs',
        'fixed human seat and AI opponent, no solo handoffs',
        'pause hides hand and explicit resume restores it',
        'human and basic AI real decisions to identity victory',
        'Spine 8 animated instances',
        'close and release',
      ],
      consoleErrors: errors,
    },
    null,
    2,
  )}\n`,
);
console.log('Windows WebView2 local-match smoke passed.');
await browser.close();
