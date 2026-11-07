import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 0.19.0：对外元信息（canonical、robots、sitemap、noscript、manifest）与「本机全量备份」。
// 这一批文件的特点是——页面不请求它们，所以只能直接从服务器上量，光看界面看不出来。
const SITE = 'https://yzh-7.github.io/naming-app/';

test('canonical 指向站点根地址，且与 og:url 说的是同一个', async ({ page }) => {
  await page.goto('/');
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  // og:url 用的是 content 属性（Open Graph 的写法），canonical 用的是 href：两处都得读对
  const og = await page.locator('meta[property="og:url"]').getAttribute('content');
  expect(canonical).toBe(SITE);
  expect(og, '两处地址不一致的话，抓取器会把其中一个当重复页').toBe(canonical);
});

test('robots.txt 允许收录并指向 sitemap，sitemap 里那个地址就是本站', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status(), 'robots.txt 没随 dist 发出去').toBe(200);
  const rt = await robots.text();
  expect(rt).toMatch(/^User-agent: \*/m);
  expect(rt).toMatch(/Allow: \//m);
  expect(rt).toContain('Sitemap: ' + SITE + 'sitemap.xml');

  const map = await request.get('/sitemap.xml');
  expect(map.status()).toBe(200);
  const xml = await map.text();
  expect(xml).toContain('<loc>' + SITE + '</loc>');
  // 不写 lastmod：那是发布时刻的派生值，本项目的应用版本只由 package.json 说话
  expect(xml).not.toContain('<lastmod>');
});

test('manifest 有 id 与 categories，主题色与页面的浅色 theme-color meta 同值', async ({ page, request }) => {
  await page.goto('/');
  const light = await page.locator('meta[name="theme-color"][media*="light"]').getAttribute('content');
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.id, '没有 id 时安装出来的应用与网页是两个身份').toBe(SITE);
  expect(manifest.categories).toEqual(expect.arrayContaining(['reference', 'productivity']));
  expect(manifest.theme_color, 'manifest 只有一个主题色，它得跟页面底色一致，否则安装期闪一下别的颜色').toBe(light);
  expect(manifest.background_color).toBe(light);
  // 图标口径不变：any 与 maskable 两种用途都在
  const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose ?? 'any');
  expect(purposes).toContain('maskable');
});

test('关掉 JavaScript 也有一句人话：noscript 内容在服务器返回的 HTML 里', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html, 'noscript 必须写在服务端 HTML 里，靠 JS 插进去就没意义了').toContain('<noscript>');
  expect(html).toMatch(/需要浏览器允许执行 JavaScript|允许执行 JavaScript/);
  expect(html).toMatch(/github\.com\/yzh-7\/naming-app/);
});

test('导出的那份 JSON 是本机全量备份：收藏、拉黑、姓氏、筛选、主题都在，清空后能还原', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('苏');
  await page.getByRole('button', { name: '深色主题' }).click();
  const card = page.locator('article').first();
  const name = (await card.locator('h3').innerText()).trim();
  await card.getByRole('button', { name: '收藏' }).click();
  await page.locator('article').nth(1).getByRole('button', { name: '拉黑' }).click();

  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出' }).click();
  const file = await waiting;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naming-backup-'));
  const backup = path.join(dir, 'backup.json');
  await file.saveAs(backup);
  const state = JSON.parse(fs.readFileSync(backup, 'utf8'));
  expect(state.app).toBe('naming-app');
  expect(state.favorites).toHaveLength(1);
  expect(state.blocklist).toHaveLength(1);
  expect(state.surname).toBe('苏');
  expect(state.theme, '主题档没进备份的话，换设备还得重设一遍').toBe('dark');

  // 换一个"新设备"：清掉本机存储再刷新，然后导入这份备份
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('link', { name: '收藏 0' })).toBeVisible();
  // 走真实路径：点「导入」→ 系统文件选择器 → 选那份备份。那个 input 本身是 display:none，
  // 直接对它 setInputFiles 不是用户能做的事，也不该由测试绕过。
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入' }).click();
  await (await chooser).setFiles(backup);
  await expect(page.getByText(/这份文件含收藏 1 条 · 拉黑 1 条/)).toBeVisible();
  await page.getByRole('button', { name: '覆盖' }).click();

  await expect(page.getByRole('link', { name: '收藏 1' })).toBeVisible();
  await expect(page.getByRole('link', { name: '拉黑 1' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('naming.theme.v1'))).toBe('dark');
  expect(
    await page.evaluate(() => document.documentElement.classList.contains('dark')),
    '导入主题之后当前这页就该是深色，不该等下次打开',
  ).toBe(true);
  await page.getByRole('link', { name: '收藏 1' }).click();
  await expect(page.getByRole('article').first().locator('h3')).toContainText(name.slice(1));
  fs.rmSync(dir, { recursive: true, force: true });
});
