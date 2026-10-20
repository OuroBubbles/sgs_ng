import { test, expect } from '@playwright/test';

test('立绘牌桌反复进入和关闭独立 Spine 渲染器后仍可重绘与选择', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByText('WebGL 战场已就绪')).toBeAttached();
  await page
    .getByRole('combobox', { name: '你的武将', exact: true })
    .selectOption('standard:guanyu');
  await page
    .getByRole('combobox', { name: 'AI 武将', exact: true })
    .selectOption('standard:caocao');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('2');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await expect(page.getByTestId('battle-canvas').locator('canvas')).toHaveAttribute(
    'data-portraits',
    /甲席/,
  );
  const hand = page.getByTestId('hand-cards').locator('button');
  const before = await hand.count();
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: '动画验证' }).click();
    await expect(page.getByTestId('spine-count')).toHaveText('1');
    await page.getByRole('button', { name: '8 个实例' }).click();
    await expect(page.getByTestId('spine-count')).toHaveText('8');
    await expect
      .poll(async () => Number(await page.getByTestId('spine-frames').textContent()))
      .toBeGreaterThan(5);
    await page.getByRole('button', { name: '关闭动画验证' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(hand).toHaveCount(before);
    await hand.first().click();
    await hand.first().click();
    expect(errors).toEqual([]);
  }
});
