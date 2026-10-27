// 体积门禁（设计文档 6.1）：两条判定都按 gzip 算，都进退出码。
//   非 HTML 资源合计 ≤ 400 KB；HTML 自身按产物形态取预算——站点版量的是页面壳（≤ 400 KB gz），
//   单文件版（npm run single，产物在 dist-single/）量的是整个单文件产物（≤ 450 KB gz，口径见 DESIGN.md 6.1），
//   原文件大小一并报出。gzip 结果与压缩实现有关：CI 的官方 Node 用 zlib-ng，同一文件比系统 zlib 大约 1.4%，
//   所以本脚本把实现版本打出来，门禁数值以 CI 口径（较大的一侧）为准。
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const dir = process.argv[2] ?? 'dist';
const single = process.argv.includes('--single'); // 由调用方明说这是单文件产物，不靠大小猜产物形态
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(dir);

const html = files.filter((f) => f.endsWith('.html'));
const assets = files.filter((f) => !f.endsWith('.html') && !f.endsWith('.svg') && !f.endsWith('.txt'));
const gzOf = (f) => gzipSync(fs.readFileSync(f), { level: 9 }).length;
const total = assets.reduce((a, f) => a + gzOf(f), 0);

for (const f of assets.sort((a, b) => gzOf(b) - gzOf(a))) {
  console.log(
    `${String(gzOf(f)).padStart(7)} gz  ${String(brotliCompressSync(fs.readFileSync(f)).length).padStart(7)} br  ${path.relative(dir, f)}`,
  );
}
const ASSET_BUDGET = 400 * 1024; // 站点首屏：JS + CSS + 数据 + 图标，gzip
const SHELL_BUDGET = 400 * 1024; // 站点 HTML 壳（不含应用本体），gzip
const SINGLE_BUDGET = 450 * 1024; // 单文件产物：本体都在 HTML 里，按同一份内容的 gzip 放宽 50 KB
const rawOf = (f) => fs.statSync(f).size;
const htmlGz = html.reduce((a, f) => Math.max(a, gzOf(f)), 0);
const htmlRaw = html.reduce((a, f) => Math.max(a, rawOf(f)), 0);
const htmlBudget = single ? SINGLE_BUDGET : SHELL_BUDGET;
const failed = total > ASSET_BUDGET || htmlGz > htmlBudget;
console.log(`\n压缩实现 zlib ${process.versions.zlib}`);
console.log(`资源合计 ${total} B gz（预算 ${ASSET_BUDGET} B）→ ${total <= ASSET_BUDGET ? 'PASS' : 'FAIL'}`);
if (html.length) {
  const what = single ? '单文件产物 index.html' : '站点 HTML 壳（应用本体在上面的资源合计里）';
  console.log(
    `${what} ${htmlRaw} B 原文件 / ${htmlGz} B gz（预算 ${htmlBudget} B gz，余量 ${htmlBudget - htmlGz} B）→ ${htmlGz <= htmlBudget ? 'PASS' : 'FAIL'}`,
  );
}
process.exit(failed ? 1 : 0);
