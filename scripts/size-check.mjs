// 体积门禁：首屏 JS+CSS+data 的 gzip 总和必须 ≤ 400 KB（设计文档 6.1 的目标）
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
const single = html.length ? Math.max(...html.map(gzOf)) : 0;

for (const f of assets.sort((a, b) => gzOf(b) - gzOf(a))) {
  console.log(`${String(gzOf(f)).padStart(7)} gz  ${String(brotliCompressSync(fs.readFileSync(f)).length).padStart(7)} br  ${path.relative(dir, f)}`);
}
const BUDGET = 400 * 1024;
console.log(`\n资源合计 ${total} B gz（预算 ${BUDGET} B）→ ${total <= BUDGET ? 'PASS' : 'FAIL'}`);
if (single) console.log(`站点 HTML 壳 ${single} B gz（不是单文件产物；单文件版由 npm run build:single 产出，目标 ≤1.5MB）→ ${single <= 1.5 * 1024 * 1024 ? 'PASS' : 'FAIL'}`);
process.exit(total <= BUDGET ? 0 : 1);
