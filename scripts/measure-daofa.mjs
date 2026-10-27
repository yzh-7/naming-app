// 道法（道家典籍）产率实测：在与 build-data.mjs 同一套口径下，看新增语料能贡献多少条可用双名。
// 语料来自 /tmp/daofa/*.md（劝学网录入本，许可见报告），本脚本只测产率，不写 src/data。
//
// 校准记录（2026-10-15，勿重复踩）：
// 曾想按「现代虚词密度」逐段剔除白话，实测证明这条路口不通——
//   对照组（现有五本已知纯文言）在同一过滤器下只保留 76.4% 的段，
//   即要把文言留到 94% 就几乎剔不掉白话（阈值 0.14 → 误杀 23.6% 文言）。
// 8 字稀疏标记集更差，只剔 0.1%。结论：白话/文言只能在**整本**层面判断，不能靠段级启发式。
// 整本判据（同一标记集在每书上的占比）：道德经 4.2% / 周易 2.8% / 清静经 1.5%（与已发布五书的 ≈6% 同量级＝干净）
//                                 庄子 31.8% / 列子 36.2% / 阴符经 25.6%（污染，整本不可用）。
// 庄子.md 实为《现代庄子》白话改写本，直接举例：思泉 ←「他那心思如喷泉」、天城 ←「那家伙被押送到深山老林去服刑」。
// 所以本脚本只测三本干净书，且把**全部**新增配对连出处打出来，交人工判。
// node scripts/measure-daofa.mjs
import fs from 'node:fs';
import path from 'node:path';
import { buildL0 } from './l0-keep.mjs';

const RAW = 'data/raw';
const SRC = '/tmp/daofa';
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
const WH2 = new Set(loadCharList('gsc_level_2.txt'));
const WH3 = new Set(loadCharList('gsc_level_3.txt'));
const WH123 = new Set([...WH1, ...WH2, ...WH3]);
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
    .filter((c) => WH1.has(c)),
);
const wf = new Map();
for (const line of read('jieba_dict.txt').split('\n')) {
  const p = line.split(' ');
  if (p.length >= 3) wf.set(p[0], Number(p[1]));
}
const ad = json('cnname_attributes.json');
const attrDict = ad.dict ?? ad;
const L0 = buildL0(
  [
    ...new Set(
      Object.values(attrDict)
        .filter((v) => typeof v === 'string')
        .join('')
        .split(''),
    ),
  ].filter((c) => WH123.has(c)),
);

const SPLIT = /[。！？；]/,
  COMMA = /[，、：]/;
const inRedup = (cs, i) => (i > 0 && cs[i - 1] === cs[i]) || (i < cs.length - 1 && cs[i + 1] === cs[i]);
const legal = (p) =>
  [...p].every((ch) => L0.has(ch)) && ![...p].some((ch) => XU.has(ch) || BAD.has(ch)) && (wf.get(p) ?? 0) < 5000;

// 与 build-data 一致的两种音步口径
const METER = (n) => ({ 4: [0, 2], 5: [0, 2], 7: [0, 2, 4] })[n] ?? [...Array(Math.max(n - 1, 1)).keys()];
const ANY = (n) => [...Array(n).keys()];

// 现有五书的 Pool-B（用于算「新增」）
const shipped = new Set(JSON.parse(fs.readFileSync('src/data/candidates.json', 'utf8')).map((c) => c.name));

function unitsFrom(text, mode) {
  const out = [];
  for (const line of String(text).split(SPLIT)) {
    const t = line.trim();
    if (!t) continue;
    for (const u of t.split(COMMA)) {
      const cleaned = u
        .replace(/[“”‘’「」『』《》（）()【■】\s]/g, '')
        .replace(NOT_CJK, '')
        .trim();
      if (!cleaned) continue;
      for (const seg of cleaned.split('兮')) {
        if (seg.length < 2) continue;
        out.push({ seg, line: t, cs: [...seg], offs: (mode === 'meter' ? METER : ANY)([...seg].length) });
      }
    }
  }
  return out;
}

function pairs(units) {
  const clean = new Set(),
    dirty = new Set(),
    src = new Map();
  for (const u of units) {
    for (const i of u.offs) {
      for (let gap = 1; gap <= 3; gap++) {
        const j = i + gap;
        if (j >= u.cs.length) break;
        const p = u.cs[i] + u.cs[j];
        if (!legal(p)) continue;
        const glue = gap > 1 && (inRedup(u.cs, i) || inRedup(u.cs, j));
        const fake = p[0] === p[1] && gap > 1;
        (glue || fake ? dirty : clean).add(p);
        if (!src.has(p)) src.set(p, u);
      }
    }
  }
  for (const p of clean) dirty.delete(p);
  return { clean, dirty, src };
}

// 只收整本判据干净的三本；庄子 / 列子 / 黄帝阴符经 已在头部注释里判为不可用
const CLEAN = {
  道德经: '老子_道德经_原文.md',
  周易: '周易.md',
  清静经: '清静经.md',
};
const REJECTED = ['庄子.md', '列子.md', '黄帝阴符经.md'];

const pad = (s, n) => String(s).padStart(n);
console.log(`L0 种子 ${L0.size} 字｜现有 Pool-B ${shipped.size} 条｜口径＝音步起点 × 同句读内间隔 ≤3`);
console.log(
  `${'书名'.padEnd(5)} ${pad('原文汉字', 9)} ${pad('句读段', 8)} ${pad('产双名', 8)} ${pad('音步口径', 9)}  新增`,
);

const perBook = {};
for (const [name, file] of Object.entries(CLEAN)) {
  const p = path.join(SRC, file);
  if (!fs.existsSync(p)) {
    console.log(`${name}：文件缺失 ${p}`);
    continue;
  }
  const text = fs.readFileSync(p, 'utf8').replace(/^#.*$/gm, '');
  const han = [...text].filter((c) => /[一-鿿]/.test(c)).length;
  const uProse = unitsFrom(text, 'prose');
  const uMeter = unitsFrom(text, 'meter');
  const rP = pairs(uProse),
    rM = pairs(uMeter);
  const newP = [...rP.clean].filter((x) => !shipped.has(x));
  const newM = [...rM.clean].filter((x) => !shipped.has(x));
  perBook[name] = { prose: rP, meter: rM };
  console.log(
    `${name.padEnd(4)} ${pad(han, 9)} ${pad(uProse.length, 8)} ${pad(rP.clean.size, 8)} ${pad(rM.clean.size, 9)}  ${pad(newP.length, 5)} / ${newM.length}（音步）`,
  );
}

const unionNew = new Set(),
  srcOf = new Map();
for (const [name, r] of Object.entries(perBook)) {
  for (const p of r.prose.clean) {
    if (shipped.has(p) || unionNew.has(p)) continue;
    unionNew.add(p);
    srcOf.set(p, `${name}《${r.prose.src.get(p).line.slice(0, 18)}》`);
  }
}
const unionMeter = new Set();
for (const r of Object.values(perBook)) for (const p of r.meter.clean) if (!shipped.has(p)) unionMeter.add(p);

console.log(
  `\n三书合并 新增：散文口径 ${unionNew.size} 条（现有 Pool-B 的 ${((unionNew.size / shipped.size) * 100).toFixed(0)}%）｜音步口径 ${unionMeter.size} 条（${((unionMeter.size / shipped.size) * 100).toFixed(0)}%）`,
);

const list = [...unionNew].sort();
for (let i = 0; i < list.length; i += 2) {
  const a = list[i],
    b = list[i + 1];
  console.log(`${a} ← ${srcOf.get(a)}${b ? `   ｜${b} ← ${srcOf.get(b)}` : ''}`);
}

console.log(`\n整本剔除：${REJECTED.join(' / ')}（白话改写/夹注本，取词等于引现代书）`);
console.log(
  '许可：数据集 wobure/zhuzi-baijia-books 上游标注 license 未知、内容为劝学网录入本，未清许可前不能 vendoring 进包。',
);
