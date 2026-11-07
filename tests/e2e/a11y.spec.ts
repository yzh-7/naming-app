import { test, expect } from '@playwright/test';

// 0.18.0 加的三件事，都在真浏览器里量：跳到内容、破坏性操作的撤销、Windows 高对比模式。
const SURNAME = '苏';

async function openGenerated(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill(SURNAME);
  await expect(page.getByRole('article').first()).toBeVisible();
}

test('键盘第一站是「跳到内容」，回车之后焦点真的落到正文上', async ({ page }) => {
  // 这一条要在没碰过任何控件的新页面上量：脚本 blur 之后浏览器的「顺序聚焦起点」还停在
  // 刚才那个控件上，Tab 从它后面数起，跳到内容会被跳过（本机实测踩过这个坑）。
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const skip = page.getByRole('link', { name: '跳到内容' });
  // 平时它是 sr-only：Tailwind 把它缩成 1px 见方并 clip 掉，看不见也不占位
  const hidden = await skip.boundingBox();
  expect(hidden === null || hidden.height <= 1, '没按 Tab 之前它不该看得见').toBeTruthy();

  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveText('跳到内容');
  const shown = await skip.boundingBox();
  expect(shown, '聚焦后它要真的显出来（focus:not-sr-only）').not.toBeNull();
  expect(shown!.height).toBeGreaterThan(20);

  await page.keyboard.press('Enter');
  const activeId = await page.evaluate(() => document.activeElement?.id ?? '');
  expect(activeId, '回车之后焦点要落在 main 上，屏幕阅读器才接着读正文').toBe('main');
});

test('拉黑之后能撤销；撤销把卡片与名单都恢复回去', async ({ page }) => {
  await openGenerated(page);
  const blockedName = (await page.getByRole('article').first().locator('h3').innerText()).trim();
  await page.getByRole('button', { name: '拉黑' }).first().click();
  await expect(page.getByRole('link', { name: '拉黑 1' })).toBeVisible();

  const undo = page.getByRole('button', { name: /^撤销「/ });
  await expect(undo).toHaveText(`撤销「拉黑 ${blockedName}」`);
  await undo.click();
  await expect(page.getByRole('link', { name: '拉黑 0' })).toBeVisible();
  await expect(page.getByText(`已撤销：拉黑 ${blockedName}`)).toBeVisible();
  // 撤销条用完就收掉：留着会给第二次误操作一个假的安全感
  await expect(page.getByRole('button', { name: /^撤销「/ })).toHaveCount(0);
});

test('收藏之后能撤销，收藏页回到空', async ({ page }) => {
  await openGenerated(page);
  await page.getByRole('button', { name: '收藏' }).first().click();
  await expect(page.getByRole('link', { name: '收藏 1' })).toBeVisible();
  await page.getByRole('button', { name: /^撤销「收藏 / }).click();
  await expect(page.getByRole('link', { name: '收藏 0' })).toBeVisible();
  await page.getByRole('link', { name: '收藏 0' }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test.describe('Windows 高对比（强制颜色）模式', () => {
  test('只靠颜色传达的两处，在强制颜色下有不靠颜色的第二层表达', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', '强制颜色只能靠 CDP 在 Chromium 里模拟');
    await openGenerated(page);
    const mark = page.locator('article mark').first();
    const ctl = page.getByRole('button', { name: '收藏' }).first();
    const before = await Promise.all([
      mark.evaluate((el) => getComputedStyle(el).textDecorationLine),
      ctl.evaluate((el) => getComputedStyle(el).borderTopWidth),
    ]);
    expect(before[0], '平时取词高亮靠底色，不带下划线').toBe('none');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    const after = await Promise.all([
      mark.evaluate((el) => getComputedStyle(el).textDecorationLine),
      ctl.evaluate((el) => getComputedStyle(el).borderTopWidth),
      mark.evaluate((el) => getComputedStyle(el).fontWeight),
    ]);
    expect(after[0], '强制颜色下底色没了，取词高亮要带下划线').toBe('underline');
    expect(after[2], '取词高亮要加粗').toBe('700');
    expect(['1px', '2px'], '按钮在强制颜色下必须有看得见的边框').toContain(after[1]);
  });
});
