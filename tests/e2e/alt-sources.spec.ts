import { expect, test, type Page } from '@playwright/test';

// 「另有 N 处出处」那一区的端到端验收。用全池出处最多的那条当尺子：
// 君子的主出处是《关雎》，它在七本典籍里另有 288 处可核对的出处。
// 0.17.0 起这一区分页：默认只给前 12 处，翻页与「全部展开」都在同一区里，
// 全部展开时必须一处不少（不是抽样、不是「等等」），而且不许把版面撑出横向滚动。
const JUNZI = '/?s=袁&q=君子';
const PAGED = 12;

const junziCard = (page: Page) =>
  page
    .locator('article.card')
    .filter({ has: page.getByRole('heading', { name: '袁君子' }) })
    .first();

const measure = async (page: Page, label: string) => {
  await page.goto(JUNZI);
  const card = junziCard(page);
  await expect(card, '搜「君子」应当给出那张卡').toBeVisible();
  const d = card.locator('details[data-block="alts"]');
  await expect(d, '主出处之外还有别处的卡必须有「另有 N 处出处」这一区').toHaveCount(1);
  const summary = d.locator('summary');
  const title = ((await summary.innerText()) ?? '').trim();
  const n = Number((title.match(/\d+/) ?? [])[0] ?? 0);
  expect(title, `折叠标题要写清处数：${title}`).toMatch(/^另有 \d+ 处出处$/);
  expect(n).toBeGreaterThan(200);

  const more = d.locator('li[data-alt-more]');
  await expect(d.locator('li[data-alt]'), `默认只该给前 ${PAGED} 处，而不是 ${n} 处全渲染`).toHaveCount(PAGED);
  await expect(more, '分了页就要有一行写明显示了多少、还剩多少').toHaveCount(1);
  // 合着的时候 innerText 是空的（不可见元素），这一行断言按 textContent 取
  expect(((await more.textContent()) ?? '').replace(/\s+/g, ' ')).toContain(`已显示 ${PAGED}／${n} 处`);
  await expect(d.locator('li[data-alt]').first(), '合着的时候不许占卡上的高度').toBeHidden();

  const closed = await card.boundingBox();
  const row = await d.boundingBox();
  await summary.click();
  await expect(d.locator('li[data-alt]').first(), '点开之后前 12 处要渲染出来').toBeVisible();
  const paged = await card.boundingBox();

  await d.getByRole('button', { name: `再显示 ${PAGED} 处` }).click();
  await expect(d.locator('li[data-alt]'), '翻一页要多给 12 处').toHaveCount(PAGED * 2);

  await d.getByRole('button', { name: /全部展开/ }).click();
  await expect(d.locator('li[data-alt]'), `全部展开必须给到标题里那个处数（${n}），不是抽样`).toHaveCount(n);
  expect(((await more.textContent()) ?? '').replace(/\s+/g, ' ')).toContain(`已显示 ${n}／${n} 处`);

  const open = await card.boundingBox();
  const itemHeights = await d
    .locator('li[data-alt]')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log(
    JSON.stringify({
      视口: label,
      处数: n,
      折叠入口高: Math.round(row?.height ?? -1),
      卡片折叠时高: Math.round(closed?.height ?? -1),
      卡片默认分页时高: Math.round(paged?.height ?? -1),
      卡片全部展开后高: Math.round(open?.height ?? -1),
      每处平均高: Math.round(itemHeights.reduce((a, b) => a + b, 0) / itemHeights.length),
      横向溢出: overflow,
    }),
  );

  return { n, closed, paged, open, row, overflow };
};

for (const label of ['390×844', '1440×900']) {
  test.describe(`另有 N 处出处（${label}）`, () => {
    test.use({
      viewport: label === '390×844' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    });

    test('默认只给一页；全部展开后每一处都有 书·篇＋原句（那两个取字高亮）＋今译', async ({ page }) => {
      const { n, closed, paged, open, overflow } = await measure(page, label);
      const items = junziCard(page).locator('details[data-block="alts"] li[data-alt]');
      expect((await items.count()).toString()).toBe(String(n));
      expect(open!.height, '全部展开之后卡片必须真的长出这些条目').toBeGreaterThan(paged!.height);
      expect(open!.height, '展开之后卡片必须比折叠时长出这些条目的高度').toBeGreaterThan(closed!.height + PAGED * 20);
      const first = items.first();
      await expect(first.locator('mark'), '取词的那两个字要在原句里高亮出来').not.toHaveCount(0);
      await expect(first, '每一处都要写清是哪本书的哪一篇').toContainText('《');
      await expect(first.locator('p', { hasText: /今译/ }).first(), '今译必须在').toBeVisible();
      const marks = await items.evaluateAll((els) => els.map((e) => e.querySelectorAll('mark').length));
      expect(marks.length, '展开区里的条目数').toBe(n);
      expect(marks.filter((k) => k === 0).length, '每一处原句里的取词段都要高亮，不许只给第一条高亮').toBe(0);
      const glosses = await items.evaluateAll((els) => els.filter((e) => e.textContent!.includes('今译')).length);
      expect(glosses, '每一处都要有今译（0.16.0 起别处出处也全带译文）').toBe(n);
      expect(overflow, `${label} 下全部展开这一区不许把版面撑出横向滚动`).toBeLessThanOrEqual(1);
    });

    test('全部展开之后能收回默认那一页（分页不是单向的）', async ({ page }) => {
      await page.goto(JUNZI);
      const d = junziCard(page).locator('details[data-block="alts"]');
      await d.locator('summary').click();
      await d.getByRole('button', { name: /全部展开/ }).click();
      // 键盘用户点完不该掉回页头：焦点要落在这行里还在的按钮上
      await expect(d.getByRole('button', { name: /只留前 12 处/ }), '「全部展开」之后焦点要移交').toBeFocused();
      const all = await d.locator('li[data-alt]').count();
      expect(all, '全部展开之后应先给到几百处').toBeGreaterThan(100);
      await d.getByRole('button', { name: /只留前 \d+ 处/ }).click();
      await expect(d.locator('li[data-alt]'), '要能收回默认那一页').toHaveCount(PAGED);
      await expect(d.getByRole('button', { name: `再显示 ${PAGED} 处` }), '收回之后焦点也留在这一行').toBeFocused();
      expect(((await d.locator('li[data-alt-more]').textContent()) ?? '').replace(/\s+/g, ' ')).toContain(
        `已显示 ${PAGED}／`,
      );
    });

    test('多了这一区也不许动常驻的那一层：主原句、今译与分数合计不点开也读得到', async ({ page }) => {
      await page.goto(JUNZI);
      const card = junziCard(page);
      const src = card.locator('[data-block="source"]');
      await expect(src.locator('mark'), '主原句里的取词段高亮不许少').not.toHaveCount(0);
      expect(await src.evaluate((el) => Boolean(el.closest('details'))), '主出处块不该被包进折叠').toBe(false);
      const total = ((await card.locator('[data-block="score-total"]').innerText()) ?? '').replace(/\s+/g, ' ');
      expect(total, '分数合计仍要常驻在名字那一行').toMatch(/^分数合计 \d+$/);
    });
  });
}

test.describe('只有一处出处的卡与真实人名卡', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('真实人名卡不许出现「另有出处」那一区（它没有典籍出处）', async ({ page }) => {
    await page.goto('/?s=袁&src=real');
    const real = page.locator('article.card').first();
    await expect(real).toBeVisible();
    await expect(real.locator('details[data-block="alts"]'), '真实人名卡没有典籍出处，不许有这个区').toHaveCount(0);
  });
  test('只核对到一处出处的典籍卡也不许出现这一区（不装作有别处）', async ({ page }) => {
    // 庆云：有成词依据（默认筛选要这个），但语料里只核对到这一处
    await page.goto('/?s=袁&q=庆云');
    const one = page
      .locator('article.card')
      .filter({ has: page.getByRole('heading', { name: '袁庆云' }) })
      .first();
    await expect(one, '搜「庆云」应当给出那张卡').toBeVisible();
    await expect(one.locator('[data-block="source"]'), '这张卡得有主出处').toHaveCount(1);
    await expect(one.locator('details[data-block="alts"]'), '只核对到一处出处的卡不许有这个区').toHaveCount(0);
    await expect(one.locator('li[data-alt-more]'), '没有别处的卡更不许出现翻页那一行').toHaveCount(0);
  });
});
