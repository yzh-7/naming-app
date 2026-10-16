// 「白名单规模 → 可选名字数」曲线，定稿口径（音步起点 + 同句读内间隔≤3 + 两道减法）。
// 设计文档承诺过这条曲线必须用宽口径重跑；旧的 measure_scale.py 是相邻口径，数已作废。
// node scripts/measure-l0-curve.mjs
import fs from 'node:fs';
import path from 'node:path';
import { buildL0 } from './l0-keep.mjs';

const RAW = 'data/raw';
const NOT_CJK = /[^一-鿿]/g;
const read = (p) => fs.readFileSync(path.join(RAW, p), 'utf-8');
const json = (p) => JSON.parse(read(p));
const loadCharList = (p) => read(p).split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => { const q = l.split(/\s+/); return q.length === 2 && /^\d+$/.test(q[0]) ? q[1] : l; });

const WH1 = new Set(loadCharList('gsc_level_1.txt'));
const WH2 = new Set(loadCharList('gsc_level_2.txt'));
const WH3 = new Set(loadCharList('gsc_level_3.txt'));
const WH123 = new Set([...WH1, ...WH2, ...WH3]);
const XUCI = new Set('兮之以太其于而则且亦何斯夫惟维矣乎焉哉也矣耶欤矣噫只且'.split(''));
const FUNC = new Set('的了是在有他不这我都还说法把让向对为等与就只很更最些什么样怎么如果但是因为所以而且并且或者被它你们我们他们它们有个之以及然而则即便共'.split(''));
const XU = new Set([...XUCI, ...FUNC]);
const BAD = new Set('胸鬼懒禽鸟鸡我邪罪凶丑仇鼠蟋蟀淫秽妹狐鸭蝇悔鱼肉苦犬吠窥血丧饥搔父母昏狗蟊疾病痛死潦哀痒害蛇牲妇狸鹅穴畜烂兽靡爪氓劫鬣婚姻匪婆羞辱'.split('').filter((c) => WH123.has(c)));
const wf = new Map();
for (const line of read('jieba_dict.txt').split('\n')) { const p = line.split(' '); if (p.length >= 3) wf.set(p[0], Number(p[1])); }
const attrs = json('cnname_attributes.json'); const ad = attrs.dict ?? attrs;
// 与 build-data 同口径：cnname 全表字 ∩ 通用规范字表(WH123)，再并入 l0-verdicts.txt 的人工保留字。
const SEED = buildL0([...new Set(Object.values(ad).filter((v) => typeof v === 'string').join('').split(''))].filter((c) => WH123.has(c)));

const BOOKS = ['shijing', 'chuci', 'lunyu', 'shuimo', 'song300', 'daofa'];
function offsets(book, n) {
  if (book === 'shijing' || book === 'shuimo') return ({ 4: [0, 2], 5: [0, 2], 7: [0, 2, 4] })[n] ?? [...Array(n - 1).keys()];
  if (book === 'chuci') return ({ 4: [0, 2], 5: [0, 3], 7: [0, 2, 4] })[n] ?? [...Array(n - 1).keys()];
  return [...Array(n - 1).keys()];
}
const SPLIT = /[。！？；]/, COMMA = /[，、：]/;
const inRedup = (cs, i) => (i > 0 && cs[i - 1] === cs[i]) || (i < cs.length - 1 && cs[i + 1] === cs[i]);
function rawText(book) {
  const j = json(`${book}.json`);
  if (book === 'lunyu') return j.flatMap((ch) => ch.paragraphs);
  if (book === 'shuimo') return j.map((po) => po.paragraphs.join('，'));
  if (book === 'song300') return j.map((po) => (po.paragraphs ?? []).join('，'));
  if (book === 'daofa') return j.map((po) => (po.content ?? []).join('。'));
  return j.map((po) => (po.content ?? []).join('，'));
}
const units = [];
for (const book of BOOKS) {
  const texts = rawText(book);
  for (let ti = 0; ti < texts.length; ti++) {
    for (const line of String(texts[ti]).split(SPLIT)) {
      const t = line.trim(); if (!t) continue;
      for (const u of t.split(COMMA)) {
        const cleaned = u.replace(/[“”‘’「」《》（）()]/g, '').trim();
        if (!cleaned) continue;
        for (const seg of cleaned.replace(NOT_CJK, '').split('兮')) {
          if (seg.length < 2) continue;
          units.push({ book, seg, cs: [...seg] });
        }
      }
    }
  }
}

// 定稿口径下的合法双名集合（含两道减法，按「该对有没有任一次干净出现」判定）
function pool(L0) {
  const clean = new Set(), dirty = new Set();
  const ok = (p) => [...p].every((c) => L0.has(c)) && ![...p].some((c) => XU.has(c) || BAD.has(c)) && (wf.get(p) ?? 0) < 5000;
  for (const u of units) {
    for (const i of offsets(u.book, u.cs.length)) {
      for (let gap = 1; gap <= 3; gap++) {
        const j = i + gap; if (j >= u.cs.length) break;
        const p = u.cs[i] + u.cs[j]; if (!ok(p)) continue;
        const glue = gap > 1 && (inRedup(u.cs, i) || inRedup(u.cs, j));
        const fake = p[0] === p[1] && gap > 1;
        (glue || fake ? dirty : clean).add(p);
      }
    }
  }
  for (const p of clean) dirty.delete(p);
  return { pair: clean.size, removed: dirty.size };
}

// 单名：L0 字中「在任一音步起点上出现过」的字（build-data 还要求能配到出处，这里用同一近似）
function singles(L0) {
  const s = new Set();
  for (const u of units) for (const i of offsets(u.book, u.cs.length)) if (L0.has(u.cs[i]) && !XU.has(u.cs[i]) && !BAD.has(u.cs[i])) s.add(u.cs[i]);
  return s.size;
}

// 混合层：一个 L0 字 + 一个一级字（Pool-B 之外的下一档，实测其规模）
function mix(L0) {
  const seen = new Set();
  const ok = (a, b) => L0.has(a) && WH1.has(b) && !L0.has(b) && ![a, b].some((c) => XU.has(c) || BAD.has(c)) && (wf.get(a + b) ?? 0) < 5000 && (wf.get(b + a) ?? 0) < 5000;
  for (const u of units) {
    for (const i of offsets(u.book, u.cs.length)) {
      for (let gap = 1; gap <= 3; gap++) {
        const j = i + gap; if (j >= u.cs.length) break;
        const a = u.cs[i], b = u.cs[j];
        if (gap > 1 && (inRedup(u.cs, i) || inRedup(u.cs, j))) continue;
        if (a === b) continue;
        if (ok(a, b)) seen.add(a + b);
        if (ok(b, a)) seen.add(b + a);
      }
    }
  }
  return seen.size;
}

// 扩充集 A：按典籍内高频（音步起点出现次数）挑字；扩充集 B：按现代词频代理（jieba 单字频率）挑字
const cfFoot = new Map(), cfAny = new Map();
for (const u of units) {
  for (let k = 0; k < u.cs.length; k++) {
    const c = u.cs[k]; if (!WH1.has(c) || XU.has(c) || BAD.has(c) || SEED.has(c)) continue;
    cfAny.set(c, (cfAny.get(c) ?? 0) + 1);
    if (offsets(u.book, u.cs.length).includes(k)) cfFoot.set(c, (cfFoot.get(c) ?? 0) + 1);
  }
}
const sf = new Map();
for (const c of WH1) { if (XU.has(c) || BAD.has(c) || SEED.has(c)) continue; sf.set(c, wf.get(c) ?? 0); }
const byFoot = [...cfFoot.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
const byMod = [...sf.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);

const sizes = [SEED.size, 400, 500, 650, 800, 1000, 1200];
// 与正式管线交叉校验：种子池对不上就不许出表（这条曲线曾漏收第六本、基线少 33 条而无人察觉）
const meta = JSON.parse(fs.readFileSync('src/data/meta.json', 'utf-8'));
const base = pool(SEED);
if (base.pair !== meta.pool_B) {
  console.error(`口径漂移：本脚本种子池 ${base.pair} 条，build-data 报 ${meta.pool_B} 条——两边规则不一致，曲线不可用`);
  process.exit(1);
}
const pad = (s, n) => String(s).padStart(n);
console.log(`句读单元 ${units.length}｜种子 L0 ${SEED.size} 字｜一级字表 ${WH1.size}｜其中可用于扩充（非虚词非忌讳）${byMod.length}\n`);
console.log(`${pad('L0', 6)} ${pad('Pool-B双名', 12)} ${pad('单名', 8)} ${pad('合计', 8)} ${pad('混合层', 10)}  扩充来源=典籍音步高频 ∪ 现代高频(交替)`);
for (const n of sizes) {
  const extra = n - SEED.size;
  if (extra < 0) continue;
  const B = new Set([...SEED, ...byMod.slice(0, Math.ceil(extra / 2)), ...byFoot.slice(0, Math.floor(extra / 2))]);
  const p = pool(B), s = singles(B), m = mix(B);
  console.log(`${pad(B.size, 6)} ${pad(p.pair, 12)} ${pad(s, 8)} ${pad(p.pair + s, 8)} ${pad(m, 10)}  (另剔 ${p.removed} 条粘连/假叠字)`);
}
