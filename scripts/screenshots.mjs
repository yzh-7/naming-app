// 文档截图：对 `vite preview` 伺服的 dist 产物实拍，产物存 docs/screenshots/。
// 用法：先 npm run build，再 npx vite preview --port 5180 --strictPort（后台），
//      node scripts/screenshots.mjs && node scripts/screenshots.mjs --clean
// --clean：清掉 Service Worker 与持久化状态后补拍（避免 SW 缓存旧版、卡片带收藏勾）。
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5180/';
const SHOTS = [
  { file: 'generate-light.png', hash: '', theme: 'light', surname: '林', viewport: { width: 1280, height: 900 } },
  { file: 'generate-dark.png', hash: '', theme: 'dark', surname: '林', viewport: { width: 1280, height: 900 } },
  { file: 'compose.png', hash: '#/compose', theme: 'light', surname: '', viewport: { width: 1280, height: 900 } },
  { file: 'generate-mobile.png', hash: '', theme: 'light', surname: '林', viewport: { width: 390, height: 844 } },
];

async function composeFill(page) {
  // 复刻 e2e 的自选路径：苏子归（楚辞·江有汜）
  await page.getByLabel('姓（可复姓）').fill('苏');
  await page.getByLabel('选择第 1 字').click();
  await page.getByLabel('第 1 字搜索').fill('子');
  await page.locator('[data-char-grid] button').first().click();
  await page.getByLabel('选择第 2 字').click();
  await page.getByLabel('第 2 字搜索').fill('归');
  await page.locator('[data-char-grid] button').first().click();
  await page.getByRole('heading', { name: '苏子归' }).waitFor();
}

const clean = process.argv.includes('--clean');
const browser = await chromium.launch();
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: s.viewport, deviceScaleFactor: 2 });
  await page.addInitScript(([theme, surname, wipe]) => {
    if (wipe) for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
    localStorage.setItem('naming.theme.v1', theme);
    if (surname) localStorage.setItem('naming.surname.v1', surname);
  }, [s.theme, s.surname, clean]);
  await page.goto(BASE + s.hash, { waitUntil: 'networkidle' });
  if (s.hash === '#/compose') {
    await composeFill(page);
  } else {
    await page.locator('article').first().waitFor();
  }
  if (clean) {
    // 补拍一轮：清完持久化后 SW 可能已注册，重新载入取干净状态
    await page.reload({ waitUntil: 'networkidle' });
    if (s.hash === '#/compose') await composeFill(page);
    else await page.locator('article').first().waitFor();
  }
  await page.screenshot({ path: `docs/screenshots/${s.file}`, fullPage: false });
  console.log('captured', s.file);
  await page.close();
}
await browser.close();
