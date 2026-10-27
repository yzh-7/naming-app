import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('首页可加载，填姓后有候选卡片', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /取名 · 典籍取词/ })).toBeVisible();
  await page.getByLabel('姓（可复姓）').fill('苏');
  await expect(page.locator('article').first()).toBeVisible();
});

test('收藏一个名字后能在收藏页搜到', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('苏');
  const card = page.locator('article').first();
  await card.getByRole('button', { name: '收藏' }).click();
  await expect(card.getByRole('button', { name: '已收藏' })).toBeVisible();
  await page.getByRole('link', { name: /收藏 1/ }).click();
  await expect(page.getByLabel('搜索收藏')).toBeVisible();
  await page.getByLabel('搜索收藏').fill('zzz-不存在');
  await expect(page.getByText(/没有符合搜索/)).toBeVisible();
});

test('页头昼夜三档：切深色后 html 出现 dark，切浅色后去掉，自选页也有', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: '昼夜主题' });
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: '深色主题' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await group.getByRole('button', { name: '浅色主题' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.goto('/#/compose');
  await expect(page.getByRole('group', { name: '昼夜主题' })).toBeVisible();
});

test('自选页：选字后给出出处与今译，无出处的组合明说没有', async ({ page }) => {
  await page.goto('/#/compose');
  await page.getByLabel('姓（可复姓）').fill('苏');
  await page.getByLabel('选择第 1 字').click();
  await page.getByLabel('第 1 字搜索').fill('子');
  await page.locator('div.flex.max-h-56 button').first().click();
  await page.getByLabel('选择第 2 字').click();
  await page.getByLabel('第 2 字搜索').fill('归');
  await page.locator('div.flex.max-h-56 button').first().click();
  await expect(page.getByRole('heading', { name: '苏子归' })).toBeVisible();
  await expect(page.getByText(/江有汜，之子归/)).toBeVisible();
  await expect(page.getByText(/今译/)).toBeVisible();
  await expect(page.getByRole('button', { name: '收藏' })).toBeVisible();

  // 换一个典籍里没有的搭配
  await page.getByLabel('选择第 1 字').click();
  await page.getByLabel('第 1 字搜索').fill('龙凤');
  await page.getByRole('button', { name: '直接使用「龙凤」' }).click();
  await expect(page.getByText(/没有「龙凤」这个搭配的出处/)).toBeVisible();
  await expect(page.getByRole('button', { name: '收藏' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '分享卡' })).toBeVisible();
});

test('axe：自选页无 serious/critical 级可访问性问题', async ({ page }) => {
  await page.goto('/#/compose');
  await page.getByLabel('姓（可复姓）').fill('苏');
  await page.getByLabel('选择第 1 字').click();
  await page.getByLabel('第 1 字搜索').fill('子');
  await page.locator('div.flex.max-h-56 button').first().click();
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
});

test('axe：生成页无 serious/critical 级可访问性问题', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('苏');
  await expect(page.locator('article').first()).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
});

test('篇名筛选：卡片上的「同篇还有 N 条」收到这一篇，「不限篇名」回到全部', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('苏');
  await expect(page.locator('article').first()).toBeVisible();
  const jump = page.getByRole('button', { name: /^同篇还有 \d+ 条$/ }).first();
  await expect(jump).toBeVisible();
  const want = (await jump.getAttribute('title'))!.match(/《(.+?)》/)![1];
  await jump.click();
  await expect(page.getByLabel('篇名（只看这一篇）')).toHaveValue(want);
  const arts = page.locator('article');
  const n = await arts.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await expect(arts.nth(i), `第 ${i + 1} 张卡不在《${want}》`).toContainText(`·${want}》`);
  await page.getByRole('button', { name: '不限篇名' }).click();
  await expect(page.getByLabel('篇名（只看这一篇）')).toHaveValue('');
  await expect(arts.first()).toBeVisible();
});

test('卡片上的「按拼音看」把这张卡的拼音写进搜索框', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('苏');
  await expect(page.locator('article').first()).toBeVisible();
  const btn = page.getByRole('button', { name: '按拼音看' }).first();
  await expect(btn).toBeVisible();
  const card = btn.locator('xpath=ancestor::article');
  const full = (await card.getByRole('heading', { level: 3 }).textContent())!;
  await btn.click();
  const value = await page.getByLabel('搜索名字、拼音或篇名').inputValue();
  expect(value).toBeTruthy();
  expect(
    [...value].every((c) => /[a-z0-9 ]/.test(c)),
    value,
  ).toBe(true);
  expect(page.getByText(/按拼音「.+」搜索同音写法/)).toBeVisible();
  // 搜索框里的拼音是这张卡的名字去姓后的写法，结果里应当还能看见这张卡
  await expect(page.getByRole('heading', { name: full })).toBeVisible();
});

test('收藏页：分组可改名、可解散（解散不删收藏），导出 CSV 给出下载', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('苏');
  const card = page.locator('article').first();
  await card.getByRole('button', { name: '收藏' }).click();
  await page.getByRole('link', { name: /收藏 1/ }).click();
  await page.getByLabel('分组').fill('备选');
  await page.getByRole('button', { name: '备选' }).click();
  await page.getByRole('button', { name: '改组名' }).click();
  await page.getByLabel('分组「备选」的新名字').fill('终选');
  await page.getByRole('button', { name: '改名' }).click();
  await expect(page.getByText('分组「备选」已改名为「终选」')).toBeVisible();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  const dl = await waiting;
  expect(dl.suggestedFilename()).toMatch(/^收藏-终选-\d{4}-\d{2}-\d{2}\.csv$/);
  const body = await dl.createReadStream().then(
    (rs) =>
      new Promise<string>((res) => {
        let t = '';
        rs.on('data', (c) => {
          t += c;
        });
        rs.on('end', () => res(t));
      }),
  );
  expect(body).toContain('分组');
  expect(body).toContain('终选');
  await page.getByRole('button', { name: '解散组' }).click();
  await expect(page.getByText(/分组「终选」已解散，1 条收藏回到未分组/)).toBeVisible();
  await expect(page.getByText('收藏 2')).toHaveCount(0);
  await expect(page.getByText('收藏 1')).toBeVisible();
});

test('名单图导出：说清二维码有没有画出来', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('苏');
  await page.locator('article').first().getByRole('button', { name: '收藏' }).click();
  await page.getByRole('link', { name: /收藏 1/ }).click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出名单图' }).click();
  const dl = await waiting;
  expect(dl.suggestedFilename()).toMatch(/^名单-\d{4}-\d{2}-\d{2}\.png$/);
  await expect(page.getByText(/名单图已生成（1 条），含扫码二维码/)).toBeVisible();
});

test('页脚给出应用版本与语料指纹，版本号与页面 meta 同源', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/应用版本 \d+\.\d+\.\d+ · 语料指纹 [0-9a-f]{12}（语料清单变化即变）/)).toBeVisible();
  const meta = await page.locator('meta[name="app-version"]').getAttribute('content');
  expect(meta, 'index.html 的 meta 应当被构建注入真实版本，不能留占位符').toMatch(/^\d+\.\d+\.\d+$/);
});

test('分享链接里的性别微调（gw）会带过来：带 gw=1 打开时「含疑似」是按下态', async ({ page }) => {
  await page.goto('/?s=苏&g=f&gw=1');
  const chip = page.getByRole('button', { name: '含「疑似偏女」' });
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  // 链接只覆盖它出现的项，没出现的沿用本机已存值；要看「链接里没带 gw」的默认态，得先清掉本机存储
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?s=苏&g=f');
  await expect(page.getByRole('button', { name: '含「疑似偏女」' })).toHaveAttribute('aria-pressed', 'false');
});

test('链接里的越界参数回默认值（不是夹到边界、也不是忽略）', async ({ page }) => {
  await page.goto('/?s=苏&n=601&pf=999&sm=999&nm=0');
  // 每批条数越界 → 回默认 12：池内计数按 12 一页分页
  await expect(page.getByText(/12×\d+页·第1页/)).toBeVisible();
  await page.getByRole('button', { name: '高级筛选' }).click();
  await expect(page.getByLabel('整名笔画上限')).toHaveValue('0');
  await expect(page.getByLabel('用字常见度下限')).toHaveValue('0');
  await expect(page.getByRole('button', { name: '避开同结构' })).toHaveAttribute('aria-pressed', 'false');
});

test('service worker：缓存名按当前产物算出来（不再写死），且确实把 shell 存进了这个缓存', async ({ page }) => {
  await page.goto('/');
  const info = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sw = reg.active ?? reg.installing ?? reg.waiting;
    // 页面侧的 caches 与 worker 侧看到的是同一份缓存存储，从这里读比 worker 内部 API 稳
    const keys = await caches.keys();
    const mine = keys.find((k) => k.startsWith('naming-app-'));
    return {
      scriptURL: sw?.scriptURL ?? '',
      keys,
      hasShell: mine ? Boolean(await caches.match('./index.html')) : false,
    };
  });
  // 注册参数带版本号（pwa.ts 与页脚、构建注入同源）
  expect(info.scriptURL).toMatch(/sw\.js\?v=\d+\.\d+\.\d+$/);
  // 站点版有带 hash 的分包产物 → 缓存名取产物名指纹（base36，不含点号），不是 version 回退、也不是 unreleased
  expect(info.keys, JSON.stringify(info.keys)).toEqual([expect.stringMatching(/^naming-app-[0-9a-z]+$/)]);
  expect(info.hasShell, 'install 阶段应把 shell 写进解析出来的那个缓存').toBe(true);
});

test('生成页的禁用字（避讳字）：输入后卡片名字都不含它，「不限」回到原池', async ({ page }) => {
  await page.goto('/?s=苏');
  const arts = page.locator('article');
  await expect(arts.first()).toBeVisible();
  const summary = page.getByTitle('「换一批」往后翻，翻满页数看遍全部');
  const poolOf = async () => Number((await summary.textContent())!.match(/候选池 ([\d,]+) 条/)![1].replace(/,/g, ''));
  const before = await poolOf();
  await page.getByLabel('禁用字（名里出现这些字的候选不出现）').fill('月');
  await expect(arts.first()).toBeVisible();
  const after = await poolOf();
  expect(after, '名里带「月」的搭配要整条出去').toBeLessThan(before);
  const n = await arts.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const full = (await arts.nth(i).getByRole('heading', { level: 3 }).textContent())!;
    expect(full, `第 ${i + 1} 张卡的名字含禁用字：${full}`).not.toContain('月');
  }
  await page.getByRole('button', { name: '清除禁用字' }).click();
  await expect(page.getByLabel('禁用字（名里出现这些字的候选不出现）')).toHaveValue('');
  expect(await poolOf()).toBe(before);
});

test('分享链接里的禁用字（ac）会带过来：打开时输入框已填好，结果里不含它', async ({ page }) => {
  await page.goto('/?s=苏&ac=' + encodeURIComponent('月'));
  await expect(page.getByLabel('禁用字（名里出现这些字的候选不出现）')).toHaveValue('月');
  const arts = page.locator('article');
  const n = await arts.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const full = (await arts.nth(i).getByRole('heading', { level: 3 }).textContent())!;
    expect(full, `链接带 ac=月 却出现了含月的名字：${full}`).not.toContain('月');
  }
});

test('禁用字只查名不查姓：姓自己带这个字，候选不受影响', async ({ page }) => {
  await page.goto('/?s=柳&ac=' + encodeURIComponent('柳'));
  await expect(page.getByLabel('禁用字（名里出现这些字的候选不出现）')).toHaveValue('柳');
  const arts = page.locator('article');
  const n = await arts.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const full = (await arts.nth(i).getByRole('heading', { level: 3 }).textContent())!;
    expect(full.startsWith('柳'), `第 ${i + 1} 张卡的姓丢了：${full}`).toBe(true);
    expect(full.slice(1), `名里还留着禁用字：${full}`).not.toContain('柳');
  }
});

test('禁用字是一个字一个字打出来的：后打的字不把先打的字顶掉', async ({ page }) => {
  // fill() 是一次性灌进去的，测不出「打字过程中输入框被重建」这类问题，所以这里逐字符输入
  await page.goto('/?s=苏');
  const box = page.getByLabel('禁用字（名里出现这些字的候选不出现）');
  const summary = page.getByTitle('「换一批」往后翻，翻满页数看遍全部');
  const poolOf = async () => Number((await summary.textContent())!.match(/候选池 ([\d,]+) 条/)![1].replace(/,/g, ''));
  const before = await poolOf();
  await box.click();
  await box.pressSequentially('月');
  await expect(box).toHaveValue('月');
  await box.pressSequentially('风');
  await expect(box, '打「风」的瞬间框里只剩「月」').toHaveValue('月风');
  await expect(page.getByText('已填 2/8 个字')).toBeVisible();
  const two = await poolOf();
  await box.fill('月');
  const one = await poolOf();
  expect(before, '填了「月」就该比不设时窄').toBeGreaterThan(one);
  expect(one, '第二个字没生效的话，两个字的池和一个是同一个数').toBeGreaterThan(two);
  const arts = page.locator('article');
  const n = await arts.count();
  for (let i = 0; i < n; i++) {
    const full = (await arts.nth(i).getByRole('heading', { level: 3 }).textContent())!;
    expect(full, `第 ${i + 1} 张卡带回了禁用字：${full}`).not.toContain('月');
  }
});
