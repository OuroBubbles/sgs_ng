import { test, expect, type Page, type Locator } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const found: string[] = [];
  errors.set(page, found);
  page.on('pageerror', (error) => found.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') found.push(message.text());
  });
  await page.goto('/');
  await page.getByRole('button', { name: '单机演武', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '牌局种子', exact: true })).toBeHidden();
  await page.getByText('演练与复现', { exact: true }).click();
  await expect(page.locator('[data-content-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('battle-canvas').locator('canvas')).toHaveCount(0);
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

const hand = (page: Page) => page.getByTestId('hand-cards').locator('button');
const confirm = (page: Page) => page.getByRole('button', { name: '确认当前选择', exact: true });

async function selectTarget(page: Page, item: string | Locator) {
  const target = typeof item === 'string' ? page.getByTestId(item) : item;
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function expectSeatTextToFit(page: Page) {
  await expect
    .poll(() =>
      page.locator('.target-hitbox').evaluateAll((nodes) => {
        const failures: string[] = [];
        for (const node of nodes) {
          const seat = node.getBoundingClientRect();
          const table = node.closest('.table-surface')!.getBoundingClientRect();
          if (
            seat.x < table.x - 1 ||
            seat.right > table.right + 1 ||
            seat.y < table.y - 1 ||
            seat.bottom > table.bottom + 1
          )
            failures.push('席位越过牌桌边界');
          const label = node.getAttribute('aria-label') ?? '';
          if (
            label.includes('身份未知') &&
            node.querySelector('.seat-role')?.textContent !== '未知'
          )
            failures.push('隐藏身份被显示');
          const hp = label.match(/体力(-?\d+)\/(\d+)/);
          const handCount = label.match(/手牌(\d+)/)?.[1];
          const gender = label.match(/性别([^，]+)/)?.[1];
          if (hp && node.querySelector('.seat-health')?.textContent !== `${hp[1]}/${hp[2]}`)
            failures.push('可见体力与席位不一致');
          if (handCount && node.querySelector('.seat-hand b')?.textContent !== handCount)
            failures.push('可见手牌数量与席位不一致');
          if (node.querySelector('.seat-gender')?.textContent !== gender)
            failures.push('可见性别与席位不一致');
          const chained = !label.includes('已阵亡') && node.getAttribute('data-chained') === 'true';
          if (Boolean(node.querySelector('.seat-effect[title="连环"]')) !== chained)
            failures.push('连环标记与席位不一致');
          const shield = !label.includes('已阵亡') ? Number(node.getAttribute('data-shield')) : 0;
          if (shield > 0 && node.querySelector('.shield')?.textContent !== String(shield))
            failures.push('护盾标记与席位不一致');
          for (const field of node.querySelectorAll(
            '.seat-role,.seat-hand,.seat-name,.seat-vitals,.seat-effect,.seat-number',
          )) {
            const rect = field.getBoundingClientRect();
            const overhang =
              (seat.width / 175) * (field.classList.contains('seat-number') ? 36 : 8);
            if (
              // 原图中的身份牌、手牌数底板允许外扩；实际图元仍必须完整位于牌桌内。
              rect.x < seat.x - overhang - 1 ||
              rect.right > seat.right + overhang + 1 ||
              rect.y < seat.y - overhang - 1 ||
              rect.bottom > seat.bottom + overhang + 1 ||
              rect.x < table.x - 1 ||
              rect.right > table.right + 1 ||
              rect.y < table.y - 1 ||
              rect.bottom > table.bottom + 1 ||
              (field.clientWidth > 0 && field.scrollWidth > field.clientWidth + 1) ||
              (field.clientHeight > 0 && field.scrollHeight > field.clientHeight + 1)
            )
              failures.push(`${field.className}: ${field.textContent}`);
            if (Number.parseFloat(getComputedStyle(field).fontSize) < 10)
              failures.push('字号小于 10px');
          }
        }
        return failures;
      }),
    )
    .toEqual([]);
}

test('标准立绘实际绘制到原席位，确认与目标区域仍按参考布局可操作', async ({ page }, info) => {
  await startGeneral(page, 'standard:guanyu', 4, 2, 'standard:caocao');
  const canvas = page.getByTestId('battle-canvas').locator('canvas');
  await expect(canvas).toHaveAttribute('data-portraits', '甲席,乙席,丙席,丁席');
  await expectSeatTextToFit(page);
  await expect(page.locator('.seat-name').first()).toHaveCSS('writing-mode', 'vertical-rl');
  await expect(page.locator('.seat-vitals').first()).toHaveCSS('flex-direction', 'column');
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/关羽/);
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/曹操/);
  await reachOwnSkill(page, '结束出牌');
  await expect(page.getByTestId('hand-cards').locator('.card-picture')).toHaveCount(
    await hand(page).count(),
  );
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/portraits-${info.project.name}.png`,
    fullPage: true,
  });
});

test('坏立绘回退默认图、坏卡面回退文字，解码失败不阻塞本人选择', async ({ page }, info) => {
  await page.route('**/assets/guanyu-*.jpg', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: 'invalid image' }),
  );
  await page.route('**/assets/slash-*.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: 'invalid card image' }),
  );
  await page
    .getByRole('combobox', { name: '牌组', exact: true })
    .selectOption('standard:mechanics');
  await startGeneral(page, 'standard:guanyu', 2, 27, 'standard:caocao');
  await expect(page.getByTestId('battle-canvas').locator('canvas')).toHaveAttribute(
    'data-portraits',
    '乙席',
  );
  await reachOwnSkill(page, '结束出牌');
  await expect(page.getByRole('button', { name: '结束出牌', exact: true })).toBeEnabled();
  const slash = hand(page)
    .filter({ has: page.locator('.card-name', { hasText: /^杀$/ }) })
    .first();
  await expect(slash.locator('.card-name:not(.sr-only)')).toBeVisible();
  await expect(slash.locator('.card-picture')).toHaveCount(0);
  await slash.click();
  await expect(confirm(page)).toBeEnabled();
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await page.screenshot({
    path: `.artifacts/ui/portrait-fallback-${info.project.name}.png`,
    fullPage: true,
  });
});

test('不访问内容数据库即可组合内置源码，切换后刷新目录并保留合法选择', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new Error('日常入口不应访问内容数据库');
      },
    });
  });
  await page.reload();
  await page.getByRole('button', { name: '单机演武', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始单机对局' })).toBeEnabled();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  const toggle = page.getByRole('checkbox', { name: '机制演武', exact: true });
  const hero = page.getByRole('combobox', { name: '你的武将', exact: true });
  const npc = page.getByRole('combobox', { name: 'AI 武将', exact: true });
  const deck = page.getByRole('combobox', { name: '牌组', exact: true });
  const stats = page.getByLabel('可用内容统计', { exact: true });
  await expect(toggle).not.toBeChecked();
  const lobby = await page.getByRole('region', { name: '开局设置' }).boundingBox();
  const start = await page.getByRole('button', { name: '开始单机对局' }).boundingBox();
  const toggleBox = await toggle.locator('..').boundingBox();
  expect(start!.y + start!.height).toBeLessThanOrEqual(lobby!.y + lobby!.height);
  // 整个标签可点击；保留触控高度，同时限制意外换行撑高侧栏。
  expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
  expect(toggleBox!.height).toBeLessThan(60);
  await expect(hero.locator('option')).toHaveCount(25);
  await expect(deck.locator('option')).toHaveCount(2);
  await toggle.check();
  await expect(hero.locator('option')).toHaveCount(30);
  await expect(stats.getByText('37', { exact: true })).toBeVisible();
  await expect(stats.getByText('30', { exact: true })).toBeVisible();
  await expect(deck.locator('option[value="workshop:showcase"]')).toHaveText('机制演武（44 张）');
  await hero.selectOption('workshop:guest');
  await npc.selectOption('workshop:guest');
  await deck.selectOption('workshop:showcase');
  await toggle.uncheck();
  await expect(hero).toHaveValue('standard:guanyu');
  await expect(npc).toHaveValue('preset');
  await expect(deck).toHaveValue('standard:identity');
  await expect(hero.locator('option')).toHaveCount(25);
  await expect(stats.getByText('32', { exact: true })).toBeVisible();
  await expect(stats.getByText('25', { exact: true })).toBeVisible();
  await hero.selectOption('standard:zhaoyun');
  await toggle.check();
  await expect(hero).toHaveValue('standard:zhaoyun');
  const enabledStart = await page.getByRole('button', { name: '开始单机对局' }).boundingBox();
  expect(enabledStart!.y + enabledStart!.height).toBeLessThanOrEqual(lobby!.y + lobby!.height);
  await page.screenshot({
    path: `.artifacts/ui/source-package-lobby-${info.project.name}.png`,
    fullPage: true,
  });
});

test('演武源码通过真实开局完成混合武将、闻策、整备选项和材料善后', async ({ page }, info) => {
  await page.getByRole('checkbox', { name: '机制演武', exact: true }).check();
  await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption('workshop:showcase');
  await startGeneral(page, 'workshop:guest', 2, 2, 'standard:guanyu');
  await reachOwnSkill(page, '结束出牌');
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/甲席·演武客/);
  const before = await hand(page).count();
  const card = page.getByTestId('hand-cards').getByTestId('card-workshop-card-42');
  await card.click({ button: 'right' });
  await expect(page.getByRole('dialog', { name: /整备/ })).toContainText('作者演示牌');
  await page.getByRole('button', { name: '关闭牌面详情' }).click();
  await card.click();
  await selectTarget(page, 'target-甲席');
  await confirm(page).click();
  await expect(page.getByTestId('decision-hint')).toContainText('闻策');
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(page.locator('[data-decision-kind="choose-option"]')).toBeVisible();
  await expect(page.getByTestId('decision-hint')).toContainText('整备');
  await expect(page.getByRole('button', { name: '回复一点体力', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '摸两张牌', exact: true }).click();
  await expect(hand(page)).toHaveCount(before + 2);
  await expect(page.getByTestId('journal')).toContainText('甲席发动【闻策】');
  await expect(page.getByTestId('journal')).toContainText('甲席摸了 2 张牌');
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.getByRole('button', { name: '查看武将技能说明' }).click();
  const skills = page.getByRole('dialog', { name: /演武客.*技能/ });
  await expect(skills).toContainText('闻策');
  await expect(skills).toContainText('武圣');
  await page.getByRole('button', { name: '关闭技能说明' }).click();
  await page.screenshot({
    path: `.artifacts/ui/author-package-${info.project.name}.png`,
    fullPage: true,
  });
});
test('映绯统一当前手牌红桃与武圣材料：自然黑桃闪可真实当杀，固定甲席', async ({ page }, info) => {
  await page.getByRole('checkbox', { name: '机制演武', exact: true }).check();
  await page.locator('[data-content-ready="true"]').waitFor();
  await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption('workshop:faces');
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('workshop:vermilion_guest');
  await page
    .getByRole('combobox', { name: 'AI 武将', exact: true })
    .selectOption('standard:guanyu');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('2');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(page.getByTestId('decision-hint')).toContainText('结束出牌');
  const material = page.getByTestId('card-face-card-26');
  await expect(material).toHaveAccessibleName(/闪.*♥/);
  await expect(material).toHaveClass(/red/);
  const before = await hand(page).count();
  await page.getByRole('button', { name: '查看武将技能说明' }).click();
  const skills = page.getByRole('dialog', { name: /绯衣客.*技能/ });
  await expect(skills).toContainText('映绯');
  await expect(skills).toContainText('黑桃');
  await page.getByRole('button', { name: '关闭技能说明' }).click();
  await page.screenshot({
    path: `.artifacts/ui/card-face-hand-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '武圣', exact: true }).click();
  await material.click();
  await selectTarget(page, 'target-乙席');
  await confirm(page).click();
  await expect(material).toHaveCount(0);
  await expect(hand(page)).toHaveCount(before - 1);
  await expect(page.getByTestId('journal')).toContainText('甲席使用【杀】');
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/card-face-use-${info.project.name}.png`,
    fullPage: true,
  });
});

test('首次真实 AI 伤害后拾慧获得余响并加入本次时点，学习与发动可在固定甲席完成', async ({
  page,
}, info) => {
  await page.getByRole('checkbox', { name: '机制演武', exact: true }).check();
  await page.locator('[data-content-ready="true"]').waitFor();
  await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption('workshop:defense');
  await startGeneral(page, 'workshop:inquirer', 2, 4, 'standard:guanyu');
  await reachOwnSkill(page, '结束出牌');
  await page.getByRole('button', { name: '结束出牌', exact: true }).click();
  await reachOwnSkill(page, '是否发动【余响】');
  const journal = page.getByTestId('journal');
  await expect(journal).toContainText('甲席发动【拾慧】');
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.getByRole('button', { name: '查看武将技能说明' }).click();
  const skills = page.getByRole('dialog', { name: /问道客.*技能/ });
  await expect(skills).toContainText('拾慧');
  await expect(skills).toContainText('余响');
  await page.getByRole('button', { name: '关闭技能说明' }).click();
  await page.screenshot({
    path: `.artifacts/ui/learned-skill-prompt-${info.project.name}.png`,
    fullPage: true,
  });
  const before = await hand(page).count();
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(journal).toContainText('甲席发动【余响】');
  await expect.poll(() => hand(page).count()).toBeGreaterThanOrEqual(before + 1);
  await expect(page.locator('.target-hitbox.self')).toHaveAttribute('data-testid', 'target-甲席');
  await page.screenshot({
    path: `.artifacts/ui/learned-skill-invoke-${info.project.name}.png`,
    fullPage: true,
  });
});

for (const accept of [false, true]) {
  test(`遗玉真实替换后以历史来源${accept ? '发动摸牌' : '拒绝发动'}，不重新获得装备能力`, async ({
    page,
  }, info) => {
    await page.getByRole('checkbox', { name: '机制演武', exact: true }).check();
    await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption('workshop:relics');
    await startGeneral(page, 'workshop:guest', 2, 10, 'standard:guanyu');
    await reachOwnSkill(page, '结束出牌');
    const before = await hand(page).count();
    const jade = page.getByTestId('hand-cards').getByTestId('card-relic-card-2');
    await expect(jade).toHaveAccessibleName(/遗玉/);
    await jade.click();
    await confirm(page).click();
    const equipment = page.getByTestId('equipment-甲席');
    await expect(equipment.getByRole('button', { name: /遗玉/ })).toHaveCount(1);
    await page.getByTestId('hand-cards').getByTestId('card-relic-card-14').click();
    await confirm(page).click();
    await expect(page.getByTestId('decision-hint')).toContainText('是否发动【玉碎】');
    await expect(equipment.getByRole('button', { name: /遗玉/ })).toHaveCount(0);
    await expect(equipment.getByRole('button', { name: /八卦阵/ })).toHaveCount(1);
    await expect(hand(page)).toHaveCount(before - 2);
    await page.getByRole('button', { name: accept ? '发动' : '不发动', exact: true }).click();
    await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
    await expect(hand(page)).toHaveCount(before - 2 + Number(accept));
    await expect(jade).toHaveCount(0);
    if (accept) await expect(page.getByTestId('journal')).toContainText('甲席发动【玉碎】');
    else await expect(page.getByTestId('journal')).not.toContainText('甲席发动【玉碎】');
    await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
    await page.screenshot({
      path: `.artifacts/ui/retained-equipment-${accept ? 'invoke' : 'decline'}-${info.project.name}.png`,
      fullPage: true,
    });
  });
}

test('缚阵公开连环标记、暂停恢复与引焰真实传播，固定甲席且不重复扣费', async ({ page }, info) => {
  await page.getByRole('checkbox', { name: '机制演武', exact: true }).check();
  await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption('workshop:chains');
  await startGeneral(page, 'standard:guanyu', 2, 4, 'standard:guanyu');
  await reachOwnSkill(page, '结束出牌');
  const before = await hand(page).count();
  const seats = ['甲席', '乙席'].map((id) => page.getByTestId(`target-${id}`));
  const hp = await Promise.all(
    seats.map(async (seat) =>
      Number((await seat.getAttribute('aria-label'))!.match(/体力(\d+)\//)![1]),
    ),
  );
  await page.getByTestId('hand-cards').getByTestId('card-chain-card-7').click();
  for (const seat of seats) await selectTarget(page, seat);
  await confirm(page).click();
  for (const seat of seats) {
    await expect(seat).toHaveAttribute('data-chained', 'true');
    await expect(seat).toHaveAccessibleName(/连环/);
  }
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  await expect(hand(page)).toHaveCount(0);
  for (const seat of seats) await expect(seat).toHaveAttribute('data-chained', 'true');
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await expectSeatTextToFit(page);
  await page.screenshot({
    path: `.artifacts/ui/chain-linked-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByTestId('hand-cards').getByTestId('card-chain-card-19').click();
  await selectTarget(page, seats[1]!);
  await confirm(page).click();
  for (const [index, seat] of seats.entries()) {
    await expect(seat).toHaveAttribute('data-chained', 'false');
    await expect(seat).toHaveAccessibleName(new RegExp(`体力${hp[index]! - 1}/`));
  }
  await expect(hand(page)).toHaveCount(before - 2);
  await expect(page.getByTestId('journal')).toContainText('乙席受到 1 点火焰伤害');
  await expect(page.getByTestId('journal')).toContainText('甲席受到 1 点火焰伤害');
  await expect(page.getByTestId('journal')).toContainText('连环传播');
  await expect(page.getByTestId('hand-cards').getByTestId('card-chain-card-7')).toHaveCount(0);
  await expect(page.getByTestId('hand-cards').getByTestId('card-chain-card-19')).toHaveCount(0);
  await expect(page.locator('.target-hitbox.self')).toHaveAttribute('data-testid', 'target-甲席');
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/chain-damage-${info.project.name}.png`,
    fullPage: true,
  });
});

test('凝障吸收连环传播，护盾与体力独立，暂停仍保留公共护盾标记', async ({ page }, info) => {
  await page.getByRole('checkbox', { name: '机制演武', exact: true }).check();
  await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption('workshop:defense');
  await startGeneral(page, 'standard:guanyu', 2, 4, 'standard:guanyu');
  await reachOwnSkill(page, '结束出牌');
  const own = page.getByTestId('target-甲席');
  const other = page.getByTestId('target-乙席');
  const before = await hand(page).count();
  await page.getByTestId('card-defense-card-7').click();
  await selectTarget(page, own);
  await confirm(page).click();
  await expect(own).toHaveAttribute('data-shield', '2');
  await expect(own).toHaveAccessibleName(/护盾2/);
  await page.getByTestId('card-defense-card-11').click();
  await selectTarget(page, own);
  await selectTarget(page, other);
  await confirm(page).click();
  await expect(own).toHaveAttribute('data-chained', 'true');
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  await expect(hand(page)).toHaveCount(0);
  await expect(own).toHaveAttribute('data-shield', '2');
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await page.screenshot({
    path: `.artifacts/ui/shield-linked-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByTestId('card-defense-card-19').click();
  await selectTarget(page, other);
  await confirm(page).click();
  await expect(own).toHaveAttribute('data-shield', '1');
  await expect(own).toHaveAccessibleName(/体力4\/4/);
  await expect(other).toHaveAccessibleName(/体力3\/4/);
  await expect(own).toHaveAttribute('data-chained', 'false');
  await expect(other).toHaveAttribute('data-chained', 'false');
  await expect(hand(page)).toHaveCount(before - 3);
  await expect(page.getByTestId('journal')).toContainText('护盾吸收 1 点');
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await expectSeatTextToFit(page);
  await page.screenshot({
    path: `.artifacts/ui/shield-absorbed-${info.project.name}.png`,
    fullPage: true,
  });
});

for (const accept of [false, true]) {
  test(`非主控 AI 真实攻击，人类代受${accept ? '支付并转移' : '取消不支付'}`, async ({
    page,
  }, info) => {
    await page.getByRole('checkbox', { name: '机制演武', exact: true }).check();
    await page
      .getByRole('combobox', { name: '牌组', exact: true })
      .selectOption('workshop:defense');
    await startGeneral(page, 'workshop:guardian', 2, 4, 'standard:guanyu');
    await reachOwnSkill(page, '结束出牌');
    await page.getByRole('button', { name: '结束出牌', exact: true }).click();
    await reachOwnSkill(page, '代受：');
    await expect(page.locator('[data-decision-kind="cards-targets"]')).toBeVisible();
    const own = page.getByTestId('target-甲席');
    const other = page.getByTestId('target-乙席');
    const before = await hand(page).count();
    const hp = Number((await own.getAttribute('aria-label'))!.match(/体力(\d+)\//)![1]);
    if (accept) {
      await hand(page).first().click();
      await selectTarget(page, other);
      await confirm(page).click();
      await expect(page.getByTestId('journal')).toContainText('甲席将 1 点伤害转移给乙席');
      await expect(own).toHaveAccessibleName(new RegExp(`体力${hp}/`));
      await expect(hand(page)).toHaveCount(before - 1);
    } else {
      await page.getByRole('button', { name: '不发动代受', exact: true }).click();
      await expect(own).toHaveAccessibleName(new RegExp(`体力${hp - 1}/`));
      await expect(hand(page)).toHaveCount(before);
      await expect(page.getByTestId('journal')).not.toContainText('甲席将 1 点伤害转移给乙席');
    }
    await page.getByRole('button', { name: '暂停对局', exact: true }).click();
    await expect(page.locator('.target-hitbox.self')).toHaveAttribute('data-testid', 'target-甲席');
    await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
    await page.screenshot({
      path: `.artifacts/ui/damage-transfer-${accept ? 'accept' : 'decline'}-${info.project.name}.png`,
      fullPage: true,
    });
  });
}

async function startGeneral(
  page: Page,
  general: string,
  count: number,
  seed: number,
  ai = 'preset',
) {
  await page.getByRole('combobox', { name: '你的武将', exact: true }).selectOption(general);
  await page.getByRole('combobox', { name: 'AI 武将', exact: true }).selectOption(ai);
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption(String(count));
  await page.getByRole('spinbutton').fill(String(seed));
  await page.getByRole('button', { name: '开始单机对局' }).click();
}
async function passDevice(page: Page) {
  await expect(page.getByRole('dialog', { name: /请交给/ })).toBeVisible();
  await expect(hand(page)).toHaveCount(0);
  await expect(page.getByTestId('own-role')).toHaveCount(0);
  await page.getByRole('button', { name: /我是.*查看手牌/ }).click();
}
async function start(
  page: Page,
  count = 4,
  seed = 27,
  preset: 'standard:identity' | 'standard:mechanics' = 'standard:mechanics',
) {
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption(String(count));
  await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption(preset);
  await page.getByRole('spinbutton').fill(String(seed));
  await page.getByRole('checkbox', { name: '手动演练（内容调试）' }).check();
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await passDevice(page);
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
}
async function discard(page: Page, keepRed = false) {
  const prompt = await page.getByTestId('decision-hint').textContent();
  const amount = Number(prompt?.match(/弃置 (\d+)/)?.[1]);
  expect(amount).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '放弃响应', exact: true })).toBeDisabled();
  const cards = keepRed
    ? [
        ...(await page.getByTestId('hand-cards').locator('button:not(.red)').all()),
        ...(await page.getByTestId('hand-cards').locator('button.red').all()),
      ]
    : await hand(page).all();
  for (let i = 0; i < amount; i++) await cards[i]!.click();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
}
async function endTurn(page: Page) {
  await page.getByRole('button', { name: '结束出牌', exact: true }).click();
  await expect(page.locator('[data-decision-kind="cards-targets"]')).toBeVisible();
  await discard(page);
  await passDevice(page);
}

/** 通过正式出牌/响应推进到人类技能，不注入状态或修改随机牌序。 */
async function reachOwnSkill(
  page: Page,
  wanted: string,
  installArmor = false,
  fromJournal = false,
) {
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
      await expect(page.getByRole('region', { name: '对局结果' })).toHaveCount(0);
      continue;
    }
    if ((await page.getByTestId('decision-hint').textContent())?.includes(wanted)) return;
    const namedAction = page.getByRole('button', { name: wanted, exact: true });
    if ((await namedAction.count()) && (await namedAction.isEnabled())) return;
    if (kind === 'play-action') {
      if (installArmor && !installed) {
        await hand(page)
          .filter({ has: page.locator('.card-name', { hasText: '八卦阵' }) })
          .first()
          .click();
        await confirm(page).click();
        await expect(
          page.getByTestId('equipment-甲席').getByRole('button', { name: /^八卦阵 / }),
        ).toBeVisible();
        installed = true;
      } else await page.getByRole('button', { name: '结束出牌', exact: true }).click();
    } else if (kind === 'invoke') {
      const armor = (await page.getByTestId('decision-hint').textContent())?.includes('八卦阵');
      await page.getByRole('button', { name: armor ? '发动' : '不发动', exact: true }).click();
    } else if (kind === 'cards-targets') {
      if (await page.locator('.decision-actions .cancel-button').isEnabled())
        await page.locator('.decision-actions .cancel-button').click();
      else if (await page.locator('.public-pools button[aria-disabled="false"]').count()) {
        await page.locator('.public-pools button[aria-disabled="false"]').first().click();
        await confirm(page).click();
      } else await discard(page, wanted === '濒死');
    } else if (kind === 'card-response' || kind === 'use-card') {
      await page.locator('.decision-actions .cancel-button').click();
    } else throw new Error(`Unexpected decision before ${wanted}: ${kind}`);
  }
  throw new Error(`Skill not reached: ${wanted}`);
}

test('默认固定甲席与基础 AI；暂停藏牌、后台等待及继续不切换席位', async ({ page }, info) => {
  await expect(page.getByRole('checkbox', { name: '手动演练（内容调试）' })).not.toBeChecked();
  await page
    .getByRole('combobox', { name: '牌组', exact: true })
    .selectOption('standard:mechanics');
  await page.getByRole('spinbutton').fill('4');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await expect(page.locator('.target-hitbox.self')).toHaveAttribute('data-testid', 'target-甲席');
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await expect(page.getByTestId('own-role')).toHaveText('主公');
  const cards = await hand(page).count();
  const material = page.getByTestId('hand-cards').locator('button[aria-disabled="false"]').first();
  await material.click();
  const selected = page.getByTestId('hand-cards').locator('button[aria-pressed="true"]');
  await expect(selected).toHaveCount(1);
  const cardId = await selected.getAttribute('data-testid');
  const decision = await page.locator('[data-decision-key]').getAttribute('data-decision-key');
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '对局已暂停' })).toBeVisible();
  await expect(hand(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '对局已暂停' })).toBeVisible();
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await expect(hand(page)).toHaveCount(cards);
  await expect(selected).toHaveAttribute('data-testid', cardId!);
  await expect(page.locator('[data-decision-key]')).toHaveAttribute('data-decision-key', decision!);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('dialog', { name: '对局已暂停' })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await expect(hand(page)).toHaveCount(cards);
  await expect(selected).toHaveAttribute('data-testid', cardId!);
  await expect(page.locator('[data-decision-key]')).toHaveAttribute('data-decision-key', decision!);
  await page.screenshot({
    path: `.artifacts/ui/solo-table-${info.project.name}.png`,
    fullPage: true,
  });
});

test('选择黄盖，苦肉明确确认后失去体力并摸牌，同阶段可再次发动', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:huanggai');
  await page
    .getByRole('combobox', { name: '牌组', exact: true })
    .selectOption('standard:mechanics');
  await page.getByRole('spinbutton').fill('4');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/甲席·黄盖.*体力4\/4/);
  const initialCards = await hand(page).count();
  await page.getByRole('button', { name: '苦肉', exact: true }).click();
  await expect(confirm(page)).toBeEnabled();
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/体力4\/4/);
  await confirm(page).click();
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/体力3\/4/);
  await expect(hand(page)).toHaveCount(initialCards + 2);
  await expect(page.getByTestId('journal')).toContainText('甲席发动【苦肉】');
  await page.getByRole('button', { name: '苦肉', exact: true }).click();
  await confirm(page).click();
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/体力2\/4/);
  await expect(hand(page)).toHaveCount(initialCards + 4);
  await page.screenshot({
    path: `.artifacts/ui/general-huanggai-${info.project.name}.png`,
    fullPage: true,
  });
});

for (const accept of [true, false]) {
  test(`许褚摸牌前选择裸衣：${accept ? '少摸一张' : '保留两张'}，单机视角保持甲席`, async ({
    page,
  }, info) => {
    await page
      .getByRole('combobox', { name: '你的武将', exact: true })
      .selectOption('standard:xuchu');
    await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
    await page.getByRole('spinbutton').fill('42');
    await page.getByRole('button', { name: '开始单机对局' }).click();
    await expect(page.locator('[data-decision-kind="invoke"]')).toBeVisible();
    await expect(page.getByTestId('decision-hint')).toContainText('裸衣');
    await expect(hand(page)).toHaveCount(4);
    await page.getByRole('button', { name: accept ? '发动' : '不发动', exact: true }).click();
    await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
    await expect(hand(page)).toHaveCount(accept ? 5 : 6);
    await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/甲席·许褚/);
    await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
    if (accept) await expect(page.getByTestId('journal')).toContainText('甲席发动【裸衣】');
    else await expect(page.getByTestId('journal')).not.toContainText('甲席发动【裸衣】');
    await page.screenshot({
      path: `.artifacts/ui/general-xuchu-${accept ? 'accept' : 'decline'}-${info.project.name}.png`,
      fullPage: true,
    });
  });
}

test('甄姬准备阶段发动洛神，黑判定牌归手，可主动停止后正常摸牌', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:zhenji');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('4');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(page.getByTestId('decision-hint')).toContainText('洛神');
  await expect(hand(page)).toHaveCount(4);
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(page.getByTestId('decision-hint')).toContainText('是否继续【洛神】');
  await expect(hand(page)).toHaveCount(5);
  await expect(page.getByTestId('journal')).toContainText('甲席获得判定牌');
  await page.getByRole('button', { name: '不发动', exact: true }).click();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await expect(hand(page)).toHaveCount(7);
  await expect(page.getByRole('button', { name: '倾国', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '查看武将技能说明', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '甄姬 · 技能' })).toContainText('倾国');
  await page.screenshot({
    path: `.artifacts/ui/general-zhenji-${info.project.name}.png`,
    fullPage: true,
  });
});

test('司马懿以真实手牌鬼才改判八卦，移动材料并记录技能宣告', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:simayi');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('23');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '鬼才：', true);
  const chosen = hand(page).first();
  const id = await chosen.getAttribute('data-testid');
  await chosen.click();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText('甲席发动【鬼才】');
  await expect(page.getByTestId('hand-cards').getByTestId(id!)).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/general-simayi-${info.project.name}.png`,
    fullPage: true,
  });
  await reachOwnSkill(page, '反馈：');
  const decision = page.locator('.decision-bar');
  await expect(decision).toHaveAttribute('data-decision-kind', 'cards-targets');
  const key = await decision.getAttribute('data-decision-key');
  const count = await hand(page).count();
  await expect(page.getByRole('button', { name: '发动', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '不发动', exact: true })).toBeEnabled();
  await expect(confirm(page)).toBeDisabled();
  const picker = page.getByTestId('owned-card-picker');
  await expect(picker.getByRole('heading', { name: '乙席 · 手牌' })).toBeVisible();
  await expect(picker.getByRole('heading', { name: '乙席 · 装备' })).toBeAttached();
  await expect(picker.locator('.card-back').first()).toBeVisible();
  await expect(picker.getByRole('button', { name: '大宛 ♠K', exact: true })).toBeAttached();
  await page.locator('.choice-options button').first().click();
  await page.locator('.choice-options button').last().click();
  await expect(page.locator('.choice-options button').last()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.choice-options button').first()).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(decision).toHaveAttribute('data-decision-key', key!);
  await expect(page.getByTestId('journal')).not.toContainText('甲席发动【反馈】');
  await expect(hand(page)).toHaveCount(count);
  await expect(confirm(page)).toBeEnabled();
  await picker.locator('button').last().dispatchEvent('contextmenu');
  await expect(page.getByRole('dialog', { name: '【的卢】' })).toBeVisible();
  await page.getByRole('button', { name: '返回选择', exact: true }).click();
  await expect(decision).toHaveAttribute('data-decision-key', key!);
  await expect(picker.locator('button').last()).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({
    path: `.artifacts/ui/general-fankui-draft-${info.project.name}.png`,
    fullPage: true,
  });
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText('甲席发动【反馈】');
  await expect(hand(page)).toHaveCount(count + 1);
});

test('双司马懿按当前乙席回合先后鬼才，甲席随后改判八卦完成响应', async ({ page }, info) => {
  await startGeneral(page, 'standard:simayi', 2, 59, 'standard:simayi');
  await reachOwnSkill(page, '鬼才：', true);
  await expect(page.locator('.turn-label')).toContainText('乙席');
  await expect(page.getByTestId('decision-hint')).toContainText('替换 甲席 的判定牌');
  await expect(page.getByTestId('journal')).toContainText('乙席发动【鬼才】');
  await expect(page.getByTestId('journal')).not.toContainText('甲席发动【鬼才】');
  const vitality = (await page.getByTestId('target-甲席').getAttribute('aria-label'))!.match(
    /体力\d+\/\d+/,
  )![0];
  await expect(
    hand(page).filter({ has: page.locator('.card-name').filter({ hasText: /^闪$/ }) }),
  ).toHaveCount(0);
  const material = page
    .getByTestId('hand-cards')
    .getByRole('button', { name: '桃 ♥4', exact: true });
  const materialId = await material.getAttribute('data-testid');
  await material.click();
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText('甲席的八卦阵结果：♥4【桃】');
  await expect(page.getByTestId('journal')).toContainText('甲席使用【闪】');
  const sequence = async (label: string) =>
    Number(
      (await page
        .getByTestId('journal')
        .locator('.journal-entry')
        .filter({ hasText: label })
        .first()
        .locator('small')
        .textContent())!.slice(1),
    );
  expect(await sequence('乙席发动【鬼才】')).toBeLessThan(await sequence('甲席发动【鬼才】'));
  await expect(page.getByTestId('target-甲席')).toHaveAttribute('aria-label', new RegExp(vitality));
  await expect(page.getByTestId('hand-cards').getByTestId(materialId!)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/action-order-guicai-${info.project.name}.png`,
    fullPage: true,
  });
});

test('郭嘉遗计私有池可分批交牌，暂停隐藏池牌，保留余牌后才进入手牌', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:guojia');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('27');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '是否发动【遗计】');
  const before = await hand(page).count();
  await page.getByRole('button', { name: '发动', exact: true }).click();
  const pool = page.getByRole('group', { name: '仅本人可见的牌池', exact: true });
  await expect(pool.locator('button')).toHaveCount(2);
  await expect(hand(page)).toHaveCount(before);
  const poolBox = await pool.boundingBox();
  const decisionBox = await page.locator('.decision-bar').boundingBox();
  expect(poolBox!.y + poolBox!.height).toBeLessThanOrEqual(decisionBox!.y + 1);
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  await expect(pool).toHaveCount(0);
  await expect(hand(page)).toHaveCount(0);
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await expect(pool.locator('button')).toHaveCount(2);
  await page.screenshot({
    path: `.artifacts/ui/general-guojia-private-${info.project.name}.png`,
    fullPage: true,
  });
  await pool.locator('button').first().click();
  await selectTarget(page, 'target-乙席');
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await expect(pool.locator('button')).toHaveCount(1);
  await page.getByRole('button', { name: '保留余牌', exact: true }).click();
  await expect(pool).toHaveCount(0);
  await expect(hand(page)).toHaveCount(before + 1);
  await expect(page.getByTestId('journal')).toContainText('甲席将 1 张牌交给 乙席');
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
});

test('许褚 AI 裸衣造成两点真实伤害，郭嘉逐次遗计并分别处置私有牌池', async ({ page }, info) => {
  await startGeneral(page, 'standard:guojia', 2, 1, 'standard:xuchu');
  await reachOwnSkill(page, '是否发动【遗计】');
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/体力1\/3/);
  await expect(page.getByTestId('decision-hint')).toContainText('第 1/2 次');
  await expect(page.getByTestId('journal')).toContainText('乙席发动【裸衣】');
  const before = await hand(page).count();
  const pool = page.getByRole('group', { name: '仅本人可见的牌池', exact: true });
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(pool.locator('button')).toHaveCount(2);
  const retained = await pool
    .locator('button')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''));
  await page.getByRole('button', { name: '保留余牌', exact: true }).click();
  await expect(hand(page)).toHaveCount(before + 2);
  await expect(page.getByTestId('decision-hint')).toContainText('第 2/2 次');
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(pool.locator('button')).toHaveCount(2);
  retained.push(
    ...(await pool
      .locator('button')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''))),
  );
  await page.screenshot({
    path: `.artifacts/ui/general-yiji-occurrences-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '保留余牌', exact: true }).click();
  await expect(pool).toHaveCount(0);
  expect(new Set(retained).size).toBe(4);
  // 最后一次遗计不再暂停结算；甲席的后续正常摸牌可能已经完成，核对四张真实材料。
  for (const id of retained)
    await expect(page.getByTestId('hand-cards').getByTestId(id)).toBeAttached();
  await expect(
    page
      .getByTestId('journal')
      .locator('.journal-entry')
      .filter({ hasText: '甲席将 2 张牌交给 甲席' }),
  ).toHaveCount(2);
  expect(
    (await page.getByTestId('journal').textContent())?.match(/甲席发动【遗计】/g),
  ).toHaveLength(2);
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  await expect(pool).toHaveCount(0);
});

test('郭嘉天妒取得八卦最终判定牌，之后继续原响应', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:guojia');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('23');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '是否发动【天妒】', true);
  const before = await hand(page).count();
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(page.getByTestId('journal')).toContainText('甲席获得判定牌');
  await expect(hand(page)).toHaveCount(before + 1);
  await page.screenshot({
    path: `.artifacts/ui/general-guojia-tiandu-${info.project.name}.png`,
    fullPage: true,
  });
});

for (const accept of [true, false]) {
  test(`张辽突袭${accept ? '暗取手牌替代摸牌' : '取消后正常摸牌'}`, async ({ page }, info) => {
    await page
      .getByRole('combobox', { name: '你的武将', exact: true })
      .selectOption('standard:zhangliao');
    await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
    await page.getByRole('spinbutton').fill('42');
    await page.getByRole('button', { name: '开始单机对局' }).click();
    await expect(page.getByTestId('decision-hint')).toContainText('突袭：');
    await expect(hand(page)).toHaveCount(4);
    if (accept) {
      await selectTarget(page, 'target-乙席');
      await confirm(page).click();
      const choices = page.locator('.choice-options button');
      await expect(choices).toHaveCount(4);
      for (const option of await choices.all()) await expect(option).toHaveText(/未知手牌/);
      await choices.first().click();
      await confirm(page).click();
      await expect(page.getByTestId('journal')).toContainText('甲席从 乙席 获得一张手牌');
    } else await page.getByRole('button', { name: '正常摸牌', exact: true }).click();
    await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
    await expect(hand(page)).toHaveCount(accept ? 5 : 6);
    await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
    await page.screenshot({
      path: `.artifacts/ui/general-zhangliao-${accept ? 'accept' : 'decline'}-${info.project.name}.png`,
      fullPage: true,
    });
  });
}
test('曹操奸雄从真实伤害取得材料，供牌未发生时护驾说明仍可查看', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:caocao');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('27');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '是否发动【奸雄】');
  const before = await hand(page).count();
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(page.getByTestId('journal')).toContainText('甲席获得造成伤害的材料牌');
  await expect(hand(page)).toHaveCount(before + 1);
  await page.getByRole('button', { name: '查看武将技能说明', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '曹操 · 技能' });
  await expect(dialog).toContainText('护驾');
  await page.screenshot({
    path: `.artifacts/ui/general-caocao-${info.project.name}.png`,
    fullPage: true,
  });
});
test('曹操主公请求护驾，由基础 AI 的魏角色实际供闪', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:caocao');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('8');
  await page.getByRole('spinbutton').fill('8');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '是否发动【护驾】');
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(page.getByTestId('journal')).toContainText('为甲席打出【闪】');
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/general-hujia-${info.project.name}.png`,
    fullPage: true,
  });
});

test('刘备仁德从手牌交出两张，公开记录只说明数量和接收者', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:liubei');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('42');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(page.locator('.decision-bar')).toHaveAttribute('data-decision-kind', 'play-action');
  const decisionKey = await page.locator('.decision-bar').getAttribute('data-decision-key');
  await page.getByRole('button', { name: '仁德', exact: true }).click();
  await expect(page.getByTestId('target-乙席')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('decision-hint')).toContainText('仁德：');
  const before = await hand(page).count();
  await hand(page).nth(0).click();
  await hand(page).nth(1).click();
  await expect(confirm(page)).toBeEnabled();
  await page.getByTestId('target-乙席').click();
  await expect(confirm(page)).toBeDisabled();
  await expect(page.getByTestId('target-乙席')).toHaveAttribute('aria-pressed', 'false');
  await selectTarget(page, 'target-乙席');
  await expect(page.locator('.decision-bar')).toHaveAttribute('data-decision-key', decisionKey!);
  await expect(page.getByTestId('journal')).not.toContainText('甲席发动【仁德】');
  await page.screenshot({
    path: `.artifacts/ui/general-liubei-rende-${info.project.name}.png`,
    fullPage: true,
  });
  await confirm(page).click();
  await expect(hand(page)).toHaveCount(before - 2);
  await expect(page.getByTestId('journal')).toContainText('甲席发动【仁德】，将 2 张牌交给 乙席');
});
test('刘备激将由真实蜀 AI 供杀，刘备使用并占用本阶段杀次数', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:liubei');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('4');
  await page.getByRole('spinbutton').fill('6');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await page.getByRole('button', { name: '激将', exact: true }).click();
  await selectTarget(page, 'target-乙席');
  const before = await hand(page).count();
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText('丁席为甲席打出【杀】');
  await expect(page.getByTestId('journal')).toContainText('甲席使用【杀】');
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await expect(hand(page)).toHaveCount(before);
  await page.screenshot({
    path: `.artifacts/ui/general-liubei-jijiang-${info.project.name}.png`,
    fullPage: true,
  });
});
test('华佗青囊以真实手牌费用治疗受伤角色', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:huatuo');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('27');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '青囊');
  let target = '';
  let hp = 0;
  for (const id of ['甲席', '乙席']) {
    const vitality = (await page.getByTestId(`target-${id}`).getAttribute('aria-label'))!.match(
      /体力(\d+)\/(\d+)/,
    )!;
    if (Number(vitality[1]) < Number(vitality[2])) {
      target = id;
      hp = Number(vitality[1]);
      break;
    }
  }
  expect(target).not.toBe('');
  await page.getByRole('button', { name: '青囊', exact: true }).click();
  const before = await hand(page).count();
  await hand(page).first().click();
  await selectTarget(page, `target-${target}`);
  await confirm(page).click();
  await expect(page.getByTestId(`target-${target}`)).toHaveAccessibleName(
    new RegExp(`体力${hp + 1}/`),
  );
  await expect(hand(page)).toHaveCount(before - 1);
  await expect(page.getByRole('button', { name: '青囊', exact: true })).toBeDisabled();
  await page.screenshot({
    path: `.artifacts/ui/general-huatuo-qingnang-${info.project.name}.png`,
    fullPage: true,
  });
});
test('华佗回合外急救将红牌当桃，用真实救援脱离濒死', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:huatuo');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('2');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '濒死');
  await page.getByRole('button', { name: '急救', exact: true }).click();
  await page.getByTestId('hand-cards').locator('button[aria-disabled="false"]').first().click();
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText('甲席使用【桃】');
  await page.screenshot({
    path: `.artifacts/ui/general-huatuo-jijiu-${info.project.name}.png`,
    fullPage: true,
  });
});

test('孙权制衡弃置两张手牌并摸回两张，本阶段只能一次', async ({ page }, info) => {
  await page.evaluate(() => {
    const probe = {
      plays: [] as string[],
      playing: [] as string[],
      elements: [] as HTMLMediaElement[],
    };
    Reflect.set(window, 'sgsAudioProbe', probe);
    const play = Reflect.get(HTMLMediaElement.prototype, 'play');
    HTMLMediaElement.prototype.play = function () {
      probe.plays.push(this.src);
      if (!probe.elements.includes(this)) {
        probe.elements.push(this);
        this.addEventListener('playing', () => probe.playing.push(this.src));
      }
      return play.call(this);
    };
  });
  const soundState = () =>
    page.evaluate(() => {
      const probe = Reflect.get(window, 'sgsAudioProbe') as {
        plays: string[];
        playing: string[];
        elements: HTMLMediaElement[];
      };
      return {
        plays: probe.plays,
        playing: probe.playing,
        paused: probe.elements.every((element) => element.paused),
      };
    });
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:sunquan');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('42');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  const decision = page.locator('.decision-bar');
  await expect(decision).toHaveAttribute('data-decision-kind', 'play-action');
  await expect
    .poll(async () => (await soundState()).playing.some((url) => url.includes('gamestart')))
    .toBe(true);
  const key = await decision.getAttribute('data-decision-key');
  await page.getByRole('button', { name: '制衡', exact: true }).click();
  const skillKeyBox = await page.getByRole('button', { name: '制衡', exact: true }).boundingBox();
  expect(skillKeyBox?.width).toBeLessThanOrEqual(82);
  expect(skillKeyBox?.height).toBeLessThanOrEqual(45);
  await expect(confirm(page)).toBeDisabled();
  const before = await hand(page).count();
  const first = await hand(page).nth(0).getAttribute('data-testid');
  const second = await hand(page).nth(1).getAttribute('data-testid');
  await hand(page).nth(0).click();
  await hand(page).nth(1).click();
  await expect(decision).toHaveAttribute('data-decision-key', key!);
  await expect(page.getByRole('button', { name: /^制衡/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('journal')).not.toContainText('甲席发动【制衡】');
  expect((await soundState()).plays.filter((url) => url.includes('zhiheng'))).toHaveLength(0);
  // 技能说明是命令，原生 Enter 不能被草稿提交快捷键抢占。
  await page.getByRole('button', { name: '查看救援技能说明', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '关闭技能说明', exact: true })).toBeVisible();
  await expect(decision).toHaveAttribute('data-decision-key', key!);
  await expect(hand(page)).toHaveCount(before);
  await page.getByRole('button', { name: '关闭技能说明', exact: true }).click();
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await expect(decision).toHaveAttribute('data-decision-key', key!);
  await expect(hand(page)).toHaveCount(before);
  await page.getByRole('button', { name: '制衡', exact: true }).click();
  await hand(page).nth(0).click();
  await hand(page).nth(1).click();
  expect((await soundState()).plays.filter((url) => url.includes('zhiheng'))).toHaveLength(0);
  await page.screenshot({
    path: `.artifacts/ui/general-sunquan-${info.project.name}.png`,
    fullPage: true,
  });
  await confirm(page).click();
  await expect(hand(page)).toHaveCount(before);
  await expect(page.getByTestId('hand-cards').getByTestId(first!)).toHaveCount(0);
  await expect(page.getByTestId('hand-cards').getByTestId(second!)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '制衡', exact: true })).toBeDisabled();
  await expect
    .poll(async () => (await soundState()).playing.some((url) => url.includes('zhiheng')))
    .toBe(true);
  const played = (await soundState()).plays;
  expect(played.filter((url) => url.includes('zhiheng'))).toHaveLength(1);
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  await expect.poll(async () => (await soundState()).paused).toBe(true);
  const pausedPlays = (await soundState()).plays;
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  expect((await soundState()).plays).toEqual(pausedPlays);
  await page.getByRole('button', { name: '音效与语音', exact: true }).click();
  await expect(page.getByRole('button', { name: '音效与语音', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect.poll(async () => (await soundState()).paused).toBe(true);
});
test('吕蒙不出杀，克己在费用宣告后跳过弃牌阶段', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:lvmeng');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('42');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await page.getByRole('button', { name: '结束出牌', exact: true }).click();
  await expect(page.getByTestId('decision-hint')).toContainText('是否发动【克己】');
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(page.getByTestId('journal')).toContainText('甲席跳过了弃牌阶段');
  await page.screenshot({
    path: `.artifacts/ui/general-lvmeng-${info.project.name}.png`,
    fullPage: true,
  });
});
test('陆逊真实失去最后手牌后连营补牌，可查看谦逊说明', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:luxun');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('5');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '是否发动【连营】');
  await expect(hand(page)).toHaveCount(0);
  await page.getByRole('button', { name: '查看武将技能说明', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '陆逊 · 技能' })).toContainText('谦逊');
  await page.screenshot({
    path: `.artifacts/ui/general-luxun-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '关闭技能说明', exact: true }).click();
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(page.getByTestId('journal')).toContainText('甲席发动【连营】');
  await expect(page.getByTestId('journal')).toContainText('甲席摸了 1 张牌');
});
test('孙权主公由吴 AI 用桃救援，实际回复两点体力', async ({ page }, info) => {
  test.setTimeout(90000);
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:sunquan');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('4');
  await page.getByRole('spinbutton').fill('68');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '甲席回复 2 点体力', false, true);
  await expect(page.getByText(/尚未开局/)).toHaveCount(0);
  await page.getByRole('button', { name: '结算记录', exact: true }).click();
  await expect(page.getByTestId('journal')).toContainText('甲席回复 2 点体力');
  const firstMessage = page.getByTestId('journal').locator('.journal-entry p').first();
  await expect(firstMessage).toBeInViewport();
  // AI 仍会追加日志；同一求值读取两个矩形，避免跨帧比较不同布局。
  await expect
    .poll(() =>
      page.getByTestId('journal').evaluate((body) => {
        const message = body.querySelector('.journal-entry p');
        if (!message) return false;
        const outer = body.getBoundingClientRect(),
          inner = message.getBoundingClientRect();
        return inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: `.artifacts/ui/general-jiuyuan-${info.project.name}.png`,
    fullPage: true,
  });
});

test('黄月英使用普通锦囊触发集智，在牌效果前实际摸牌', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:huangyueying');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('1');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '结束出牌');
  const before = await hand(page).count();
  await hand(page)
    .filter({ has: page.locator('.card-name', { hasText: '过河拆桥' }) })
    .click();
  await selectTarget(page, 'target-乙席');
  await confirm(page).click();
  await expect(page.getByTestId('decision-hint')).toContainText('集智');
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(page.getByTestId('journal')).toContainText('甲席发动【集智】');
  await expect(page.getByTestId('journal')).toContainText('甲席摸了 1 张牌');
  await expect(hand(page)).toHaveCount(before);
  await page.screenshot({
    path: `.artifacts/ui/general-jizhi-${info.project.name}.png`,
    fullPage: true,
  });
});
test('吕布无双杀令基础 AI 实际连续使用两张闪', async ({ page }, info) => {
  await page.getByRole('combobox', { name: '你的武将', exact: true }).selectOption('standard:lvbu');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('2');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '结束出牌');
  await hand(page)
    .filter({ has: page.locator('.card-name', { hasText: /^杀$/ }) })
    .first()
    .click();
  await selectTarget(page, 'target-乙席');
  await confirm(page).click();
  await expect(
    page.getByTestId('journal').locator('.journal-entry').filter({ hasText: '乙席使用【闪】' }),
  ).toHaveCount(2);
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/体力4\/4/);
  await page.screenshot({
    path: `.artifacts/ui/general-wushuang-${info.project.name}.png`,
    fullPage: true,
  });
});
test('大乔国色把方块牌作为乐不思蜀放置，材料离手且延时区展示正确', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:daqiao');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('42');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '结束出牌');
  await page.getByRole('button', { name: '国色', exact: true }).click();
  const material = page.getByTestId('hand-cards').locator('button[aria-disabled="false"]').first();
  const id = await material.getAttribute('data-testid');
  await material.click();
  await selectTarget(page, 'target-乙席');
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText('甲席使用【乐不思蜀】');
  await expect(page.getByTestId('hand-cards').getByTestId(id!)).toHaveCount(0);
  await expect(page.getByTestId('judgment-乙席')).toContainText('乐');
  await page.screenshot({
    path: `.artifacts/ui/general-guose-${info.project.name}.png`,
    fullPage: true,
  });
});
test('大乔流离同时支付与转移，记录和桌面牌指向新目标', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:daqiao');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('4');
  await page.getByRole('spinbutton').fill('1');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await reachOwnSkill(page, '流离：');
  const material = page.getByTestId('hand-cards').locator('button[aria-disabled="false"]').first();
  const id = await material.getAttribute('data-testid');
  await selectTarget(page, 'target-乙席');
  await material.click();
  await confirm(page).click();
  // 紧凑横屏会隐藏桌面牌；其公开模型仍须标注新的目标。
  await expect(
    page.getByTestId('table-cards').locator('[aria-label$="杀 → 乙席"]').first(),
  ).toBeAttached();
  await expect(page.getByTestId('journal')).toContainText('将杀从 甲席 转移给 乙席');
  await expect(page.getByTestId('hand-cards').getByTestId(id!)).toHaveCount(0);
  await expect(page.getByTestId('journal')).toContainText('甲席发动【流离】');
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/general-liuli-${info.project.name}.png`,
    fullPage: true,
  });
});

test('马超铁骑红判定禁止 AI 响应，实际扣血且不消耗其手牌', async ({ page }, info) => {
  await startGeneral(page, 'standard:machao', 2, 2);
  await reachOwnSkill(page, '结束出牌');
  const before = await page.getByTestId('target-乙席').getAttribute('aria-label');
  await hand(page)
    .filter({ has: page.locator('.card-name', { hasText: /^杀$/ }) })
    .first()
    .click();
  await selectTarget(page, 'target-乙席');
  await confirm(page).click();
  await expect(page.getByTestId('decision-hint')).toContainText('铁骑');
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/体力3\/4/);
  expect(before).toContain('手牌4');
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/手牌4/);
  await expect(page.getByTestId('journal')).not.toContainText('乙席打出【闪】');
  await expect(page.getByTestId('journal')).not.toContainText('乙席使用【闪】');
  await page.screenshot({
    path: `.artifacts/ui/general-tieqi-${info.project.name}.png`,
    fullPage: true,
  });
});
test('周瑜英姿多摸一张，反间令 AI 猜花色并暗取真实手牌', async ({ page }, info) => {
  await startGeneral(page, 'standard:zhouyu', 2, 1);
  await reachOwnSkill(page, '是否发动【英姿】');
  const beforeDraw = await hand(page).count();
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(hand(page)).toHaveCount(beforeDraw + 3);
  await page.getByRole('button', { name: '反间', exact: true }).click();
  await selectTarget(page, 'target-乙席');
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText('乙席为反间选择黑桃');
  await expect(page.getByTestId('journal')).toContainText('甲席将 1 张牌交给 乙席，公开：');
  await expect(hand(page)).toHaveCount(beforeDraw + 2);
  await expect(page.getByRole('button', { name: '反间', exact: true })).toBeDisabled();
  await page.screenshot({
    path: `.artifacts/ui/general-yingzi-fanjian-${info.project.name}.png`,
    fullPage: true,
  });
});
test('指定周瑜 AI 后本人以具名选项猜花色，暗选后公开获得并受伤', async ({ page }, info) => {
  await startGeneral(page, 'standard:guanyu', 2, 1, 'standard:zhouyu');
  await reachOwnSkill(page, '反间：先猜一种花色');
  const before = await hand(page).count();
  await expect(page.getByRole('button', { name: '♠ 黑桃', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '♦ 方块', exact: true })).toBeInViewport();
  await expect(page.locator('.decision-copy')).toContainText('请选择上方的一项');
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  await expect(hand(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '♠ 黑桃', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await expect(hand(page)).toHaveCount(before);
  await page.screenshot({
    path: `.artifacts/ui/general-fanjian-guess-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '♠ 黑桃', exact: true }).click();
  await page.getByRole('button', { name: '未知手牌 1', exact: true }).click();
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText(
    '乙席将 1 张牌交给 甲席，公开：【闪】♦2',
  );
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/体力2\/4/);
  await expect(hand(page)).toHaveCount(before + 1);
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/general-fanjian-target-${info.project.name}.png`,
    fullPage: true,
  });
});
test('貂蝉离间按选中顺序由后选 AI 发起决斗，消耗费用且本阶段一次', async ({ page }, info) => {
  await startGeneral(page, 'standard:diaochan', 4, 2);
  await reachOwnSkill(page, '结束出牌');
  await page.getByRole('button', { name: '离间', exact: true }).click();
  const material = page.getByTestId('hand-cards').locator('button[aria-disabled="false"]').first();
  const id = await material.getAttribute('data-testid');
  await material.click();
  await selectTarget(page, 'target-乙席');
  await selectTarget(page, 'target-丁席');
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/选择顺序1/);
  await expect(page.getByTestId('target-丁席')).toHaveAccessibleName(/选择顺序2/);
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText('丁席使用【决斗】 → 乙席');
  await expect(page.getByTestId('hand-cards').getByTestId(id!)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '离间', exact: true })).toBeDisabled();
  await page.screenshot({
    path: `.artifacts/ui/general-lijian-${info.project.name}.png`,
    fullPage: true,
  });
});
test('貂蝉真实结束阶段闭月补牌，保留固定本人视角', async ({ page }, info) => {
  await startGeneral(page, 'standard:diaochan', 2, 42);
  await reachOwnSkill(page, '是否发动【闭月】');
  const before = await hand(page).count();
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(page.getByTestId('journal')).toContainText('甲席发动【闭月】');
  await expect(hand(page)).toHaveCount(before + 1);
  await page.screenshot({
    path: `.artifacts/ui/general-biyue-${info.project.name}.png`,
    fullPage: true,
  });
});

test('诸葛亮观星可分组排序、暂停藏牌，确认后的牌顶真实进入摸牌', async ({ page }, info) => {
  await startGeneral(page, 'standard:zhugeliang', 4, 2);
  await reachOwnSkill(page, '观星：是否');
  const before = await hand(page).count();
  await page.getByRole('button', { name: '发动', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '观星：整理牌顶与牌底的顺序' });
  const top = page.getByTestId('arrange-top');
  const bottom = page.getByTestId('arrange-bottom');
  await expect(panel).toBeVisible();
  await expect(top.locator('article')).toHaveCount(4);
  const ids = await top
    .locator('article')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-item-id')!));
  await panel.getByRole('button', { name: '暂停并隐藏', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '对局已暂停' })).toBeVisible();
  await expect(page.locator('[data-item-id]')).toHaveCount(0);
  await expect(hand(page)).toHaveCount(0);
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await expect(panel).toBeVisible();
  for (const index of [0, 3])
    await top
      .locator(`[data-item-id="${ids[index]}"]`)
      .getByRole('button', { name: '移至牌底', exact: true })
      .click();
  await top.locator('article').nth(1).getByRole('button', { name: /^前移/ }).click();
  await bottom.locator('article').nth(1).getByRole('button', { name: /^前移/ }).click();
  expect(
    await top
      .locator('article')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-item-id'))),
  ).toEqual([ids[2], ids[1]]);
  expect(
    await bottom
      .locator('article')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-item-id'))),
  ).toEqual([ids[3], ids[0]]);
  const box = await panel.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({
    path: `.artifacts/ui/general-guanxing-${info.project.name}.png`,
    fullPage: true,
  });
  await panel.getByRole('button', { name: '确认顺序', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('journal')).toContainText('甲席整理牌堆：2 张置顶，2 张置底');
  await expect(hand(page)).toHaveCount(before + 2);
  for (const id of [ids[2], ids[1]])
    await expect(page.getByTestId('hand-cards').getByTestId(`card-${id}`)).toBeVisible();
  await page.getByRole('button', { name: '查看武将技能说明' }).click();
  await expect(page.getByRole('dialog', { name: /诸葛亮.*技能/ })).toContainText('空城');
  await page.getByRole('button', { name: '关闭技能说明' }).click();
});
test('诸葛亮 AI 自行完成观星，人类不接收其排序面板或私有牌池', async ({ page }) => {
  await startGeneral(page, 'standard:guanyu', 2, 1, 'standard:zhugeliang');
  await reachOwnSkill(page, '乙席整理牌堆', false, true);
  await expect(page.getByTestId('journal')).toContainText('乙席发动【观星】');
  await expect(page.getByRole('dialog', { name: /观星：整理/ })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '仅本人可见的牌池' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
});

test('赵云龙胆将闪当杀，实际移除材料并沿用本阶段杀次数', async ({ page }, info) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:zhaoyun');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('42');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/甲席·赵云/);
  await page.getByRole('button', { name: '龙胆 · 杀', exact: true }).click();
  await hand(page)
    .filter({ has: page.locator('.card-name', { hasText: '闪' }) })
    .click();
  await selectTarget(page, 'target-乙席');
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText('甲席使用【杀】');
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await expect(
    hand(page).filter({ has: page.locator('.card-name', { hasText: '闪' }) }),
  ).toHaveCount(0);
  await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).click();
  await selectTarget(page, 'target-乙席');
  await expect(confirm(page)).toBeDisabled();
  await expect(page.getByTestId('decision-hint')).toContainText('本阶段使用次数已达上限');
  await page.screenshot({
    path: `.artifacts/ui/general-zhaoyun-${info.project.name}.png`,
    fullPage: true,
  });
});

test('张飞被动技能说明可查看，弹窗数字和确认键不会代替已选用牌', async ({ page }) => {
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:zhangfei');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('42');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  const slash = page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / });
  await slash.click();
  await selectTarget(page, 'target-乙席');
  await expect(confirm(page)).toBeEnabled();
  const count = await hand(page).count();
  await page.getByRole('button', { name: '查看武将技能说明', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '张飞 · 技能' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('杀没有次数限制');
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  if (await dialog.count())
    await page.getByRole('button', { name: '关闭技能说明', exact: true }).click();
  await expect(hand(page)).toHaveCount(count);
  await expect(slash).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('journal')).not.toContainText('甲席使用【杀】');
});

test('孙尚香在 AI 行动后使用结姻：取消不耗牌，实际支付两张手牌并回复男性目标', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:sunshangxiang');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('27');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  const skill = page.getByRole('button', { name: '结姻', exact: true });
  for (let step = 0; step < 40; step++) {
    const kind = await page.locator('[data-decision-kind]').getAttribute('data-decision-kind');
    if (!kind) {
      await page.waitForFunction(
        () =>
          document.querySelector('[data-decision-kind]')?.getAttribute('data-decision-kind') ||
          document.querySelector('[aria-label="对局结果"]'),
      );
      await expect(page.getByRole('region', { name: '对局结果' })).toHaveCount(0);
      continue;
    }
    if (kind === 'play-action') {
      if (await skill.isEnabled()) break;
      await page.getByRole('button', { name: '结束出牌', exact: true }).click();
    } else if (kind === 'cards-targets') {
      if (await page.locator('.decision-actions .cancel-button').isEnabled())
        await page.locator('.decision-actions .cancel-button').click();
      else await discard(page);
    } else if (kind === 'card-response' || kind === 'use-card') {
      const available = page.getByTestId('hand-cards').locator('button[aria-disabled="false"]');
      let answered = false;
      for (const card of await available.all()) {
        await card.click();
        if (await confirm(page).isEnabled()) {
          await confirm(page).click();
          answered = true;
          break;
        }
      }
      if (!answered) await page.locator('.decision-actions .cancel-button').click();
    } else throw new Error(`Unexpected decision: ${kind}`);
  }
  await expect(skill).toBeVisible();
  const before = await hand(page).count();
  const hp = Number(
    (await page.getByTestId('target-乙席').getAttribute('aria-label'))?.match(/体力(\d+)/)?.[1],
  );
  expect(hp).toBeLessThan(4);
  const decisionKey = await page.locator('.decision-bar').getAttribute('data-decision-key');
  await skill.click();
  await hand(page).nth(0).click();
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await expect(page.locator('.decision-bar')).toHaveAttribute('data-decision-key', decisionKey!);
  await expect(hand(page)).toHaveCount(before);
  await skill.click();
  await expect(page.getByTestId('decision-hint')).toContainText('结姻：');
  await hand(page).nth(0).click();
  await hand(page).nth(1).click();
  await selectTarget(page, 'target-乙席');
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await expect(hand(page)).toHaveCount(before - 2);
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(new RegExp(`体力${hp + 1}/4`));
  await expect(page.getByTestId('journal')).toContainText('甲席发动【结姻】');
  await expect(skill).toBeDisabled();
  await page.screenshot({
    path: `.artifacts/ui/general-sunshangxiang-${info.project.name}.png`,
    fullPage: true,
  });
});

test('默认单机真实对局至胜负：仅操作甲席，其余角色自动行动且没有交接弹窗', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('42');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  let humanChoices = 0;
  for (let step = 0; step < 120; step++) {
    if (await page.getByRole('region', { name: '对局结果' }).count()) break;
    await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
    await expect(page.locator('.target-hitbox.self')).toHaveAttribute('data-testid', 'target-甲席');
    const kind = await page.locator('[data-decision-kind]').getAttribute('data-decision-kind');
    if (!kind) {
      await page.waitForFunction(
        () =>
          document.querySelector('[data-decision-kind]')?.getAttribute('data-decision-kind') ||
          document.querySelector('[aria-label="对局结果"]'),
      );
      continue;
    }
    humanChoices++;
    if (kind === 'cards-targets') await discard(page);
    else if (kind === 'play-action')
      await page.getByRole('button', { name: '结束出牌', exact: true }).click();
    else if (kind === 'card-response' || kind === 'use-card')
      await page.getByRole('button', { name: /放弃响应|放弃救援|放弃反制|放弃使用/ }).click();
    else throw new Error(`Unexpected human choice: ${kind}`);
  }
  expect(humanChoices).toBeGreaterThan(0);
  await expect(page.getByRole('region', { name: '对局结果' })).toBeVisible();
  await expect(page.getByTestId('journal')).toContainText('乙席使用【');
  await expect(page.getByTestId('journal')).toContainText('对局结束');
  await page.screenshot({
    path: `.artifacts/ui/solo-victory-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '再开一局' }).click();
  await expect(page.getByRole('region', { name: '开局设置' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '手动演练（内容调试）' })).not.toBeChecked();
});

test('真实开局、隐藏身份与强制弃牌、下一席交接', async ({ page }) => {
  await start(page);
  await expect(hand(page)).toHaveCount(6);
  await expect(page.getByTestId('own-role')).toHaveText('主公');
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/身份未知/);
  await expect(page.getByTestId('journal')).toContainText('摸了 4 张牌');
  await page.getByRole('button', { name: '结束出牌', exact: true }).click();
  await expect(page.locator('[data-decision-kind="cards-targets"]')).toBeVisible();
  await discard(page);
  await expect(page.getByRole('dialog', { name: /请交给 丁席/ })).toBeVisible();
  await expect(hand(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /请交给/ })).toBeVisible();
  await passDevice(page);
  await expect(hand(page)).toHaveCount(6);
  await expect(page.getByTestId('journal')).toContainText('丙席弃置 2 张牌');
});

test('目标反馈、详情与快捷键由正式决策驱动', async ({ page }) => {
  await start(page);
  const slash = hand(page)
    .filter({ has: page.locator('.card-name', { hasText: /^杀$/ }) })
    .first();
  await slash.click();
  await expect(confirm(page)).toBeDisabled();
  await expect(page.getByTestId('target-丙席')).toHaveAttribute('aria-disabled', 'true');
  await selectTarget(page, 'target-乙席');
  await expect(confirm(page)).toBeEnabled();
  const decision = page.locator('.decision-bar');
  await expect(page.locator('.target-lines line')).toHaveCount(2);
  const key = await decision.getAttribute('data-decision-key');
  const cardsBefore = await hand(page).count();
  const journalBefore = await page.getByTestId('journal').textContent();
  await page.getByRole('button', { name: '取消选择', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(slash).toHaveAttribute('aria-pressed', 'false');
  await expect(decision).toHaveAttribute('data-decision-key', key!);
  await expect(hand(page)).toHaveCount(cardsBefore);
  await expect(page.getByTestId('journal')).toHaveText(journalBefore!);
  await slash.click();
  await selectTarget(page, 'target-乙席');
  await page.getByRole('button', { name: '结算记录', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: '结算记录' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(slash).toHaveAttribute('aria-pressed', 'true');
  await expect(decision).toHaveAttribute('data-decision-key', key!);
  await expect(page.getByTestId('journal')).toHaveText(journalBefore!);
  await slash.click({ button: 'right' });
  await expect(page.getByRole('dialog', { name: '【杀】' })).toBeVisible();
  await page.keyboard.press('1');
  await page.keyboard.press('Escape');
  await expect(slash).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(slash).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press((await slash.locator('.card-shortcut').textContent())!);
  await selectTarget(page, 'target-丁席');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('journal')).toContainText('丙席使用【杀】 → 丁席');
  // 响应可能自动无候选，也可能切换到丁席；两者均是规则决定。
  await expect
    .poll(() => page.getByRole('dialog', { name: /请交给/ }).count())
    .toBeLessThanOrEqual(1);
});

test('武圣以红牌作材料，目标和最终支付复用杀的管线', async ({ page }) => {
  await start(page);
  await endTurn(page); // 丁
  await endTurn(page); // 甲
  await page.getByRole('button', { name: '武圣', exact: true }).click();
  await expect(confirm(page)).toBeDisabled();
  await page
    .getByTestId('hand-cards')
    .locator('.playing-card.red[aria-disabled="false"]')
    .first()
    .click();
  await page.locator('.target-hitbox[aria-disabled="false"]').first().click();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await expect(page.getByTestId('journal')).toContainText('甲席使用【杀】');
});

test('横屏和纵屏保持手牌滚动、可点目标与确认，长按不误出牌', async ({ page }, info) => {
  await start(page);
  const inspected = page
    .getByTestId('hand-cards')
    .locator('button:not([aria-label^="杀 "])')
    .first();
  await inspected.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    clientX: 120,
    clientY: 300,
  });
  await expect(page.getByRole('dialog', { name: /【/ })).toBeVisible();
  await inspected.dispatchEvent('pointerup', { pointerType: 'touch' });
  await page.getByRole('button', { name: '关闭牌面详情' }).click();
  await expect(inspected).toHaveAttribute('aria-pressed', 'false');
  for (const size of [
    { width: 915, height: 412 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      size.width,
    );
    if (size.width === 915)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
        .toBeLessThanOrEqual(size.height);
    await page
      .getByTestId('hand-cards')
      .locator('.playing-card[aria-label^="杀 "]')
      .first()
      .click();
    await selectTarget(page, 'target-乙席');
    await expect(confirm(page)).toBeEnabled();
    await page.screenshot({
      path: `.artifacts/ui/local-${info.project.name}-${size.width}.png`,
      fullPage: true,
    });
    await page.keyboard.press('Escape');
  }
});

test('参考位置：本人右下、手牌左下、确认在上、牌堆右上、记录从左打开', async ({ page }, info) => {
  await start(page);
  const surface = (await page.getByTestId('battle-canvas').boundingBox())!;
  const self = (await page.locator('.target-hitbox.self').boundingBox())!;
  const cards = (await page.getByTestId('hand-cards').boundingBox())!;
  const decision = (await page.locator('.decision-bar').boundingBox())!;
  const skills = (await page.locator('.skills-dock').boundingBox())!;
  const pile = (await page.locator('.pile-count').boundingBox())!;
  expect(self.x).toBeGreaterThan(surface.x + surface.width * 0.7);
  expect(self.y + self.height / 2).toBeGreaterThan(surface.y + surface.height * 0.65);
  // 按 FreeKill 留出底部席号与判定 mark；头像仍贴近右下角。
  expect(surface.y + surface.height - self.y - self.height).toBeGreaterThanOrEqual(8);
  expect(surface.y + surface.height - self.y - self.height).toBeLessThanOrEqual(42);
  expect(cards.x + cards.width).toBeLessThan(self.x);
  expect(decision.y + decision.height).toBeLessThan(cards.y);
  const confirmation = (await confirm(page).boundingBox())!;
  expect(confirmation.x + confirmation.width / 2).toBeGreaterThan(surface.x + surface.width * 0.3);
  expect(confirmation.x + confirmation.width / 2).toBeLessThan(surface.x + surface.width * 0.65);
  expect(skills.x + skills.width).toBeLessThan(self.x);
  expect(pile.x).toBeGreaterThan(surface.x + surface.width * 0.65);
  expect(pile.y).toBeLessThan(surface.y + 24);
  await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
  await selectTarget(page, 'target-乙席');
  for (const badge of await page.locator('.target-state').all())
    expect((await badge.boundingBox())!.height).toBeLessThan(25);
  await page.screenshot({
    path: `.artifacts/ui/reference-layout-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '结算记录', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '结算记录' })).toBeVisible();
  expect(
    (await page.getByRole('complementary', { name: '结算记录' }).boundingBox())!.x,
  ).toBeLessThan(surface.width * 0.25);
  const handBeforeLog = await hand(page).count();
  await page.keyboard.press('1');
  await expect(hand(page).first()).toHaveAttribute('aria-pressed', 'false');
  await expect(confirm(page)).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(hand(page)).toHaveCount(handBeforeLog);
  if (await page.getByRole('button', { name: '关闭记录', exact: true }).isVisible())
    await page.getByRole('button', { name: '关闭记录', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '结算记录' })).toBeHidden();
});

test('八人开局和席位命中区域保持在战场内部', async ({ page }, info) => {
  await startGeneral(page, 'standard:simayi', 8, 8, 'standard:zhugeliang');
  await expect(page.getByTestId('own-role')).toHaveText('主公');
  await reachOwnSkill(page, '结束出牌');
  await expect(page.locator('.target-hitbox')).toHaveCount(8);
  const canvas = await page.getByTestId('battle-canvas').boundingBox();
  for (const target of await page.locator('.target-hitbox').all()) {
    const rect = await target.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(canvas!.x - 1);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);
    expect(rect!.y).toBeGreaterThanOrEqual(canvas!.y - 1);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height + 1);
  }
  await page.screenshot({
    path: `.artifacts/ui/local-eight-${info.project.name}.png`,
    fullPage: true,
  });
  const original = page.viewportSize()!;
  for (const viewport of [
    original,
    { width: 960, height: 640 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport);
    await expectSeatTextToFit(page);
    if (viewport.width === 960)
      for (const target of await page.locator('.target-hitbox').all())
        expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(128);
    await page.screenshot({
      path: `.artifacts/ui/seats-${info.project.name}-${viewport.width}.png`,
    });
  }
});

test('隐藏手牌与模拟后台事件清除选择和详情，重新确认才可恢复', async ({ page }) => {
  await start(page);
  const initialCards = await hand(page).count();
  await page.getByRole('button', { name: '隐藏手牌', exact: true }).click();
  await passDevice(page);
  await expect(hand(page)).toHaveCount(initialCards);
  await hand(page).nth(1).click();
  await hand(page).nth(1).click({ button: 'right' });
  await expect(page.getByRole('dialog', { name: /【/ })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('dialog', { name: /【/ })).toHaveCount(0);
  await expect(hand(page)).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await passDevice(page);
  await expect(hand(page)).toHaveCount(initialCards);
  await expect(confirm(page)).toBeDisabled();
});

test('浏览器通过真实出牌/救援/弃牌界面跑至身份胜负，关闭动画仍完成对局', async ({ page }, info) => {
  test.setTimeout(120_000);
  await expect(page.getByRole('combobox', { name: '牌组', exact: true })).toHaveValue(
    'standard:identity',
  );
  await page.getByRole('button', { name: '动画开启', exact: true }).click();
  await start(page, 2, 27, 'standard:identity');
  await expect(page.getByText('2 人身份局 · 标准＋EX（108 张）', { exact: true })).toBeVisible();
  for (let step = 0; step < 160; step++) {
    if (await page.getByRole('region', { name: '对局结果' }).count()) break;
    if (await page.getByRole('dialog', { name: /请交给/ }).count()) {
      await passDevice(page);
      continue;
    }
    const kind = await page.locator('[data-decision-kind]').getAttribute('data-decision-kind');
    if (kind === 'cards-targets') {
      await discard(page);
      continue;
    }
    if (kind === 'card-response' || kind === 'use-card') {
      await page.getByRole('button', { name: /放弃响应|放弃救援|放弃反制/ }).click();
      continue;
    }
    if (kind === 'play-action') {
      let used = false;
      // 测试玩家仅尝试攻击牌。所有允许/禁止与最终确认由实际界面反馈判定。
      for (const card of await page
        .getByTestId('hand-cards')
        .locator('button[aria-label^="杀 "], button[aria-label^="决斗 "]')
        .all()) {
        await card.click();
        const targets = page.locator('.target-hitbox[aria-disabled="false"][aria-pressed="false"]');
        if (await targets.count()) await targets.first().click();
        if (await confirm(page).isEnabled()) {
          await confirm(page).click();
          used = true;
          break;
        }
      }
      if (!used) {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '结束出牌', exact: true }).click();
      }
      continue;
    }
    await expect
      .poll(() => page.locator('[data-decision-kind]').getAttribute('data-decision-kind'))
      .not.toBe('');
  }
  await expect(page.getByRole('region', { name: '对局结果' })).toBeVisible();
  await expect(page.getByLabel('身份揭示')).toContainText('主公');
  await expect(page.getByLabel('身份揭示')).toContainText('反贼');
  await expect(page.getByTestId('journal')).toContainText('对局结束');
  await expect(page.locator('.decision-actions button')).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/local-victory-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '再开一局' }).click();
  await expect(page.getByRole('region', { name: '开局设置' })).toBeVisible();
  await expect(hand(page)).toHaveCount(0);
});

test('Spine 按需加载、1/8 实例、暂停继续，模态操作不改变牌局', async ({ page }, info) => {
  await start(page);
  const before = await hand(page).count();
  await page.getByRole('button', { name: '动画验证' }).click();
  await expect(page.getByTestId('spine-count')).toHaveText('1');
  await expect
    .poll(async () => Number(await page.getByTestId('spine-frames').textContent()))
    .toBeGreaterThan(5);
  const canvas = page.getByTestId('spine-stage').locator('canvas');
  const first = await canvas.screenshot();
  await expect.poll(async () => (await canvas.screenshot()).equals(first)).toBe(false);
  await page.getByRole('button', { name: '8 个实例' }).click();
  await expect(page.getByTestId('spine-count')).toHaveText('8');
  await expect
    .poll(async () => Number(await page.getByTestId('spine-frames').textContent()))
    .toBeGreaterThan(5);
  await page.getByRole('button', { name: '暂停动画' }).click();
  const paused = await page.getByTestId('spine-frames').textContent();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('spine-frames')).toHaveText(paused!);
  await page.getByRole('button', { name: '继续动画' }).click();
  await expect
    .poll(async () => Number(await page.getByTestId('spine-frames').textContent()))
    .toBeGreaterThan(Number(paused));
  await page.getByRole('button', { name: '切换奔跑' }).click();
  await page.screenshot({
    path: `.artifacts/ui/local-spine-${info.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hand(page)).toHaveCount(before);
  await expect(page.getByRole('button', { name: '动画开启', exact: true })).toBeVisible();
});

async function passCountersUntil(page: Page, kind: string, prompt?: string) {
  for (let i = 0; i < 32; i++) {
    if (await page.getByRole('dialog', { name: /请交给/ }).count()) {
      await passDevice(page);
      continue;
    }
    const current = await page.locator('[data-decision-kind]').getAttribute('data-decision-kind');
    if (
      current === kind &&
      (!prompt || (await page.getByTestId('decision-hint').textContent())?.includes(prompt))
    )
      return;
    if (current === 'use-card' || current === 'card-response') {
      await page.getByRole('button', { name: /放弃反制|放弃救援|放弃响应|放弃使用/ }).click();
      continue;
    }
    await page.waitForFunction(
      () =>
        document.querySelector('.seat-curtain[open]') ||
        document.querySelector('[data-decision-kind]')?.getAttribute('data-decision-kind'),
    );
  }
  throw new Error(`Did not reach decision ${kind}`);
}

test('无懈是无玩家目标的用牌，完整反制结果显示在公开日志中', async ({ page }) => {
  await start(page, 4, 4); // 甲席起手含南蛮和无懈。
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^南蛮入侵 / })
    .first()
    .click();
  await confirm(page).click();
  await expect(page.getByRole('button', { name: '放弃反制', exact: true })).toBeEnabled();
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^无懈可击 / })
    .first()
    .click();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await passCountersUntil(page, 'play-action');
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/体力4\/4/);
  await expect(page.getByTestId('journal')).toContainText('甲席使用【无懈可击】');
  await expect(page.getByTestId('journal')).toContainText('对 乙席 的效果被【无懈可击】抵消');
});

test('自动多目标锦囊一键确认，每个目标依次响应', async ({ page }) => {
  await start(page, 4, 18); // 甲席起手含万箭。
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^万箭齐发 / })
    .first()
    .click();
  await expect(confirm(page)).toBeEnabled();
  await expect(page.locator('.target-hitbox[aria-pressed="true"]')).toHaveCount(3);
  await confirm(page).click();
  await passCountersUntil(page, 'play-action');
  for (const player of ['乙席', '丙席', '丁席'])
    await expect(page.getByTestId(`target-${player}`)).toHaveAccessibleName(/体力3\/4/);
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/体力4\/4/);
});

test('五谷公开牌池可点选，四人各取一张后牌池清空', async ({ page }, info) => {
  await start(page, 4, 18);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^五谷丰登 / })
    .first()
    .click();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  for (let left = 4; left > 0; left--) {
    await passCountersUntil(page, 'cards-targets');
    const pool = page.getByRole('group', { name: '公开牌池' });
    await expect(pool.locator('button')).toHaveCount(left);
    await pool.locator('button').first().click();
    await expect(confirm(page)).toBeEnabled();
    if (left === 4)
      await page.screenshot({
        path: `.artifacts/ui/grace-${info.project.name}.png`,
        fullPage: true,
      });
    await confirm(page).click();
  }
  await passCountersUntil(page, 'play-action');
  await expect(page.locator('.public-pools')).toHaveCount(0);
  await expect(page.getByTestId('journal')).toContainText('公开展示 4 张牌');
});

test('顺手暗选只展示未知手牌选项，获得后才在本人手牌中出现', async ({ page }) => {
  await start(page, 4, 2);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^顺手牵羊 / })
    .first()
    .click();
  await selectTarget(page, 'target-乙席');
  await confirm(page).click();
  await passCountersUntil(page, 'cards-targets');
  const choices = page.locator('.choice-options button');
  await expect(choices).toHaveCount(4);
  for (const choice of await choices.all()) await expect(choice).toHaveText(/未知手牌/);
  await expect(page.getByTestId('owned-card-picker').locator('.card-back')).toHaveCount(4);
  await choices.first().dispatchEvent('contextmenu');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const key = await page.locator('.decision-bar').getAttribute('data-decision-key');
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await choices.first().scrollIntoViewIfNeeded();
    const box = (await choices.first().boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(650);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(choices.first()).toHaveAttribute('aria-pressed', 'false');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(choices.first()).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(1200);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(choices.first()).toHaveAttribute('aria-pressed', 'false');
    await choices.first().focus();
    await page.keyboard.press('Space');
    await expect(choices.first()).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await touch.detach();
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('2');
  await expect(choices.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(confirm(page)).toBeDisabled();
  await expect(page.locator('.decision-bar')).toHaveAttribute('data-decision-key', key!);
  await choices.first().click();
  await confirm(page).click();
  await passCountersUntil(page, 'play-action');
  await expect(hand(page)).toHaveCount(6);
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/手牌3/);
  await expect(page.getByTestId('journal')).toContainText('甲席从 乙席 获得一张手牌');
});

test('装备从手牌进入公开区，同槽替换立即撤去旧转换能力', async ({ page }, info) => {
  await start(page, 4, 255);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^丈八蛇矛 / })
    .click();
  await expect(page.getByTestId('target-甲席')).toHaveAttribute('aria-pressed', 'true');
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  const equipment = page.getByTestId('equipment-甲席');
  await expect(equipment.getByRole('button', { name: /^丈八蛇矛 / })).toBeVisible();
  await expect(hand(page)).toHaveCount(5);
  await expect(page.getByRole('button', { name: '丈八蛇矛', exact: true })).toBeVisible();
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^诸葛连弩 / })
    .first()
    .click();
  await confirm(page).click();
  await expect(equipment.getByRole('button')).toHaveCount(1);
  await expect(equipment.getByRole('button', { name: /^诸葛连弩 / })).toBeVisible();
  expect(
    await equipment.locator('.card-name').evaluateAll((nodes) =>
      nodes
        .filter((node) => node.scrollWidth > node.clientWidth)
        .map((node) => ({
          text: node.textContent,
          width: node.clientWidth,
          scroll: node.scrollWidth,
        })),
    ),
  ).toEqual([]);
  await expect(page.getByRole('button', { name: '丈八蛇矛', exact: true })).toHaveCount(0);
  await expect(hand(page)).toHaveCount(4);
  await expect(page.getByTestId('journal')).toContainText('甲席装备【诸葛连弩】，替换【丈八蛇矛】');
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^大宛 / })
    .click();
  await confirm(page).click();
  await expect(equipment.getByRole('button')).toHaveCount(2);
  await expect(equipment.locator('.horse .card-name')).toHaveText('-1');
  await expect(equipment.locator('.horse .zone-suit img')).toBeVisible();
  const gearBox = (await equipment.boundingBox())!;
  const ownerBox = (await page.getByTestId('target-甲席').boundingBox())!;
  expect(gearBox.x).toBeGreaterThanOrEqual(ownerBox.x);
  expect(gearBox.y).toBeGreaterThanOrEqual(ownerBox.y);
  expect(gearBox.x + gearBox.width).toBeLessThanOrEqual(ownerBox.x + ownerBox.width);
  expect(gearBox.y + gearBox.height).toBeLessThanOrEqual(ownerBox.y + ownerBox.height);
  await expect(hand(page)).toHaveCount(3);
  const viewport = page.viewportSize()!;
  const box = (await confirm(page).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({
    path: `.artifacts/ui/equipment-${info.project.name}.png`,
    fullPage: true,
  });
});

test('丈八配方只选两张手牌，装备保留，最终仍执行完整杀的管线', async ({ page }) => {
  await start(page, 4, 255);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^丈八蛇矛 / })
    .click();
  await confirm(page).click();
  await page.getByRole('button', { name: '丈八蛇矛', exact: true }).click();
  await expect(confirm(page)).toBeDisabled();
  const candidates = page.getByTestId('hand-cards').locator('button[aria-disabled="false"]');
  await candidates.nth(0).click();
  await candidates.nth(1).click();
  await selectTarget(page, 'target-乙席');
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await passCountersUntil(page, 'play-action');
  await expect(hand(page)).toHaveCount(3);
  await expect(
    page.getByTestId('equipment-甲席').getByRole('button', { name: /^丈八蛇矛 / }),
  ).toHaveCount(1);
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/体力3\/4/);
  await expect(page.getByTestId('journal')).toContainText('甲席使用【杀】 → 乙席');
});

test('乐不思蜀进入公开判定区，下一席判定后跳过出牌并进入弃牌', async ({ page }, info) => {
  await start(page, 4, 70);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^乐不思蜀 / })
    .first()
    .click();
  await selectTarget(page, 'target-乙席');
  await confirm(page).click();
  await expect(
    page.getByTestId('judgment-乙席').getByRole('button', { name: /^乐不思蜀 / }),
  ).toBeVisible();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await endTurn(page);
  await passCountersUntil(page, 'cards-targets');
  await expect(page.getByTestId('judgment-乙席')).toHaveCount(0);
  await expect(page.getByTestId('journal')).toContainText('乙席的乐不思蜀结果：♦Q【大宛】');
  await expect(page.getByTestId('journal')).toContainText('乙席跳过了出牌阶段');
  await expect(page.getByTestId('decision-hint')).toContainText('弃置');
  await page.screenshot({
    path: `.artifacts/ui/judgment-${info.project.name}.png`,
    fullPage: true,
  });
});

test('闪电等待自己的下个判定阶段，不命中后按座次传递', async ({ page }) => {
  await start(page, 4, 9);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^闪电 / })
    .first()
    .click();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await expect(
    page.getByTestId('judgment-丁席').getByRole('button', { name: /^闪电 / }),
  ).toBeVisible();
  for (let i = 0; i < 4; i++) await endTurn(page);
  await passCountersUntil(page, 'play-action');
  await expect(page.getByTestId('judgment-丁席')).toHaveCount(0);
  await expect(
    page.getByTestId('judgment-甲席').getByRole('button', { name: /^闪电 / }),
  ).toBeVisible();
  await expect(page.getByTestId('journal')).toContainText('丁席的闪电结果：♦K【紫骍】');
  await expect(page.getByTestId('target-丁席')).toHaveAccessibleName(/体力4\/4/);
});

test('八卦阵在响应前询问发动，红色判定供闪并保留防具', async ({ page }, info) => {
  await start(page, 4, 366);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^八卦阵 / })
    .first()
    .click();
  await confirm(page).click();
  await expect(
    page.getByTestId('equipment-甲席').getByRole('button', { name: /^八卦阵 / }),
  ).toBeVisible();
  await endTurn(page);
  await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
  await selectTarget(page, 'target-甲席');
  await confirm(page).click();
  await passDevice(page);
  await expect(page.locator('[data-decision-kind="invoke"]')).toBeVisible();
  await expect(page.getByTestId('decision-hint')).toHaveText('是否发动【八卦阵】进行判定？');
  await page.screenshot({
    path: `.artifacts/ui/armor-invoke-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await passCountersUntil(page, 'play-action');
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/体力4\/4/);
  await expect(page.getByTestId('journal')).toContainText('甲席的八卦阵结果：♦2【寒冰剑】');
  await expect(page.getByTestId('journal')).toContainText('甲席使用【闪】');
  await expect(
    page.getByTestId('equipment-甲席').getByRole('button', { name: /^八卦阵 / }),
  ).toBeVisible();
  await page.screenshot({
    path: `.artifacts/ui/armor-result-${info.project.name}.png`,
    fullPage: true,
  });
});

test('青釭剑忽略仁王盾，黑色杀在实际客户端造成伤害', async ({ page }) => {
  await start(page, 4, 2);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^仁王盾 / })
    .click();
  await confirm(page).click();
  await endTurn(page);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^青釭剑 / })
    .first()
    .click();
  await confirm(page).click();
  await page
    .getByTestId('hand-cards')
    .locator('button.playing-card:not(.red)[aria-label^="杀 "]')
    .first()
    .click();
  await selectTarget(page, 'target-甲席');
  await confirm(page).click();
  await passCountersUntil(page, 'play-action');
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/体力3\/4/);
  await expect(page.getByTestId('journal')).toContainText('乙席的【青釭剑】使此杀忽略目标防具');
  await expect(
    page.getByTestId('equipment-甲席').getByRole('button', { name: /^仁王盾 / }),
  ).toBeVisible();
});

async function prepareCollateral(page: Page) {
  await start(page, 4, 173);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^诸葛连弩 / })
    .click();
  await confirm(page).click();
  await endTurn(page);
  const key = await page.locator('.decision-bar').getAttribute('data-decision-key');
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^借刀杀人 / })
    .first()
    .click();
  await expect(page.getByTestId('target-甲席')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.decision-bar')).toHaveAttribute('data-decision-kind', 'play-action');
  await expect(page.locator('.decision-bar')).toHaveAttribute('data-decision-key', key!);
  await expect(confirm(page)).toBeDisabled();
  await expect(page.getByTestId('decision-hint')).toContainText('最后选出杀目标');
  await selectTarget(page, 'target-乙席');
  await expect(page.locator('.decision-bar')).toHaveAttribute('data-decision-key', key!);
  await expect(confirm(page)).toBeEnabled();
  await expect(page.getByTestId('journal')).not.toContainText('乙席使用【借刀杀人】');
}

test('借刀持械者与出杀目标同一草稿；取消不耗牌，最终确认前不宣告', async ({ page }, info) => {
  if (info.project.name === 'touch') await page.setViewportSize({ width: 863, height: 360 });
  await prepareCollateral(page);
  await expectSeatTextToFit(page);
  const before = await hand(page).count();
  await page.screenshot({
    path: `.artifacts/ui/collateral-draft-${info.project.name}.png`,
    fullPage: true,
  });
  const geometry = await page.evaluate(() => {
    const equipment = [...document.querySelectorAll('.equipment-area .playing-card')];
    return [...document.querySelectorAll('.decision-actions button')].flatMap((button) => {
      const action = button.getBoundingClientRect();
      return equipment.flatMap((card) => {
        const gear = card.getBoundingClientRect();
        return Math.min(action.right, gear.right) > Math.max(action.left, gear.left) &&
          Math.min(action.bottom, gear.bottom) > Math.max(action.top, gear.top)
          ? [
              {
                action: button.textContent,
                card: card.getAttribute('aria-label'),
                actionRect: {
                  left: action.left,
                  top: action.top,
                  width: action.width,
                  height: action.height,
                },
                gearRect: {
                  left: gear.left,
                  top: gear.top,
                  width: gear.width,
                  height: gear.height,
                },
              },
            ]
          : [];
      });
    });
  });
  await info.attach('equipment-action-overlap', {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  expect(geometry, '装备展示与确认/取消按钮应保留独立空间').toEqual([]);
  await page.getByTestId('target-甲席').click();
  await expect(page.getByTestId('target-乙席')).toHaveAttribute('aria-pressed', 'false');
  await expect(confirm(page)).toBeDisabled();
  await selectTarget(page, 'target-甲席');
  await selectTarget(page, 'target-乙席');
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await expect(hand(page)).toHaveCount(before);
  await expect(page.getByTestId('journal')).not.toContainText('乙席使用【借刀杀人】');
  await expect(
    page.getByTestId('equipment-甲席').getByRole('button', { name: /^诸葛连弩 / }),
  ).toBeVisible();
});

for (const attack of [false, true]) {
  test(`借刀实际要求另一席${attack ? '用杀，完成伤害后保留武器' : '交出武器，回到借刀者手牌'}`, async ({
    page,
  }, info) => {
    await prepareCollateral(page);
    const swordsBefore = await page
      .getByTestId('hand-cards')
      .getByRole('button', { name: /^诸葛连弩 / })
      .count();
    await confirm(page).click();
    await passCountersUntil(page, 'use-card', '借刀杀人：对');
    await expect(page.getByTestId('decision-hint')).toContainText(
      '对 乙席 使用杀，否则将武器交给 乙席',
    );
    if (attack) {
      await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
      await confirm(page).click();
    } else await page.getByRole('button', { name: '放弃使用', exact: true }).click();
    await passCountersUntil(page, 'play-action');
    await expect(page.getByTestId('journal')).toContainText(
      '乙席使用【借刀杀人】 → 甲席，令其对 乙席 使用杀',
    );
    if (attack) {
      await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/体力3\/4/);
      await expect(
        page.getByTestId('equipment-甲席').getByRole('button', { name: /^诸葛连弩 / }),
      ).toBeVisible();
      await expect(page.getByTestId('journal')).not.toContainText('因【借刀杀人】获得');
    } else {
      await expect(page.getByTestId('equipment-甲席')).toHaveCount(0);
      await expect(
        page.getByTestId('hand-cards').getByRole('button', { name: /^诸葛连弩 / }),
      ).toHaveCount(swordsBefore + 1);
      await expect(page.getByTestId('journal')).toContainText(
        '乙席因【借刀杀人】获得 甲席 的【诸葛连弩】',
      );
    }
    await page.screenshot({
      path: `.artifacts/ui/collateral-${attack ? 'attack' : 'weapon'}-${info.project.name}.png`,
      fullPage: true,
    });
  });
}

async function startWeaponAttack(page: Page, seed: number, weapon: string, target: string) {
  await start(page, 4, seed);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: new RegExp(`^${weapon} `) })
    .first()
    .click();
  await confirm(page).click();
  await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
  await selectTarget(page, `target-${target}`);
  await confirm(page).click();
  await passDevice(page);
  await page.getByTestId('hand-cards').getByRole('button', { name: /^闪 / }).first().click();
  await confirm(page).click();
  await passDevice(page);
}

test('贯石斧选两张费用，突破闪后继续原伤害', async ({ page }, info) => {
  await startWeaponAttack(page, 93, '贯石斧', '丁席');
  await expect(page.getByTestId('decision-hint')).toHaveText(
    '贯石斧：弃置两张其他牌，使此杀仍造成伤害',
  );
  await expect(page.getByRole('button', { name: '不发动', exact: true })).toBeEnabled();
  const cards = page.getByTestId('hand-cards').locator('button[aria-disabled="false"]');
  await cards.nth(0).click();
  await cards.nth(1).click();
  await confirm(page).click();
  await passCountersUntil(page, 'play-action');
  await expect(page.getByTestId('target-丁席')).toHaveAccessibleName(/体力3\/4/);
  await expect(hand(page)).toHaveCount(2);
  await expect(page.getByTestId('journal')).toContainText('丙席发动【贯石斧】');
  await expect(
    page.getByTestId('equipment-丙席').getByRole('button', { name: /^贯石斧 / }),
  ).toBeVisible();
  await page.screenshot({ path: `.artifacts/ui/axe-${info.project.name}.png`, fullPage: true });
});

test('青龙在闪后要求新的杀，原目标与追加用牌由规则给出', async ({ page }, info) => {
  await startWeaponAttack(page, 498, '青龙偃月刀', '甲席');
  await expect(page.getByTestId('decision-hint')).toContainText(
    '青龙偃月刀：可对 甲席 再使用一张杀',
  );
  await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
  await expect(page.getByTestId('target-甲席')).toHaveAttribute('aria-pressed', 'true');
  await confirm(page).click();
  await passCountersUntil(page, 'play-action');
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/体力3\/4/);
  await expect(hand(page)).toHaveCount(3);
  await expect(page.getByTestId('journal')).toContainText('丁席通过【青龙偃月刀】追杀');
  await page.screenshot({ path: `.artifacts/ui/blade-${info.project.name}.png`, fullPage: true });
});

test('方天最后手牌杀可选三个目标，客户端数量反馈与结算一致', async ({ page }, info) => {
  await start(page, 4, 14);
  const otherEquipment = page
    .getByTestId('hand-cards')
    .locator('button:not([aria-label^="杀 "]):not([aria-label^="方天画戟 "])');
  while (await otherEquipment.count()) {
    await otherEquipment.first().click();
    await confirm(page).click();
  }
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^方天画戟 / })
    .click();
  await confirm(page).click();
  await expect(hand(page)).toHaveCount(1);
  await hand(page).first().click();
  for (const name of ['甲席', '丙席', '丁席']) await selectTarget(page, `target-${name}`);
  await expect(page.locator('.target-hitbox[aria-pressed="true"]')).toHaveCount(3);
  await expect(confirm(page)).toBeEnabled();
  await page.screenshot({ path: `.artifacts/ui/halberd-${info.project.name}.png`, fullPage: true });
  await confirm(page).click();
  await passCountersUntil(page, 'play-action');
  for (const name of ['甲席', '丙席', '丁席'])
    await expect(page.getByTestId(`target-${name}`)).toHaveAccessibleName(/体力3\/4/);
});

test('麒麟弓可选择公开坐骑，弃置后继续伤害', async ({ page }, info) => {
  await start(page, 4, 120);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^绝影 / })
    .click();
  await confirm(page).click();
  await endTurn(page);
  await page
    .getByTestId('hand-cards')
    .getByRole('button', { name: /^麒麟弓 / })
    .first()
    .click();
  await confirm(page).click();
  await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
  await selectTarget(page, 'target-乙席');
  await confirm(page).click();
  await passCountersUntil(page, 'cards-targets');
  await expect(page.getByTestId('decision-hint')).toHaveText('麒麟弓：可弃置 乙席 的一张坐骑');
  await expect(page.getByRole('button', { name: '不发动', exact: true })).toBeEnabled();
  await page.locator('.choice-options').getByRole('button', { name: '绝影', exact: true }).click();
  await confirm(page).click();
  await passCountersUntil(page, 'play-action');
  await expect(page.getByTestId('equipment-乙席')).toHaveCount(0);
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/体力3\/4/);
  await expect(page.getByTestId('journal')).toContainText('丙席以【麒麟弓】弃置 乙席 的【绝影】');
  await page.screenshot({ path: `.artifacts/ui/bow-${info.project.name}.png`, fullPage: true });
});

for (const branch of ['discard', 'draw', 'decline'] as const) {
  test(`雌雄双股剑展示性别并执行 ${branch} 分支`, async ({ page }, info) => {
    await start(page, 4, 3);
    await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/性别女/);
    await expect(page.getByTestId('target-丙席')).toHaveAccessibleName(/性别男/);
    await page
      .getByTestId('hand-cards')
      .getByRole('button', { name: /^雌雄双股剑 / })
      .first()
      .click();
    await confirm(page).click();
    await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
    await selectTarget(page, 'target-丙席');
    await confirm(page).click();
    await expect(page.getByTestId('decision-hint')).toHaveText('是否对 丙席 发动【雌雄双股剑】？');
    await page
      .getByRole('button', { name: branch === 'decline' ? '不发动' : '发动', exact: true })
      .click();
    if (branch !== 'decline') {
      await passDevice(page);
      await expect(page.getByTestId('decision-hint')).toContainText('雌雄双股剑：弃置一张手牌');
      if (branch === 'discard') {
        await hand(page).first().click();
        await confirm(page).click();
      } else await page.getByRole('button', { name: '令对方摸牌', exact: true }).click();
    }
    await passCountersUntil(page, 'play-action');
    await expect(page.getByTestId('target-丙席')).toHaveAccessibleName(/体力3\/4/);
    await expect(hand(page)).toHaveCount(branch === 'draw' ? 5 : 4);
    if (branch === 'discard')
      await expect(page.getByTestId('target-丙席')).toHaveAccessibleName(/手牌3/);
    await page.screenshot({
      path: `.artifacts/ui/double-swords-${branch}-${info.project.name}.png`,
      fullPage: true,
    });
  });
}

for (const invoke of [false, true]) {
  test(`寒冰剑${invoke ? '防止伤害并连续暗选弃牌' : '拒绝发动后正常造成伤害'}`, async ({
    page,
  }, info) => {
    await start(page, 4, 36);
    await page
      .getByTestId('hand-cards')
      .getByRole('button', { name: /^寒冰剑 / })
      .first()
      .click();
    await confirm(page).click();
    await page.getByTestId('hand-cards').getByRole('button', { name: /^杀 / }).first().click();
    await selectTarget(page, 'target-丁席');
    await confirm(page).click();
    await passCountersUntil(page, 'cards-targets', '寒冰剑：选择');
    await expect(page.getByTestId('decision-hint')).toContainText('确认后发动并防止伤害');
    const key = await page.locator('.decision-bar').getAttribute('data-decision-key');
    await expect(page.getByRole('button', { name: '发动', exact: true })).toHaveCount(0);
    await expect(confirm(page)).toBeDisabled();
    if (invoke)
      for (let i = 1; i <= 2; i++) {
        if (i === 2) {
          await expect(page.getByTestId('decision-hint')).toHaveText(
            '寒冰剑：弃置 丁席 的第 2 张牌',
          );
          await expect(page.locator('.decision-bar')).not.toHaveAttribute(
            'data-decision-key',
            key!,
          );
          await expect(page.locator('.decision-actions .cancel-button')).toBeDisabled();
        }
        const options = page.locator('.choice-options button');
        await expect(options).toHaveCount(5 - i);
        for (const option of await options.all()) await expect(option).toHaveText(/未知手牌/);
        await options.first().click();
        if (i === 1) {
          await options.last().click();
          await expect(options.first()).toHaveAttribute('aria-pressed', 'false');
          await expect(options.last()).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator('.decision-bar')).toHaveAttribute('data-decision-key', key!);
          await expect(page.getByTestId('journal')).not.toContainText('丙席发动【寒冰剑】');
          await expect(page.getByTestId('target-丁席')).toHaveAccessibleName(/体力4\/4，手牌4/);
        }
        await confirm(page).click();
      }
    else await page.getByRole('button', { name: '不发动', exact: true }).click();
    await passCountersUntil(page, 'play-action');
    await expect(page.getByTestId('target-丁席')).toHaveAccessibleName(
      invoke ? /体力4\/4，手牌2/ : /体力3\/4，手牌4/,
    );
    if (invoke)
      await expect(page.getByTestId('journal')).toContainText(
        '丙席发动【寒冰剑】防止对 丁席 的伤害',
      );
    else await expect(page.getByTestId('journal')).not.toContainText('丙席发动【寒冰剑】');
    await page.screenshot({
      path: `.artifacts/ui/ice-sword-${invoke ? 'replace' : 'decline'}-${info.project.name}.png`,
      fullPage: true,
    });
  });
}

test('本人可托管并收回，暂停冻结托管，继续后基础 AI 完成整局', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('27');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await page.getByRole('button', { name: 'AI 托管', exact: true }).click();
  await expect(page.getByRole('button', { name: '收回操作', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.decision-actions button')).toHaveCount(0);
  await expect(page.getByTestId('decision-hint')).toHaveText('基础 AI 正在代你操作…');
  await page.getByRole('button', { name: '收回操作', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AI 托管', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: '结束出牌', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'AI 托管', exact: true }).click();
  await expect(page.getByRole('button', { name: '收回操作', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: '.artifacts/ui/delegation-' + info.project.name + '.png' });
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '对局已暂停' })).toBeVisible();
  await expect(hand(page)).toHaveCount(0);
  const journal = await page.getByTestId('journal').textContent();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('journal')).toHaveText(journal!);
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await expect(page.locator('.target-hitbox.self')).toHaveAttribute('data-testid', 'target-甲席');
  await expect(page.getByRole('region', { name: '对局结果' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('journal')).toContainText('对局结束');
  await page.getByRole('button', { name: '再开一局' }).click();
  await expect(page.getByRole('button', { name: '开始单机对局' })).toBeVisible();
});

test('启动入口在桌面、横屏与窄屏均完整可点，键盘导航将焦点交给目标页', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 915, height: 412 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: '‹ 返回首页', exact: true }).click();
    const home = page.getByRole('region', { name: '启动界面', exact: true });
    await expect(home.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(
      home.getByRole('button', { name: '直接开始单机对局', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    for (const name of ['直接开始单机对局', '单机演武', '联机房间', '内容管理']) {
      const entry = home.getByRole('button', { name, exact: true });
      await entry.scrollIntoViewIfNeeded();
      await expect(entry).toBeInViewport();
      const bounds = await entry.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const quickSeats = home.getByRole('group', { name: '快捷席位', exact: true });
    const changeGeneral = home.getByRole('button', { name: '更换你的武将，当前关羽', exact: true });
    const generalBounds = await changeGeneral.boundingBox();
    expect(generalBounds!.width).toBeGreaterThanOrEqual(44);
    expect(generalBounds!.height).toBeGreaterThanOrEqual(44);
    await quickSeats.getByRole('button', { name: '8 席', exact: true }).click();
    await expect(quickSeats.getByRole('button', { name: '8 席', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      home.getByRole('list', { name: '待开牌局阵容', exact: true }).getByRole('listitem'),
    ).toHaveCount(8);
    await quickSeats.getByRole('button', { name: '2 席', exact: true }).click();
    await page.getByRole('button', { name: '单机演武', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '单机演武', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: '单机演武', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByTestId('battle-canvas').locator('canvas')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '席位', exact: true })).toHaveValue('2');
    await expect(page.getByRole('button', { name: '开始单机对局' })).toBeInViewport({ ratio: 1 });
    await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('8');
    const roster = page.getByRole('region', { name: '本局阵容预览', exact: true });
    await expect(roster.getByRole('listitem')).toHaveCount(8);
    await page.getByRole('checkbox', { name: '手动演练（内容调试）', exact: true }).check();
    await expect(page.getByRole('region', { name: '所选武将技能', exact: true })).toHaveCount(0);
    await expect(roster.getByRole('listitem').first()).toContainText('自由演练');
    await expect(roster.getByRole('listitem').first()).toContainText('甲席 · 手动');
    await expect(roster.getByRole('listitem').last()).toContainText('辛席 · 手动');
    await page.getByRole('button', { name: '‹ 返回首页', exact: true }).click();
    const homeRoster = page.getByRole('list', { name: '待开牌局阵容', exact: true });
    await expect(homeRoster.getByRole('listitem')).toHaveCount(8);
    await expect(homeRoster.getByRole('listitem').last()).toContainText('辛席 · 手动');
    await expect(home.getByRole('button', { name: /^更换你的武将/ })).toHaveCount(0);
    await page.getByRole('button', { name: '单机演武', exact: true }).click();
    await page.getByRole('checkbox', { name: '手动演练（内容调试）', exact: true }).uncheck();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('启动页与大厅分区导航保留配置，内容变更后可进入真实对局', async ({ page }, info) => {
  const canvas = page.getByTestId('battle-canvas').locator('canvas');
  await expect(canvas).toHaveCount(0);
  await page.getByRole('button', { name: '‹ 返回首页', exact: true }).click();
  await expect(page.getByRole('region', { name: '启动界面', exact: true })).toBeVisible();
  await expect(page.getByTestId('battle-canvas')).toBeHidden();
  await expect(page.getByRole('combobox', { name: '你的武将', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.artifacts/ui/lobby-home-' + info.project.name + '.png' });
  await page.getByRole('button', { name: '调整阵容', exact: true }).click();
  await expect(page.getByRole('heading', { name: '单机演武', exact: true })).toBeFocused();
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:zhaoyun');
  await expect(page.locator('.solo-preview h2')).toHaveText('赵云');
  await expect(page.getByLabel('所选武将资料', { exact: true })).toHaveText('蜀势力 体力上限 4');
  const skills = page.getByRole('region', { name: '所选武将技能', exact: true });
  await expect(skills.getByRole('heading', { name: '赵云 · 技能', exact: true })).toBeVisible();
  await expect(skills.locator('dt')).toHaveText(['龙胆']);
  await expect(skills.locator('dd')).toContainText('可以将一张杀当闪使用或打出');
  const roster = page.getByRole('region', { name: '本局阵容预览', exact: true });
  await page.getByRole('combobox', { name: 'AI 武将', exact: true }).selectOption('standard:lvbu');
  await expect(roster.getByRole('listitem')).toHaveCount(2);
  await expect(roster.getByRole('listitem').first()).toContainText('赵云');
  await expect(roster.getByRole('listitem').first()).toContainText('甲席 · 你');
  await expect(roster.getByRole('listitem').last()).toContainText('吕布');
  await expect(roster.getByRole('listitem').last()).toContainText('乙席 · AI');
  await page.getByRole('spinbutton', { name: '牌局种子', exact: true }).fill('0');
  await page.getByText('演练与复现', { exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '牌局种子', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '‹ 返回首页', exact: true }).click();
  await expect(page.getByLabel('待开牌局', { exact: true })).toContainText('2 席 · 赵云领衔');
  const homeRoster = page.getByRole('list', { name: '待开牌局阵容', exact: true });
  await expect(homeRoster.getByRole('listitem')).toHaveCount(2);
  await expect(homeRoster.getByRole('listitem').first()).toContainText('赵云');
  await expect(homeRoster.getByRole('listitem').last()).toContainText('吕布');
  await page.getByRole('button', { name: '直接开始单机对局', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('牌局种子需为 1 至 4294967295 的整数');
  await expect(canvas).toHaveCount(0);
  await page.getByRole('button', { name: '单机演武', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '牌局种子', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.solo-portrait img').evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole('spinbutton').fill('17');
  await page.getByRole('button', { name: '联机房间', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '主持端地址' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '你的武将', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '内容管理', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '内置内容选择' })).toBeVisible();
  await page.getByRole('checkbox', { name: '机制演武', exact: true }).check();
  await page.getByRole('button', { name: '单机演武', exact: true }).click();
  await expect(page.getByRole('spinbutton')).toHaveValue('17');
  await expect(page.getByRole('combobox', { name: '你的武将', exact: true })).toHaveValue(
    'standard:zhaoyun',
  );
  await expect(page.locator('.solo-preview h2')).toHaveText('赵云');
  await expect(page.getByRole('combobox', { name: '席位', exact: true })).toHaveValue('2');
  await expect(page.getByRole('checkbox', { name: '机制演武', exact: true })).toBeChecked();
  await expect(
    page.getByRole('combobox', { name: '你的武将', exact: true }).locator('option'),
  ).toHaveCount(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.artifacts/ui/lobby-solo-' + info.project.name + '.png' });
  await page.getByRole('button', { name: '‹ 返回首页', exact: true }).click();
  await page.getByRole('button', { name: '直接开始单机对局', exact: true }).click();
  await expect(page.getByTestId('battle-canvas').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('hand-cards').getByRole('button').first()).toBeVisible();
  await expect(page.getByRole('region', { name: '游戏大厅', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('target-甲席')).toHaveAccessibleName(/赵云/);
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/吕布/);
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '对局已暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '结束本局，返回大厅', exact: true }).click();
  await expect(page.getByRole('region', { name: '开局设置', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveValue('17');
  await expect(page.getByTestId('hand-cards').getByRole('button')).toHaveCount(0);
  await expect(canvas).toHaveCount(0);
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(canvas).toHaveAttribute('data-portraits', '甲席,乙席');
  await expect(page.getByTestId('hand-cards').getByRole('button').first()).toBeVisible();
});

test('大厅检索真实武将后直接选将，切页保留开局与连接草稿', async ({ page }, info) => {
  await page.getByRole('spinbutton', { name: '牌局种子', exact: true }).fill('19');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('6');
  await page.getByRole('button', { name: '浏览武将一览', exact: true }).click();
  await expect(page.getByRole('heading', { name: '内容管理', exact: true })).toBeFocused();
  const gallery = page.getByRole('region', { name: '武将一览', exact: true });
  const search = gallery.getByRole('searchbox', { name: '查找武将', exact: true });
  await search.fill('不存在的武将');
  await expect(gallery.getByRole('button')).toHaveCount(0);
  await expect(gallery).toContainText('没有找到该武将');
  await search.fill('赵云');
  await expect(gallery.getByRole('button')).toHaveCount(1);
  await expect(gallery.getByRole('status')).toHaveText('1 / 25 名武将');
  await expect(
    gallery.getByRole('button', { name: '选择赵云并前往单机演武', exact: true }),
  ).toHaveAccessibleDescription('蜀 · 体力 4');
  await expect
    .poll(() => gallery.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await page.screenshot({ path: `.artifacts/ui/lobby-gallery-${info.project.name}.png` });
  await gallery.getByRole('button', { name: '选择赵云并前往单机演武', exact: true }).click();
  await expect(page.getByRole('heading', { name: '单机演武', exact: true })).toBeFocused();
  await expect(page.getByRole('combobox', { name: '你的武将', exact: true })).toHaveValue(
    'standard:zhaoyun',
  );
  await expect(page.getByRole('combobox', { name: '席位', exact: true })).toHaveValue('6');
  await expect(page.getByRole('spinbutton', { name: '牌局种子', exact: true })).toHaveValue('19');
  await page.getByRole('button', { name: '‹ 返回首页', exact: true }).click();
  await page.getByRole('button', { name: '更换你的武将，当前赵云', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '内容管理', exact: true })).toBeFocused();
  await expect(
    gallery.getByRole('button', { name: '选择赵云并前往单机演武', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await gallery.getByRole('button', { name: '选择赵云并前往单机演武', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '席位', exact: true })).toHaveValue('6');
  await expect(page.getByRole('spinbutton', { name: '牌局种子', exact: true })).toHaveValue('19');
  await page.getByRole('button', { name: '联机房间', exact: true }).click();
  await page.getByRole('textbox', { name: '主持端地址', exact: true }).fill('192.168.1.7:1422');
  await page.getByRole('button', { name: '内容管理', exact: true }).click();
  await page.getByRole('button', { name: '联机房间', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '主持端地址', exact: true })).toHaveValue(
    '192.168.1.7:1422',
  );
  await page.getByRole('link', { name: '弈 三国杀新章', exact: true }).click();
  await expect(
    page.getByRole('region', { name: '启动界面', exact: true }).getByRole('heading', { level: 1 }),
  ).toBeFocused();
  await expect(page.getByLabel('待开牌局', { exact: true })).toContainText('6 席 · 赵云领衔');
  await page.getByRole('button', { name: '联机房间', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '主持端地址', exact: true })).toHaveValue(
    '192.168.1.7:1422',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.artifacts/ui/lobby-network-${info.project.name}.png` });
  await expect(page.getByTestId('battle-canvas').locator('canvas')).toHaveCount(0);
});
