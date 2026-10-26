// 设计体检：不靠眼睛看，靠量。对 vite preview 伺服的 dist 产物，在若干视口 × 浅色/深色 × 四个页
// 上量：横向溢出、触控目标尺寸、文字对比度（WCAG）、行长（中文按字宽折算）、字号分布、粘性页头是否压住内容。
// 用法：npm run build && node scripts/design-audit.mjs [--json] [--verbose]
// 127.0.0.1:5180 上没人伺服时，脚本自己起一个 vite preview，跑完收掉。
// 退出码 0 = 无硬违规（溢出 / <24px 目标 / 对比度不达标）；1 = 有硬违规。
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5180/';
const VIEWPORTS = [
  { name: '320', width: 320, height: 640, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '768', width: 768, height: 900, mobile: true },
  { name: '1024', width: 1024, height: 900, mobile: false },
  { name: '1440', width: 1440, height: 1000, mobile: false },
];
const THEMES = ['light', 'dark'];
// 每个视口×主题里按 生成 → 自选 → 收藏 → 拉黑 的顺序走一遍（同一次会话，id 都是真的）

const inCI = !!process.env.GITHUB_ACTIONS;
const annotate = (level, msg) => { if (inCI) console.log(`::${level}::${msg}`); };

const jsonOut = process.argv.includes('--json');
const verbose = process.argv.includes('--verbose');

/** 在页面里跑一遍度量，返回结构化结果。自成一体（不依赖外部闭包）。 */
function measure([vw, mobile]) {
  const px = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const mix = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const c = px(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a === 1) break;
      if (e === document.documentElement) break;
    }
    let res = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) res = mix(stack[i], res);
    return res;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const sel = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = [...el.classList].filter((c) => !/^(sm|lg|xl|xs|md):/.test(c)).slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}`;
  };
  const shown = (el, rect) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    if (!rect.width || !rect.height) return false;
    if (rect.right < 0 || rect.left > vw || rect.bottom < 0) return false;
    return true;
  };

  const docScroll = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const overflow = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!shown(el, r)) continue;
    if (r.right > vw + 1 || r.left < -1) {
      overflow.push({ sel: sel(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), text: (el.textContent || '').trim().slice(0, 24) });
    }
  }

  const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"]';
  const targetsSmall = [];
  const targetsShort = [];
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (el instanceof HTMLInputElement && (el.type === 'file' || el.type === 'hidden')) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (el.closest('[hidden]')) continue;
    if (el.closest('.sr-only')) continue;   // 只给读屏软件的元素不是触控目标（跳转链接等）
    const r = el.getBoundingClientRect();
    if (!shown(el, r)) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      const lab = el.closest('label');
      const lr = lab ? lab.getBoundingClientRect() : null;
      if (lr && lr.height >= 44 && lr.width >= 24) continue;
    }
    const rec = { sel: sel(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) };
    if (rec.w < 24 || rec.h < 24) targetsSmall.push(rec);
    else if (mobile && rec.h < 44) targetsShort.push(rec);
  }

  const contrastBad = [];
  const fonts = {};
  const longLines = [];
  const headingSizes = [];
  for (const el of document.querySelectorAll('body *')) {
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasOwnText) continue;
    const r = el.getBoundingClientRect();
    if (!shown(el, r)) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    fonts[size] = (fonts[size] || 0) + 1;
    const fg = mix(px(cs.color) || { r: 0, g: 0, b: 0, a: 1 }, bgOf(el));
    const c = ratio(fg, bgOf(el));
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    if (c < (large ? 3 : 4.5)) {
      contrastBad.push({ sel: sel(el), ratio: Number(c.toFixed(2)), size, weight, color: cs.color, need: large ? 3 : 4.5, text: (el.textContent || '').trim().slice(0, 24) });
    }
    const rng = document.createRange();
    rng.selectNodeContents(el);
    let widest = 0;
    for (const lr of rng.getClientRects()) if (lr.width > 1 && lr.height > 1) widest = Math.max(widest, lr.width);
    const chars = widest / size; // 方块字≈1em 宽，直接折算成「一行多少字」
    if (chars > 42 && /[一-鿿]/.test(el.textContent || '')) {
      longLines.push({ sel: sel(el), chars: Math.round(chars), size, w: Math.round(widest) });
    }
    if (/^h[1-6]$/.test(el.tagName)) headingSizes.push(`${el.tagName}:${size}`);
  }

  const header = document.querySelector('header');
  const hr = header ? header.getBoundingClientRect() : null;
  const firstCard = document.querySelector('main article');
  const cr = firstCard ? firstCard.getBoundingClientRect() : null;
  const headerOverlap = hr && cr && hr.height > 0 && cr.top < hr.bottom - 1;
  const themeCtl = document.querySelector('[aria-label="昼夜主题"]');
  const tr = themeCtl ? themeCtl.getBoundingClientRect() : null;

  const probe = (() => {
    const widthOf = (family) => {
      const sp = document.createElement('span');
      sp.textContent = '名字笔画出处今译';
      sp.style.cssText = `position:absolute;left:-9999px;top:0;font-size:24px;white-space:nowrap;font-family:${family}`;
      document.body.appendChild(sp);
      const w = Math.round(sp.getBoundingClientRect().width);
      sp.remove();
      return w;
    };
    return {
      ua: (navigator.userAgent || '').slice(0, 64),
      serif: widthOf('"Songti SC","Noto Serif CJK SC",serif'),
      sans: widthOf('"PingFang SC","Noto Sans CJK SC",sans-serif'),
      latin: widthOf('"PingFang SC",sans-serif'),
    };
  })();

  return {
    docScroll, vw, probe,
    overflow, targetsSmall, targetsShort,
    contrastBad, longLines,
    fonts: Object.entries(fonts).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}px×${v}`).join(' '),
    headingSizes: headingSizes.join(' '),
    headerH: hr ? Math.round(hr.height) : 0,
    headerOverlap,
    themeCtlVisible: !!tr && tr.width > 0 && tr.right <= vw + 1 && tr.top >= -1,
  };
}

async function fillCompose(page) {
  await page.getByLabel('姓（可复姓）').fill('苏');
  await page.getByLabel('选择第 1 字').click();
  await page.getByLabel('第 1 字搜索').fill('子');
  await page.locator('[data-char-grid] button').first().click();
  await page.getByLabel('选择第 2 字').click();
  await page.getByLabel('第 2 字搜索').fill('归');
  await page.locator('[data-char-grid] button').first().click();
  await page.getByRole('heading', { name: '苏子归' }).waitFor();
  // 字格重新打开：让 44px 的字块也进入体检
  await page.getByLabel('选择第 1 字').click();
  await page.waitForTimeout(120);
}

// dist 没人在伺服就自己起一个（CI 里直接 `npm run build && npm run audit:design` 就能跑）
const { spawn } = await import('node:child_process');
const { get } = await import('node:http');
const ping = () => new Promise((res) => {
  const req = get(BASE, (r) => { r.resume(); res(r.statusCode === 200); });
  req.on('error', () => res(false));
  req.setTimeout(2000, () => { req.destroy(); res(false); });
});
let server = null;
if (!(await ping())) {
  server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let previewLog = '';
  server.stderr.on('data', (d) => { previewLog += String(d); });
  server.stdout.on('data', (d) => { previewLog += String(d); });
  process.on('exit', () => server?.kill());
  for (let i = 0; i < 60 && !(await ping()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!(await ping())) {
    const msg = `起不了 vite preview（先 npm run build，dist 要存在）。preview 输出：${(previewLog || '（无输出）').slice(0, 800)}`;
    console.error(msg);
    annotate('error', msg);
    process.exit(2);
  }
}

const results = [];
const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    await ctx.addInitScript(([t]) => {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      localStorage.setItem('naming.theme.v1', t);
      localStorage.setItem('naming.surname.v1', '林');
    }, [theme]);
    const page = await ctx.newPage();
    const m = async (name) => {
      // 「首屏」就是滚到顶之后的那一屏：先把滚动归零，再量页头有没有压住第一张卡片
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(160);
      const r = await page.evaluate(measure, [vp.width, vp.mobile]);
      results.push({ vp: `${vp.name}×${vp.height}`, mobile: vp.mobile, theme, page: name, ...r });
    };
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByLabel('姓（可复姓）').fill('林');
    await page.locator('main article').first().waitFor();
    await page.getByRole('button', { name: '高级筛选' }).click();
    await m('生成');
    await page.getByRole('button', { name: '收藏' }).first().click();
    await page.getByRole('button', { name: '收藏' }).first().click();
    await page.getByRole('button', { name: '拉黑' }).first().click();
    await page.getByRole('link', { name: '自选' }).click();
    await fillCompose(page);
    await m('自选');
    await page.getByRole('link', { name: /^收藏/ }).click();
    await m('收藏');
    await page.getByRole('link', { name: /^拉黑/ }).click();
    await m('拉黑');
    await ctx.close();
  }
}
await browser.close();

const hard = [];
let annotatedProbe = false;
for (const r of results) {
  const tag = `${r.vp} ${r.theme} ${r.page}`;
  const flags = [];
  if (r.docScroll > r.vw) flags.push(`横向溢出 ${r.docScroll}px`);
  if (r.overflow.length) flags.push(`出界元素 ${r.overflow.length}`);
  if (r.targetsSmall.length) flags.push(`目标<24 ${r.targetsSmall.length}`);
  if (r.contrastBad.length) flags.push(`对比度不达标 ${r.contrastBad.length}`);
  if (!r.themeCtlVisible) flags.push('主题切换不可见');
  if (r.headerOverlap) flags.push('页头压住卡片');
  const worstContrast = r.contrastBad.length ? Math.min(...r.contrastBad.map((c) => c.ratio)) : null;
  console.log(
    `${tag.padEnd(22)} scroll=${String(r.docScroll).padStart(5)} 目标小=${String(r.targetsSmall.length).padStart(2)}`
    + ` 手机偏矮=${String(r.targetsShort.length).padStart(3)} 对比度最差=${worstContrast === null ? 'ok' : worstContrast}`
    + ` 行长>42字=${String(r.longLines.length).padStart(2)} 页头高=${String(r.headerH).padStart(3)}${flags.length ? `  ⚠ ${flags.join(' / ')}` : ''}`,
  );
  if (!annotatedProbe) { annotatedProbe = true; annotate('notice', `字体探针 ${r.vp} ${r.theme} ${r.page}: ${JSON.stringify(r.probe)}`); }
  for (const o of r.overflow) hard.push([tag, '出界', `${o.sel} left=${o.left} right=${o.right} w=${o.w} 「${o.text}」`]);
  for (const t of r.targetsSmall) hard.push([tag, '目标<24px', `${t.sel} ${t.w}×${t.h} 「${t.text}」`]);
  for (const c of r.contrastBad) hard.push([tag, `对比度 ${c.ratio}<${c.need}`, `${c.sel} ${c.size}px/${c.weight} ${c.color} 「${c.text}」`]);
  if (r.headerOverlap) hard.push([tag, '页头压卡片', `header高=${r.headerH}`]);
  if (!r.themeCtlVisible) hard.push([tag, '主题切换不可见', '']);
}

if (verbose) {
  console.log('\n--- 字号分布（每视口/页）---');
  for (const r of results) console.log(`${r.vp} ${r.theme} ${r.page}: ${r.fonts}`);
  console.log('\n--- 行长>42 字 ---');
  for (const r of results) for (const l of r.longLines) console.log(`${r.vp} ${r.theme} ${r.page}: ${l.sel} ${l.chars}字 ${l.size}px`);
  console.log('\n--- 手机端偏矮目标（<44px，非违规）---');
  for (const r of results) for (const t of r.targetsShort) console.log(`${r.vp} ${r.theme} ${r.page}: ${t.sel} ${t.w}×${t.h} 「${t.text}」`);
}

if (jsonOut) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('design-audit.json', JSON.stringify(results, null, 2));
  console.log('\n已写出 design-audit.json');
}

// 自己起的 preview 是常驻进程，会吊着事件循环不放；收尾必须显式收掉再退出。
const code = hard.length ? 1 : 0;
if (hard.length) {
  console.log(`\n硬违规 ${hard.length} 条：`);
  for (const [tag, kind, detail] of hard) {
    console.log(`  [${tag}] ${kind}: ${detail}`);
    annotate('error', `[${tag}] ${kind}: ${detail}`);
  }
  annotate('notice', `共 ${hard.length} 条硬违规（前 40 条已作为 annotation 输出）`);
} else {
  console.log('\n无硬违规（溢出/目标尺寸/对比度/页头遮挡）。');
}
server?.kill();
process.exit(code);
