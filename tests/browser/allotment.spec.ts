import { test, expect, type Page } from '@playwright/test';
import config from '../../src-tauri/tauri.conf.json' with { type: 'json' };

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const found: string[] = [];
  errors.set(page, found);
  page.on('pageerror', (error) => found.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') found.push(message.text());
  });
  await page.route('http://127.0.0.1:1420/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'Content-Security-Policy': config.app.security.csp },
    });
  });
  await page.goto('/');
  await expect(page.locator('[data-content-ready="true"]')).toBeVisible();
  await expect(page.getByText('WebGL 战场已就绪')).toBeAttached();
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

async function start(page: Page, ai = false) {
  await page.getByRole('checkbox', { name: '作者演武', exact: true }).check();
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption(ai ? 'standard:guanyu' : 'workshop:quartermaster');
  await page
    .getByRole('combobox', { name: 'AI 武将', exact: true })
    .selectOption(ai ? 'workshop:quartermaster' : 'standard:guanyu');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill(ai ? '2' : '4');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  if (!ai) await page.getByRole('button', { name: '发动', exact: true }).click();
}
const panel = (page: Page) => page.getByRole('dialog', { name: /分筹：他人至多一张/ });
const own = (page: Page) => panel(page).getByTestId('arrange-甲席');
const recipient = (page: Page) => panel(page).getByTestId('arrange-乙席');

test('真实分筹按接收条件分牌，一次确认改变双方手牌，公开记录只显示分配数量', async ({
  page,
}, info) => {
  await start(page);
  await expect(own(page).locator('article')).toHaveCount(4);
  const black = own(page).locator('article:has(.arrange-card:not(.red))').first();
  const givenId = await black.getAttribute('data-item-id');
  await black.getByRole('button', { name: '分给乙席', exact: true }).click();
  await expect(recipient(page).locator('article')).toHaveCount(1);
  await expect(panel(page).getByRole('button', { name: '确认分配', exact: true })).toBeEnabled();
  await page.screenshot({
    path: `.artifacts/ui/allotment-choice-${info.project.name}.png`,
    fullPage: true,
  });
  await panel(page).getByRole('button', { name: '确认分配', exact: true }).click();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await expect(page.getByTestId('hand-cards').locator('button')).toHaveCount(9);
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/手牌5/);
  await expect(page.getByTestId('hand-cards').getByTestId(`card-${givenId}`)).toHaveCount(0);
  await expect(page.getByTestId('journal')).toContainText('甲席分配牌：甲席 3 张、乙席 1 张');
  await expect(page.getByTestId('journal')).not.toContainText(givenId!);
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/allotment-result-${info.project.name}.png`,
    fullPage: true,
  });
});

test('每人额度允许临时调整，超额不能提交，移回后可完成分配', async ({ page }, info) => {
  await start(page);
  for (let index = 0; index < 2; index++)
    await own(page)
      .locator('article:has(.arrange-card:not(.red))')
      .first()
      .getByRole('button', { name: '分给乙席', exact: true })
      .click();
  await expect(recipient(page).locator('article')).toHaveCount(2);
  await expect(panel(page).getByRole('button', { name: '确认分配', exact: true })).toBeDisabled();
  await page.screenshot({
    path: `.artifacts/ui/allotment-quota-${info.project.name}.png`,
    fullPage: true,
  });
  await recipient(page)
    .locator('article')
    .first()
    .getByRole('button', { name: '分给自己保留', exact: true })
    .click();
  await expect(panel(page).getByRole('button', { name: '确认分配', exact: true })).toBeEnabled();
  await panel(page).getByRole('button', { name: '确认分配', exact: true }).click();
  await expect(page.getByTestId('target-乙席')).toHaveAccessibleName(/手牌5/);
});

test('红牌不能给未受伤角色，暂停隐藏私有分配，恢复重新取得合法初始方案', async ({ page }, info) => {
  await start(page);
  const red = own(page).locator('article:has(.arrange-card.red)').first();
  await expect(red.getByRole('button', { name: '分给乙席', exact: true })).toBeDisabled();
  await own(page)
    .locator('article:has(.arrange-card:not(.red))')
    .first()
    .getByRole('button', { name: '分给乙席', exact: true })
    .click();
  await panel(page).getByRole('button', { name: '暂停并隐藏', exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId('hand-cards').locator('button')).toHaveCount(0);
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await expect(own(page).locator('article')).toHaveCount(4);
  await expect(recipient(page).locator('article')).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/allotment-restored-${info.project.name}.png`,
    fullPage: true,
  });
  await panel(page).getByRole('button', { name: '确认分配', exact: true }).click();
  await expect(page.getByTestId('hand-cards').locator('button')).toHaveCount(10);
});

test('非主控筹策客由基础 AI 自行分配，固定甲席且不展示其他角色的私有面板', async ({
  page,
}, info) => {
  await start(page, true);
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await page.getByRole('button', { name: '结束出牌', exact: true }).click();
  await expect(page.locator('[data-decision-kind="cards-targets"]')).toBeVisible();
  const hand = page.getByTestId('hand-cards').locator('button');
  await hand.nth(0).click();
  await hand.nth(1).click();
  await page.getByRole('button', { name: '确认当前选择', exact: true }).click();
  await expect(page.getByTestId('journal')).toContainText('乙席分配牌');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('.target-hitbox.self')).toHaveAttribute('data-testid', 'target-甲席');
  await expect(page.getByRole('dialog', { name: /请交给/ })).toHaveCount(0);
  await page.screenshot({
    path: `.artifacts/ui/allotment-ai-${info.project.name}.png`,
    fullPage: true,
  });
});
