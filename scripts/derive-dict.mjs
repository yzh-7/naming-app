// 一次性派生脚本（不属于常规 build）：把三份上游开放数据裁剪成 data/raw 下的只读输入。
// 上游（均为公开许可，见 data/raw/LICENSES.md）：
//   1) mapull/chinese-dictionary  char_base.json / char_detail.json （MIT）—— 笔画、结构、字义
//   2) wainshine/Chinese-Names-Corpus  Chinese_Names_Corpus（120W）.txt （Apache-2.0）—— 名用字频次
// 用法：先把三份上游文件放到 UP 目录（默认 /tmp/opencode），再 `node scripts/derive-dict.mjs`。
// 产物进入 data/raw，登记进 SHA256SUMS；构建期只读这些裁剪结果，不再联网。
import fs from 'node:fs';
import path from 'node:path';

const UP = process.env.UP_DIR ?? '/tmp/opencode';
const OUT = 'data/raw';
const readUp = (f) => fs.readFileSync(path.join(UP, f), 'utf8');

// 一份 JSONL（每行一个对象，行尾可能带逗号）
const parseJsonl = (f) => readUp(f).trim().split('\n')
  .map((l) => l.replace(/,\s*$/, '')).filter(Boolean).map(JSON.parse);

// 结构代码首字母 → 中文结构名（《汉字结构表》，见上游 README）
const STRUCT = {
  D: '独体', A: '品字', B: '上下', E: '上中下',
  H: '左右', M: '左中右', Q: '全包围', R: '半包围',
};
const structLabel = (code) => STRUCT[String(code || '')[0]] ?? null;

// 字义：优先取「本义:…」，否则取第一条解释去掉（…）训诂后的头一句；截断到 32 字
function glossOf(detail) {
  const exps = detail?.pronunciations?.flatMap((p) => p.explanations ?? []) ?? [];
  for (const e of exps) {
    const c = String(e.content ?? '');
    const m = c.match(/本义[:：]\s*([^。；)）]+)/);
    if (m) return cleanGloss(m[1]);
  }
  const first = String(exps[0]?.content ?? '');
  if (!first) return null;
  return cleanGloss(first.replace(/^[(（][^)）]*[)）]\s*/, '').split(/[。；]/)[0]);
}
function cleanGloss(s) {
  let t = s.replace(/[;]/g, '；').replace(/[,]/g, '，').replace(/\s+/g, '');
  t = t.split(/[)）]/)[0].replace(/[，、；]+$/, '');
  if (t.length > 28) t = t.slice(0, 28).replace(/[，；、][^，；、]*$/, '');
  return t || null;
}

const base = parseJsonl('char_base.json');
const shape = {};
for (const o of base) {
  if (typeof o.char !== 'string' || o.char.length !== 1) continue;
  const st = Number.isInteger(o.strokes) ? o.strokes : null;
  const sx = structLabel(o.structure);
  if (st === null && !sx) continue;
  shape[o.char] = [st, sx];
}

const detail = parseJsonl('char_detail.json');
const gloss = {};
for (const o of detail) {
  const g = glossOf(o);
  if (g) gloss[o.char] = g;
}

// 名用字频次：取姓名去掉首字（姓）后的用字计数，作为「该字在真实名字里有多常用」的证据
const freq = {};
let total = 0;
for (const raw of readUp('names120w.txt').split('\n')) {
  const name = raw.trim();
  if (name.length < 2 || name.length > 4) continue;
  if (/[^\u4e00-\u9fff]/.test(name)) continue;
  for (const ch of [...name].slice(1)) { freq[ch] = (freq[ch] ?? 0) + 1; total += 1; }
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
fs.writeFileSync(path.join(OUT, 'dict_shape.json'), JSON.stringify(sortObj(shape)) + '\n');
fs.writeFileSync(path.join(OUT, 'dict_gloss.json'), JSON.stringify(sortObj(gloss)) + '\n');
fs.writeFileSync(path.join(OUT, 'name_given_freq.json'), JSON.stringify(sortObj(freq)) + '\n');
console.log(JSON.stringify({
  shape: Object.keys(shape).length,
  gloss: Object.keys(gloss).length,
  freq_chars: Object.keys(freq).length,
  given_total: total,
}, null, 1));
