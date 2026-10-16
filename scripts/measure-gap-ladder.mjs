// 取字口径阶梯实测（设计文档 5.1a 引用这组数字）。
// 分句/音步/减法逻辑与 build-data.mjs 同源，只逐个放宽「起点」和「间隔」两个约束，看主池规模怎么变。
// node scripts/measure-gap-ladder.mjs
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
const BAD = new Set('胸鬼懒禽鸟鸡我邪罪凶丑仇鼠蟋蟀淫秽妹狐鸭蝇悔鱼肉苦犬吠窥血丧饥搔父母昏狗蟊疾病痛死潦哀痒害蛇牲妇狸鹅穴畜烂兽靡爪氓劫鬣婚姻匪婆羞辱'.split('').filter((c) => new Set([...WH1, ...WH3]).has(c)));
const wf = new Map();
for (const line of read('jieba_dict.txt').split('\n')) { const p = line.split(' '); if (p.length >= 3) wf.set(p[0], Number(p[1])); }
const attrs = json('cnname_attributes.json'); const ad = attrs.dict ?? attrs;
const CN_CHARS = [...new Set(Object.values(ad).filter((v) => typeof v === 'string').join('').split(''))];
const L0 = buildL0(CN_CHARS.filter((c) => WH123.has(c)));

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
function rawMeta(book) {
  const j = json(`${book}.json`);
  if (book === 'lunyu') return j.flatMap((ch) => ch.paragraphs.map(() => ch.chapter));
  if (book === 'song300') return j.map((po) => po.rhythmic ?? '');
  return j.map((po) => po.title ?? '');
}

// units：句读级（音步起点的所在单元）。line：句级。poem：篇级（同一首诗/同一章）。
const units = [];
for (const book of BOOKS) {
  const texts = rawText(book), metas = rawMeta(book);
  for (let ti = 0; ti < texts.length; ti++) {
    const poem = `${book}#${metas[ti]}#${ti}`;
    for (const line of String(texts[ti]).split(SPLIT)) {
      const t = line.trim(); if (!t) continue;
      const lineKey = `${poem}@${t}`;
      for (const u of t.split(COMMA)) {
        const cleaned = u.replace(/[“”‘’「」《》（）()]/g, '').trim();
        if (!cleaned) continue;
        for (const seg of cleaned.replace(NOT_CJK, '').split('兮')) {
          if (seg.length < 2) continue;
          units.push({ book, poem, lineKey, line: t, seg, cs: [...seg] });
        }
      }
    }
  }
}

const legal = (p) => [...p].every((ch) => L0.has(ch)) && ![...p].some((ch) => XU.has(ch) || BAD.has(ch)) && (wf.get(p) ?? 0) < 5000;
const addPair = (seen, cs, i, j) => {
  if (i === j || j < 0 || j >= cs.length) return;
  const [a, b] = j > i ? [i, j] : [j, i];
  // 相邻的相同两字（青青子佩 的 青青）本身就是典籍叠字装置，只有跨字取的才要判粘连
  if (b - a > 1 && (inRedup(cs, a) || inRedup(cs, b))) return;
  const p = cs[a] + cs[b];
  if (p[0] === p[1] && b - a > 1) return;   // 假叠字（以德报德→德德）
  if (legal(p)) seen.add(p);
};

// 句读内：起点可限音步，间隔可设上限
function withinSeg({ startAny = false, maxGap = Infinity } = {}) {
  const seen = new Set();
  for (const u of units) {
    const offs = startAny ? [...u.cs.keys()] : offsets(u.book, u.cs.length);
    for (const i of offs) for (let gap = 1; gap <= maxGap; gap++) {
      const j = i + gap;
      if (j >= u.cs.length) break;
      addPair(seen, u.cs, i, j);
    }
  }
  return seen.size;
}
// 跨单元（同句 / 同篇）：两字来自同 group 的两个句读，先拼成串再判粘连
function acrossUnits(groupKey) {
  const seen = new Set();
  const byGroup = new Map();
  for (const u of units) {
    const k = u[groupKey];
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(u.cs);
  }
  for (const list of byGroup.values()) {
    const flat = list.flatMap((cs, oi) => cs.map((ch, ci) => ({ ch, unit: oi, idx: ci })));
    for (let a = 0; a < flat.length; a++) for (let b = a + 1; b < flat.length; b++) {
      const x = flat[a], y = flat[b];
      if (x.unit === y.unit) { addPair(seen, list[x.unit], x.idx, y.idx); continue; }
      // 跨句读：两侧任一字在原文里紧邻同一个字，它就是叠词的一半
      if (inRedup(list[x.unit], x.idx) || inRedup(list[y.unit], y.idx)) continue;
      const p = x.ch + y.ch;
      if (p[0] === p[1]) continue;
      if (legal(p)) seen.add(p);
    }
  }
  return seen.size;
}

const run = (label, n) => console.log(`${String(n).padStart(6)}  ${label}`);
console.log(`L0 种子 ${L0.size} 字｜句读单元 ${units.length}\n`);
run('句读内·相邻（初稿口径，= Pool-B gap1）', withinSeg({ maxGap: 1 }));
run('句读内·间隔 ≤2', withinSeg({ maxGap: 2 }));
run('句读内·间隔 ≤3（定稿口径）', withinSeg({ maxGap: 3 }));
run('句读内·任意间隔', withinSeg({}));
run('句读内·起点不限音步 + 任意两字', withinSeg({ startAny: true }));
run('同句内·任意两字（起点不限）', acrossUnits('lineKey'));
run('同篇内·任意两字（起点不限）', acrossUnits('poem'));
console.log(`\n自由组合（不设任何闸门）：L0 内两字全排列 ${(L0.size * (L0.size - 1)).toLocaleString('en-US')}`);

// 两道减法的净剔除量（文档 5.1a 引用）：只看「该对在任一出现位置都无法以合法形态登记」的情况
const kept = new Set(), glueSrc = new Map(), fakeSrc = new Map();
const occ = [];
for (const u of units) {
  for (const i of offsets(u.book, u.cs.length)) {
    for (let gap = 1; gap <= 3; gap++) {
      const j = i + gap; if (j >= u.cs.length) break;
      const p = u.cs[i] + u.cs[j]; if (!legal(p)) continue;
      const isGlue = gap > 1 && (inRedup(u.cs, i) || inRedup(u.cs, j));
      const isFake = p[0] === p[1] && gap > 1;
      occ.push({ p, isGlue, isFake, src: `${u.seg}（第 ${i + 1}/${j + 1} 字）` });
    }
  }
}
// 先定「有任一次干净出现」的对，再分类剩下的：否则 可可 这种「粘连出现在前、合法出现在后」的会被误记为剔除
for (const o of occ) if (!o.isGlue && !o.isFake) kept.add(o.p);
for (const o of occ) {
  if (kept.has(o.p)) continue;
  if (o.isGlue && !fakeSrc.has(o.p)) glueSrc.set(o.p, o.src);
  if (o.isFake && !glueSrc.has(o.p)) fakeSrc.set(o.p, o.src);
}
console.log(`\n间隔≤3、未做两道减法：${kept.size + glueSrc.size + fakeSrc.size} 条`);
console.log(`叠词粘连净剔除 ${glueSrc.size} 条：`, [...glueSrc].map(([p, src]) => `${p}←${src}`).join(' | '));
console.log(`假叠字净剔除 ${fakeSrc.size} 条：`, [...fakeSrc].map(([p, src]) => `${p}←${src}`).join(' | '));
// 门禁：与正式管线交叉校验，两处都对不上就不许出数（这条脚本曾漏收第六本、整条阶梯少 33 条而无人察觉）
const meta = JSON.parse(fs.readFileSync('src/data/meta.json', 'utf-8'));
const ladder = withinSeg({ maxGap: 3 });
if (ladder !== meta.pool_B || kept.size !== meta.pool_B) {
  console.error(`口径漂移：阶梯定稿行 ${ladder} 条 / 两遍扫描 ${kept.size} 条，build-data 报 ${meta.pool_B} 条——两边规则不一致`);
  process.exit(1);
}
console.log(`主池（与 build-data 同口径 ${meta.pool_B} 条 ✓）：${kept.size}`);
