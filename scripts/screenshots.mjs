// 文档截图：对 `vite preview` 伺服的 dist 产物实拍，产物存 docs/screenshots/。
// 用法：先 npm run build，再 node scripts/screenshots.mjs（5180 上没人应答就自己起 preview）
// --clean：清掉 Service Worker 与持久化状态后补拍（避免 SW 缓存旧版、卡片带收藏勾）。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';

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

const ping = () =>
  new Promise((res) => {
    const req = http.get(BASE, (r) => {
      r.resume();
      res(true);
    });
    req.on('error', () => res(false));
    req.setTimeout(400, () => {
      req.destroy();
      res(false);
    });
  });

let server = null;
if (!(await ping())) {
  server = spawn(
    'node',
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5180', '--strictPort'],
    { stdio: 'ignore' },
  );
  process.on('exit', () => server?.kill());
  for (let i = 0; i < 60 && !(await ping()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!(await ping())) {
    console.error('起不了 vite preview：先 npm run build（dist 要存在）');
    process.exit(2);
  }
}

const clean = process.argv.includes('--clean');
const browser = await chromium.launch();
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: s.viewport, deviceScaleFactor: 2 });
  await page.addInitScript(
    ([theme, surname, wipe]) => {
      if (wipe) for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      localStorage.setItem('naming.theme.v1', theme);
      if (surname) localStorage.setItem('naming.surname.v1', surname);
    },
    [s.theme, s.surname, clean],
  );
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
server?.kill();
process.exit(0);
