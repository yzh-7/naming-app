import { test, expect } from '@playwright/test';

// 0.20.0：界面上打繁体也搜得到。这一批只能在真实界面上验：引擎单测看得到映射，
// 但「输入框里保留我打的字、匹配按简体去、旁边给一行对照」这件事是界面行为。
test.describe('打繁体也认', () => {
  test('姓打「蘇」：结果出来的是苏姓名字，输入框里仍是我打的那个字，下面给一行对照', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('姓（可复姓）').fill('蘇');
    const first = page.locator('article').first();
    await expect(first.locator('h3')).toContainText('苏');
    await expect(page.getByLabel('姓（可复姓）')).toHaveValue('蘇');
    await expect(page.getByRole('status').filter({ hasText: '按简体匹配：蘇 → 苏' })).toBeVisible();
    // 姓的读音那一段也该按简体查得到（苏是多音姓：sū 苏 / sù 苏）
    await expect(page.getByText(/姓的读音|姓首字/)).toBeVisible();
  });

  test('搜索打「雲」与打「云」：池内条数与卡片完全一样', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('姓（可复姓）').fill('苏');
    await page.getByRole('button', { name: '高级筛选' }).click();
    const summary = page.locator('p[title="「换一批」往后翻，翻满页数看遍全部"]');
    const search = page.getByLabel('搜索名字、拼音或篇名');

    await search.fill('雲');
    await expect(page.getByRole('status').filter({ hasText: '按简体匹配：雲 → 云' })).toBeVisible();
    const tradCount = await page.locator('article').count();
    expect(tradCount).toBeGreaterThan(0);
    const tradSummary = (await summary.innerText()).trim();

    await search.fill('云');
    await expect(page.locator('article')).toHaveCount(tradCount);
    expect((await summary.innerText()).trim(), '两种字形应当算出同一个池').toBe(tradSummary);
  });

  test('禁用字打「東」：卡片里不再出现带东的名字，且这一池仍有结果', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('姓（可复姓）').fill('苏');
    await page.getByRole('button', { name: '高级筛选' }).click();
    await page.getByLabel('禁用字（名里出现这些字的候选不出现）').fill('東');
    await expect(page.getByRole('status').filter({ hasText: '按简体匹配：東 → 东' })).toBeVisible();
    const cards = page.locator('article h3');
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    for (const t of await cards.allInnerTexts()) expect(t.includes('东'), t).toBe(false);
  });

  test('指定字打「東」：每条名字里都有东', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('姓（可复姓）').fill('苏');
    await page.getByRole('button', { name: '高级筛选' }).click();
    await page.getByLabel('指定用字（结果必须包含）').fill('東');
    const cards = page.locator('article h3');
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    for (const t of await cards.allInnerTexts()) expect(t.includes('东'), t).toBe(true);
  });

  test('收藏页搜索也归一：备注写简体，搜繁体也找得到那条', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('姓（可复姓）').fill('苏');
    const card = page.locator('article').first();
    const name = (await card.locator('h3').innerText()).trim();
    await card.getByRole('button', { name: '收藏' }).click();
    await page.getByRole('link', { name: /收藏 1/ }).click();
    await page.getByLabel(/的备注/).fill('喜欢云的意象');
    await page.getByLabel('搜索收藏').fill('雲');
    await expect(page.getByRole('status').filter({ hasText: '按简体匹配：雲 → 云' })).toBeVisible();
    await expect(page.getByRole('article').first().locator('h3')).toContainText(name.slice(1));
    await expect(page.getByRole('article')).toHaveCount(1);
  });
});
