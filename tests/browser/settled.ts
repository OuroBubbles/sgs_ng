import { test as base, type Locator, type Page } from '@playwright/test';

/**
 * 选择预览与命令回执由主持端经协议异步返回；未到齐时 `.app-shell` 标注 aria-busy。
 * 浏览器规格在读取或操作界面前先等它们到齐，以免读到“正在核对选择”的中间态。
 * 断言（expect）本身会重试，无需包装；这里只包装一次性读取与操作。
 */
const reads = [
  'all',
  'count',
  'getAttribute',
  'textContent',
  'innerText',
  'isChecked',
  'isDisabled',
  'isEnabled',
  'isVisible',
] as const;
const actions = [
  'click',
  'dblclick',
  'tap',
  'press',
  'fill',
  'check',
  'uncheck',
  'selectOption',
  'dispatchEvent',
] as const;
const wrapped = Symbol('settled');
const keyboards = new WeakMap<object, Page>();

export async function settled(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page
    .waitForFunction(() => !document.querySelector('.app-shell[aria-busy="true"]'))
    .catch((error: unknown) => {
      if (!page.isClosed()) throw error;
    });
}

type Patchable = Record<string | symbol, unknown>;
function patch(prototype: Patchable, names: readonly string[], pageOf: (self: never) => Page) {
  if (prototype[wrapped]) return;
  prototype[wrapped] = true;
  for (const name of names) {
    const original = prototype[name] as (...args: unknown[]) => Promise<unknown>;
    prototype[name] = async function (this: never, ...args: unknown[]) {
      await settled(pageOf(this));
      return original.apply(this, args);
    };
  }
}

export const test = base.extend({
  page: async ({ page }, use) => {
    patch(
      Object.getPrototypeOf(page.locator('body')) as Patchable,
      [...reads, ...actions],
      (self: Locator) => self.page(),
    );
    keyboards.set(page.keyboard, page);
    patch(
      Object.getPrototypeOf(page.keyboard) as Patchable,
      ['press', 'type'],
      (self: object) => keyboards.get(self) ?? page,
    );
    await use(page);
  },
});
export { expect } from '@playwright/test';
