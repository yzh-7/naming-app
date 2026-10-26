// 体积门禁（设计文档 6.1）：两条判定都按 gzip 算，都进退出码。
//   非 HTML 资源合计 ≤ 400 KB；HTML 自身 ≤ 400 KB gz——站点版这里量的是页面壳，
//   单文件版（npm run build:single，产物在 dist-single/）量的是整个单文件产物，原文件大小一并报出。
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const dir = process.argv[2] ?? 'dist';
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
  console.log(`${String(gzOf(f)).padStart(7)} gz  ${String(brotliCompressSync(fs.readFileSync(f)).length).padStart(7)} br  ${path.relative(dir, f)}`);
}
const BUDGET = 400 * 1024;
const rawOf = (f) => fs.statSync(f).size;
const htmlGz = html.reduce((a, f) => Math.max(a, gzOf(f)), 0);
const htmlRaw = html.reduce((a, f) => Math.max(a, rawOf(f)), 0);
console.log(`\n资源合计 ${total} B gz（预算 ${BUDGET} B）→ ${total <= BUDGET ? 'PASS' : 'FAIL'}`);
if (html.length) {
  const oneFile = htmlGz > total; // 单文件版：应用本体都在 HTML 里，HTML 的 gzip 比其余资源之和还大
  const what = oneFile ? '单文件产物 index.html' : '站点 HTML 壳（应用本体在上面的资源合计里）';
  console.log(`${what} ${htmlRaw} B 原文件 / ${htmlGz} B gz（同一预算 ${BUDGET} B gz）→ ${htmlGz <= BUDGET ? 'PASS' : 'FAIL'}`);
}
process.exit(total <= BUDGET && htmlGz <= BUDGET ? 0 : 1);
