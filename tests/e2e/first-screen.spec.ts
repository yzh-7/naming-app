import { test, expect } from '@playwright/test';

// 390×844 的首屏验收：引导语与第一张卡片都要落在首屏那一屏之内；
// 卡片不点开任何折叠也要读得到原句、取词段、今译与分数合计；收藏页卡底不许再挤成三件。
test.use({ viewport: { width: 390, height: 844 } });

const controlsIn = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const card = document.querySelector('main section.card');
    if (!card) throw new Error('生成页找不到筛选卡片');
    return [...card.querySelectorAll('input, select, button')]
      .filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest('.sr-only'))
      .map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 12));
  });

test('首访：引导语与姓输入框都在首屏之内，筛选只剩四行', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, 0));
  const guide = page.getByText(/先填姓氏/);
  const gb = await guide.boundingBox();
  expect(gb, '首访时找不到引导语').not.toBeNull();
  expect(gb!.y, `引导语 top=${gb!.y}px：应当在首屏之内（<400）`).toBeLessThan(400);
  expect(gb!.y + gb!.height, `引导语底边 ${gb!.y + gb!.height}px：整段应当在 844 之内`).toBeLessThanOrEqual(844);
  const sur = await page.getByLabel('姓（可复姓）').boundingBox();
  expect(gb!.y, '引导语应当排在姓输入框之前').toBeLessThan(sur!.y);
  expect(sur!.y, `姓输入框 top=${sur!.y}px：应当在首屏之内`).toBeLessThanOrEqual(844);
  const controls = await controlsIn(page);
  expect(controls, `首访时筛选卡片里的控件：${controls.join(' / ')}`).toHaveLength(3);
  await expect(page.getByRole('button', { name: /高级筛选/ })).toBeVisible();
  // 手机上的次要条件默认不渲染（不是 display:none，是真的不在可访问性树里）
  await expect(page.getByLabel('搜索名字、拼音或篇名')).toHaveCount(0);
  await expect(page.getByLabel('禁用字（名里出现这些字的候选不出现）')).toHaveCount(0);
  await page.getByRole('button', { name: /高级筛选/ }).click();
  await expect(page.getByLabel('搜索名字、拼音或篇名')).toBeVisible();
  await expect(page.getByRole('group', { name: '性别风格' })).toBeVisible();
});

test('填「袁」之后第一张卡片落在首屏之内（原来 top=1167，首屏 0 张）', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('袁');
  const first = page.locator('main article').first();
  await expect(first).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  const controls = await controlsIn(page);
  expect(controls, `填姓后筛选卡片里的控件：${controls.join(' / ')}`).toHaveLength(4);
  const b = await first.boundingBox();
  expect(b!.y, `第一张卡片 top=${b!.y}px：应当在 844 之内`).toBeLessThanOrEqual(844);
  expect(b!.height, '卡片本身仍然是一张完整的卡').toBeGreaterThan(200);
});

test('卡片不点开任何折叠：原句、取词段高亮、今译与分数合计都在卡上', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('袁');
  const card = page.locator('main article').first();
  await expect(card).toBeVisible();
  const src = card.locator('[data-block="source"]');
  await expect(src).toBeVisible();
  await expect(src.locator('mark'), '取词段应当在原句里高亮').not.toHaveCount(0);
  await expect(src).toContainText('《');
  await expect(src).toContainText('取词段第');
  await expect(src.getByText('今译')).toBeVisible();
  expect(await src.evaluate((el) => Boolean(el.closest('details'))), '出处那一块不该再包在 details 里').toBe(false);
  const total = ((await card.locator('[data-block="score-total"]').innerText()) ?? '').replace(/\s+/g, ' ');
  expect(total, `分数合计应当常驻在名字那一行：${total}`).toMatch(/^分数合计 \d+$/);
  const score = card.locator('details[data-block="score"]');
  const alts = card.locator('details[data-block="alts"]');
  const hasAlts = (await alts.count()) > 0;
  await expect(score, '「分数明细」那个折叠必须还在').toHaveCount(1);
  await expect(card.locator('details'), '卡上的折叠只有两种：分数明细，与（有别处出处时）另有出处').toHaveCount(
    hasAlts ? 2 : 1,
  );
  expect(await score.evaluate((d) => (d as HTMLDetailsElement).open), '分数明细默认折叠').toBe(false);
  if (hasAlts) {
    expect(
      await alts.evaluate((d) => (d as HTMLDetailsElement).open),
      '「另有出处」默认折叠：常驻的仍是主出处那一句',
    ).toBe(false);
    const label = ((await alts.locator('summary').innerText()) ?? '').trim();
    expect(label, `折叠标题要写清处数：${label}`).toMatch(/^另有 \d+ 处出处$/);
    await expect(alts.locator('li').first(), '合着的折叠不许占卡上的高度').toBeHidden();
  }
  const sb = await src.boundingBox();
  const db = await score.boundingBox();
  expect(sb!.height, `出处块 ${sb!.height}px 应当不低于分数块 ${db!.height}px`).toBeGreaterThanOrEqual(db!.height);
  if (hasAlts) {
    const ab = await alts.boundingBox();
    expect(ab!.height, `合着的「另有出处」只是一行入口，不该占掉整块高度：${ab!.height}px`).toBeLessThanOrEqual(56);
  }
});

test('真实人名档的卡：「真名 · N 人用过」与「非典籍出处」那一行常驻', async ({ page }) => {
  await page.goto('/?s=袁&src=real');
  const card = page.locator('article.card').first();
  await expect(card).toBeVisible();
  const src = card.locator('[data-block="source"]');
  await expect(src).toContainText(/真实人名 · 语料里 \d+ 人用过（非典籍出处）/);
  await expect(src.getByText(/这条不是典籍出处/)).toBeVisible();
  await expect(
    card.locator('details[data-block="alts"]'),
    '真实人名卡不许有「另有出处」那一区（它没有典籍出处）',
  ).toHaveCount(0);
  await expect(card.locator('.chip', { hasText: /^真名 · \d+ 人用过$/ }), '名字那一行的真名标签不许消失').toHaveCount(
    1,
  );
  const total = ((await card.locator('[data-block="score-total"]').innerText()) ?? '').replace(/\s+/g, ' ');
  expect(total).toMatch(/^分数合计 \d+$/);
});

test('收藏页卡底：整行备注 ＋ 一个「分组／对比」入口，分组与对比的功能一条不少', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('袁');
  const cards = page.locator('main article');
  await cards.nth(0).getByRole('button', { name: '收藏', exact: true }).click();
  await cards.nth(1).getByRole('button', { name: '收藏', exact: true }).click();
  await page.getByRole('link', { name: /收藏 2/ }).click();
  const band = cards.first().locator('xpath=following-sibling::*[1]');
  const note = band.getByPlaceholder('为什么喜欢它');
  const nb = await note.boundingBox();
  expect(nb!.width, `备注输入宽度 ${nb!.width}px：应当 ≥300px（原来只有 90px）`).toBeGreaterThanOrEqual(300);
  await expect(band.getByRole('button'), '卡底只留一个入口').toHaveCount(1);
  const entry = band.getByRole('button', { name: '分组／对比' });
  await expect(entry).toHaveAttribute('aria-expanded', 'false');
  await entry.click();
  await expect(entry).toHaveAttribute('aria-expanded', 'true');
  // 对比：勾两条出对比表
  await band.getByLabel('对比').check();
  const band2 = cards.nth(1).locator('xpath=following-sibling::*[1]');
  await band2.getByRole('button', { name: '分组／对比' }).click();
  await band2.getByLabel('对比').check();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('rowheader', { name: '分数' })).toBeVisible();
  // 分组：写组名 → 按组筛的 chip 出现 → 选中这组后整组改名／解散的组工具出现
  await band.getByLabel('分组').fill('备选');
  const chip = page.getByRole('button', { name: '备选', exact: true });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole('button', { name: '改组名' })).toBeVisible();
  await expect(page.getByRole('button', { name: '解散组' })).toBeVisible();
});
