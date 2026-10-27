// 「语料那么多，为什么只有 463 条」的逐本漏斗实测。
// 回答三个问题：每一道闸门吃掉多少；语料翻倍买得到多少条；把这些条随包发布要多占多少 gzip 体积。
// node scripts/measure-funnel.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { NAME_NOISE } from './name-noise.mjs';
import { buildL0 } from './l0-keep.mjs';

const RAW = 'data/raw';
const NOT_CJK = /[^一-鿿]/g;
const read = (p) => fs.readFileSync(path.join(RAW, p), 'utf-8');
const json = (p) => JSON.parse(read(p));
const loadCharList = (p) =>
  read(p)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const q = l.split(/\s+/);
      return q.length === 2 && /^\d+$/.test(q[0]) ? q[1] : l;
    });

const WH1 = new Set(loadCharList('gsc_level_1.txt'));
const WH3 = new Set(loadCharList('gsc_level_3.txt'));
const WH123 = new Set([...WH1, ...new Set(loadCharList('gsc_level_2.txt')), ...WH3]);
const XUCI = new Set('兮之以太其于而则且亦何斯夫惟维矣乎焉哉也矣耶欤矣噫只且'.split(''));
const FUNC = new Set(
  '的了是在有他不这我都还说法把让向对为等与就只很更最些什么样怎么如果但是因为所以而且并且或者被它你们我们他们它们有个之以及然而则即便共'.split(
    '',
  ),
);
const XU = new Set([...XUCI, ...FUNC]);
const BAD = new Set(
  '胸鬼懒禽鸟鸡我邪罪凶丑仇鼠蟋蟀淫秽妹狐鸭蝇悔鱼肉苦犬吠窥血丧饥搔父母昏狗蟊疾病痛死潦哀痒害蛇牲妇狸鹅穴畜烂兽靡爪氓劫鬣婚姻匪婆羞辱'
    .split('')
    .filter((c) => WH123.has(c)),
);
const NOISE = new Set(NAME_NOISE);
const wf = new Map();
for (const line of read('jieba_dict.txt').split('\n')) {
  const p = line.split(' ');
  if (p.length >= 3) wf.set(p[0], Number(p[1]));
}
const attrs = json('cnname_attributes.json');
const ad = attrs.dict ?? attrs;
const CN_CHARS = [
  ...new Set(
    Object.values(ad)
      .filter((v) => typeof v === 'string')
      .join('')
      .split(''),
  ),
];
// 与 build-data 同口径：种子＝cnname 全表字 ∩ 通用规范字表(WH123)，再并入 l0-verdicts.txt 的人工保留字。
const L0 = buildL0(CN_CHARS.filter((c) => WH123.has(c)));

const BOOKS = ['shijing', 'chuci', 'lunyu', 'shuimo', 'song300', 'daofa'];
const MAX_GAP = 3;
function offsets(book, n) {
  if (book === 'shijing' || book === 'shuimo')
    return { 4: [0, 2], 5: [0, 2], 7: [0, 2, 4] }[n] ?? [...Array(n - 1).keys()];
  if (book === 'chuci') return { 4: [0, 2], 5: [0, 3], 7: [0, 2, 4] }[n] ?? [...Array(n - 1).keys()];
  return [...Array(n - 1).keys()];
}
const SPLIT = /[。！？；]/,
  COMMA = /[，、：]/;
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
const 篇数 = (book) => rawText(book).length;

// 一本（或一组篇目）→ 该口径下音步起点×间隔≤3 能产出的字对（带出处记录）
function pairsOf(book, texts, metas, maxGap = MAX_GAP, anyStart = false) {
  const out = new Map();
  let chars = 0,
    segs = 0,
    feet = 0;
  for (let ti = 0; ti < texts.length; ti++) {
    const { title, author } = metas[ti];
    for (const s of String(texts[ti]).split(SPLIT)) {
      const line = s.trim();
      if (!line) continue;
      for (const u of line.split(COMMA)) {
        const cleaned = u.replace(/[“”‘’「」《》（）()]/g, '').trim();
        if (!cleaned) continue;
        for (const seg of cleaned.replace(NOT_CJK, '').split('兮')) {
          if (seg.length < 2) continue;
          chars += seg.length;
          segs += 1;
          const cs = [...seg];
          const offs = anyStart ? [...Array(cs.length - 1).keys()] : offsets(book, cs.length);
          feet += offs.length;
          for (const i of offs)
            for (let gap = 1; gap <= maxGap; gap++) {
              const j = i + gap;
              if (j >= cs.length) break;
              if (gap > 1 && (inRedup(cs, i) || inRedup(cs, j))) continue;
              const pair = cs[i] + cs[j];
              const cur = out.get(pair);
              if (!cur || cur.gap > gap) out.set(pair, { pair, book, title, author, line, seg, foot: i, gap });
            }
        }
      }
    }
  }
  return { out, chars, segs, feet };
}

const keep = (pair, rec, W) =>
  [...pair].every((c) => W.has(c)) &&
  ![...pair].some((c) => XU.has(c) || BAD.has(c)) &&
  !NOISE.has(pair) &&
  (wf.get(pair) ?? 0) < 5000 &&
  !(pair[0] === pair[1] && rec.gap > 1);

const bookData = {};
for (const b of BOOKS) bookData[b] = pairsOf(b, rawText(b), rawMeta(b));

console.log('每本语料的产出漏斗（同一条管线，逐闸门看剩多少）\n');
console.log(
  `典籍      篇   段   起点  起点字在L0    字数     字对  过一级字+虚词忌讳词频  再要两字都在L0(${L0.size})  产率`,
);
let sumPairs = 0;
for (const b of BOOKS) {
  const { out, chars, segs, feet } = bookData[b];
  const inL0head = [...out.values()].filter((r) => L0.has(r.pair[0])).length;
  const wh1 = [...out].filter(([p, r]) => keep(p, r, WH1));
  const l0 = wh1.filter(([p]) => [...p].every((c) => L0.has(c)));
  sumPairs += out.size;
  console.log(
    `${b.padEnd(9)}${String(篇数(b)).padStart(5)} ${String(segs).padStart(5)} ${String(feet).padStart(5)} ${String(inL0head).padStart(11)} ${String(chars).padStart(9)} ${String(out.size).padStart(7)} ${String(wh1.length).padStart(16)} ${String(l0.length).padStart(15)} ${((l0.length / chars) * 1000).toFixed(1)}/千字`,
  );
}
console.log(
  `\n「字对」列＝该本音步起点×间隔≤3 能拼出的全部组合（六本按本合计 ${sumPairs.toLocaleString('en-US')} 个，跨本有重叠）；`,
);
console.log('倒数第二列＝两字都在一级字表 3,500 内且过虚词/忌讳/高频/现代成词——那一层就是 Pool-C 的按本口径；');
console.log(`再往右才是本项目真正的主池闸门：两字都要在 L0（${L0.size} 字）。`);

// 全池：与正式管线交叉校验，口径漂移就不许出数
function mergedPairs(books = BOOKS, maxGap = MAX_GAP, anyStart = false) {
  const foot = new Map();
  const cached = maxGap === MAX_GAP && !anyStart;
  for (const b of books) {
    const { out } = cached ? bookData[b] : pairsOf(b, rawText(b), rawMeta(b), maxGap, anyStart);
    for (const [pair, rec] of out) {
      const cur = foot.get(pair);
      if (!cur || cur.gap > rec.gap) foot.set(pair, rec);
    }
  }
  return foot;
}
function poolOf(W, books = BOOKS, maxGap = MAX_GAP, anyStart = false) {
  return new Map([...mergedPairs(books, maxGap, anyStart)].filter(([p, r]) => keep(p, r, W)));
}
const meta = JSON.parse(fs.readFileSync('src/data/meta.json', 'utf-8'));
const base = poolOf(L0);
if (base.size !== meta.pool_B) {
  console.error(`口径漂移：漏斗算出 ${base.size} 条，build-data 报 ${meta.pool_B} 条`);
  process.exit(1);
}
const all = mergedPairs();
const pct = (a, b) => `${((a / b) * 100).toFixed(2)}%`;
const withWh1 = poolOf(WH1);
console.log(`\n跨本去重后的总账（每一行是「还要求两字都在该表内」的同一条管线）`);
console.log(`  全部合法字对（音步起点×间隔≤3）        ${all.size.toLocaleString('en-US')}`);
console.log(`  两字都在一级字表 3,500 内 + 其余闸门    ${withWh1.size.toLocaleString('en-US')}`);
console.log(
  `  两字都在 L0 ${L0.size} 字内 + 其余闸门        ${base.size}（＝上一行的 ${pct(base.size, withWh1.size)}，白名单把 3,500 字压到 ${L0.size} 字，池子就塌到这个数）`,
);

// 语料杠杆：按「只取选本的前 1/8…1/1 篇」测边际收益曲线，再拟合幂律外推放大语料的收益
// （不能用「把同一批诗复制两遍」当 2× 语料——那按定义不产生任何新字对，是自我无效的测量）
console.log('\n加语料能买多少（同一本书砍篇目数看边际收益，拟合 n＝A·f^k 后外推）');
for (const b of ['shuimo', 'song300']) {
  const texts = rawText(b),
    metas = rawMeta(b);
  const pts = [0.125, 0.25, 0.5, 1].map((frac) => {
    const n = texts.length;
    const { out, chars } = pairsOf(b, texts.slice(0, Math.round(n * frac)), metas.slice(0, Math.round(n * frac)));
    return { frac, chars, n: [...out].filter(([p, r]) => keep(p, r, L0)).length };
  });
  const xs = pts.map((p) => Math.log(p.chars)),
    ys = pts.map((p) => Math.log(p.n));
  const mx = xs.reduce((a, c) => a + c, 0) / xs.length,
    my = ys.reduce((a, c) => a + c, 0) / ys.length;
  const k = xs.reduce((a, c, i) => a + (c - mx) * (ys[i] - my), 0) / xs.reduce((a, c) => a + (c - mx) ** 2, 0);
  const A = Math.exp(my - k * mx);
  const at = (mul) => Math.round(A * Math.pow(pts[3].chars * mul, k));
  console.log(
    `  ${b.padEnd(8)} ${pts.map((p) => `${(p.chars / 1000).toFixed(0)}k字→${p.n}条`).join('  ')}｜k＝${k.toFixed(2)}（k＝1 才是线性）`,
  );
  console.log(
    `  ${''.padEnd(8)} 外推：${((pts[3].chars * 4) / 1000).toFixed(0)}k字→约 ${at(4)} 条、${((pts[3].chars * 16) / 1000).toFixed(0)}k字→约 ${at(16)} 条`,
  );
}
console.log(
  '  ⚠️ 外推假设新增语料的词表分布与这本选本一致（全唐诗/全宋词未必成立），且 k 是用几千字的小样本拟合的——只读形状，不当承诺。',
);

// 随包体积：把各方案的候选表按 candidates.json 的字段形状序列化后 gzip，再按「实际随包 / 同形状估算」标定
const shape = (m) =>
  JSON.stringify(
    [...m.values()].map((r, i) => ({
      id: `${r.book.toUpperCase().slice(0, 2)}_${i}`,
      name: r.pair,
      chars: [...r.pair],
      tier: 'B',
      book: r.book,
      title: r.title,
      author: r.author,
      line: r.line,
      seg: r.seg,
      foot: r.foot,
      gap: r.gap,
      strict: true,
      redup: r.pair[0] === r.pair[1],
      famous: false,
      risk: null,
      score: 10,
    })),
  );
const gz = (s) => zlib.gzipSync(Buffer.from(s, 'utf-8'), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(0)} KB gz`;

// 单名层：每个白名单字要有至少一条音步对齐的双名出处才收录（与 build-data 同口径）
function singlesOf(pool) {
  const seen = new Set();
  for (const r of pool.values()) {
    seen.add(r.pair[0]);
    seen.add(r.pair[1]);
  }
  return seen.size;
}

// 扩白名单：代理挑字＝一级字表内、在音步起点出现最多的字（只用来量体积与规模，不代表可用）
const footFreq = new Map();
for (const b of BOOKS)
  for (const r of bookData[b].out.values()) footFreq.set(r.pair[0], (footFreq.get(r.pair[0]) ?? 0) + 1);
const proxy = [...WH1]
  .filter((c) => !L0.has(c) && !XU.has(c) && !BAD.has(c))
  .sort((a, b) => (footFreq.get(b) ?? 0) - (footFreq.get(a) ?? 0) || (wf.get(b) ?? 0) - (wf.get(a) ?? 0));

// 校准系数：脚本里的简化记录比真实 candidates.json 少了 risk/拼音等派生字段，用现状那一行把系数定出来
const cur = gz(shape(base));
const CAL = meta.ship_gz['candidates.json'] / cur;
console.log(
  `\n三条杠杆的规模与随包体积（现状 candidates.json ${meta.ship_gz['candidates.json']} B gz / ${meta.pool_B} 条 + singles.json ${meta.ship_gz['singles.json']} B；整包预算 400 KB gz，现为 ${Math.round(meta.ship_gz_total / 1024)} KB）`,
);
console.log(
  `  简化形状估算 ${(cur / 1024).toFixed(0)} KB → 对真实文件标定系数 ×${CAL.toFixed(2)}；单名按 ${Math.round(meta.ship_gz['singles.json'] / meta.singles)} B/条 计`,
);
const perSingle = Math.round(meta.ship_gz['singles.json'] / meta.singles);
const row = (label, pool) => {
  const n1 = pool.size,
    n2 = singlesOf(pool);
  const bytes = Math.round(gz(shape(pool)) * CAL) + n2 * perSingle;
  console.log(`  ${label.padEnd(28)} 双名 ${String(n1).padStart(6)}  单名 ${String(n2).padStart(5)}  ${kb(bytes)}`);
};
row(`定稿 L0 ${L0.size} 字（现状）`, base);
for (const add of [13, 50, 150, 609]) {
  const W = new Set([...L0, ...proxy.slice(0, add)]);
  row(`L0 + 代理 ${add} 字（${W.size} 字）`, poolOf(W));
}
row('放弃白名单、只要一级字表', poolOf(WH1));
console.log('\n另一条杠杆：不动语料、不扩字表，只放宽取词口径（同一条管线）');
row('句读内任意间隔（去掉 ≤3）', poolOf(L0, BOOKS, 99));
row('句读内任意间隔 + 起点不限音步', poolOf(L0, BOOKS, 99, true));
console.log('  两条杠杆相乘（放宽间隔 × 扩白名单）：');
row('任意间隔 ×（L0+13 字）', poolOf(new Set([...L0, ...proxy.slice(0, 13)]), BOOKS, 99));
row('任意间隔 ×（L0+50 字）', poolOf(new Set([...L0, ...proxy.slice(0, 50)]), BOOKS, 99));

console.log(
  '\n这块「代理挑字」是按音步起点频次挑的，只用来量形状；交付用的待审表按真实边际排序（scripts/l0-unlock.mjs），',
);
console.log(
  `同一档 50 个字两条路线给 ${[...poolOf(new Set([...L0, ...proxy.slice(0, 50)]))].length} 条（本脚本）vs 更高数量（待审表那 50 字，已用 build-data 真实重建实测）。`,
);
console.log(`体积一律以真实重建为准：现池 ${meta.pool_B} 条＝整包 ${meta.ship_gz_total} B gz（预算 409,600 B）。`);
