// 构建期数据管线：把典籍语料 + 字表 + 词典固化成运行时只读的 JSON（candidates / poolC / singles / chars / homophone / risk / whitelist-L0）。
// 规则来源是 namer-research/measure_ladder.py（已实测复现 Pool-B 202），逐条对齐，不是重新设计。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pinyin } from 'pinyin-pro';
import { NAME_NOISE } from './name-noise.mjs';

const RAW = 'data/raw';
const OUT = 'src/data';
const NOT_CJK = /[^一-鿿]/g;

// 语料指纹：SHA256SUMS 清单本身的哈希。输入变了指纹就变，供 meta.json、verify 与页脚三处共用。
const corpusSha = createHash('sha256')
  .update(fs.readFileSync(path.join(RAW, 'SHA256SUMS')))
  .digest('hex')
  .slice(0, 12);

function read(p) {
  return fs.readFileSync(path.join(RAW, p), 'utf-8');
}
function json(p) {
  return JSON.parse(read(p));
}

function loadCharList(p) {
  const out = [];
  for (let line of read(p).split('\n')) {
    line = line.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    out.push(parts.length === 2 && /^\d+$/.test(parts[0]) ? parts[1] : line);
  }
  return out;
}

const WH1 = new Set(loadCharList('gsc_level_1.txt'));
const WH2 = new Set(loadCharList('gsc_level_2.txt'));
const WH3 = new Set(loadCharList('gsc_level_3.txt'));
const WH123 = new Set([...WH1, ...WH2, ...WH3]);
const WH12 = new Set([...WH1, ...WH2]);

// 派生自开放词典/姓名语料（scripts/derive-dict.mjs，见 LICENSES.md）：笔画·结构、字义、名用字频次
const SHAPE = json('dict_shape.json'); // 字 → [笔画, 结构名]
const GLOSS = json('dict_gloss.json'); // 字 → 短字义（本义优先）
const GIVEN_FREQ = json('name_given_freq.json'); // 字 → 真实姓名里的用字次数

// 虚词 / 现代功能词 / 忌讳字：与测量脚本同源
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

// 词频与字频（jieba 词典，MIT，仅构建期）
const wf = new Map();
const cf = new Map();
for (const line of read('jieba_dict.txt').split('\n')) {
  const p = line.split(' ');
  if (p.length < 3) continue;
  const f = Number(p[1]);
  wf.set(p[0], f);
  if (p[0].length === 1) cf.set(p[0], f);
}

// 部首提示：只认康熙字典五部（木75/火86/水85/金167/土32）。这是「该字的部首是什么」的可核对事实，
// 不是「该字五行属什么」的命理判断；其它部首一律留白，不做筛选、不做吉凶。
const KRS = new Map();
for (const line of read('unihan_krs_gsc.txt').split('\n')) {
  const [ch, r] = line.split('\t');
  if (ch && /^\d+$/.test(r.trim())) KRS.set(ch, Number(r.trim()));
}
const ELEMENT = { 32: '土', 75: '木', 85: '水', 86: '火', 167: '金' };
const radicalOf = (ch) => ELEMENT[KRS.get(ch)] ?? null;

// L0 名用字种子：cnname 属性表 ∩ 通用规范汉字表（一至三级，268 字）。五行/性别列只取性别风格，不用五行。
const attrs = json('cnname_attributes.json');
// 真实姓名语料里「这两个字的组合真有人用过多少次、上游标男还是标女」（派生自 wainshine 120 万姓名，
// 见 scripts/derive-cnname-given.mjs）。构建期查表挂到候选上，运行时只读不算。
const GIVEN_NAMES = json('cnname_given.json');
const attrDict = attrs.dict ?? attrs;
const femaleSet = new Set((attrDict.female ?? '').split(''));
const maleSet = new Set((attrDict.male ?? '').split(''));
const L0_SEED = new Set(
  [
    ...new Set(
      Object.values(attrDict)
        .filter((v) => typeof v === 'string')
        .join('')
        .split(''),
    ),
  ].filter((c) => WH123.has(c)),
);

// 人工过字结果（待审表「复制判定结果」的原文）。文件不存在＝只用种子，池子维持 463 条。
// 判定文本是外部输入，先逐字校验再入表：不在一级字表、是虚词、是忌讳字、同一字既保留又剔除——都在构建期炸掉，
// 不许靠「后面闸门会剔掉」蒙过去（那样白名单里会留着没人判过的字）。
const VERDICT_FILE = 'l0-verdicts.txt';
const parseVerdicts = (text) => {
  const grab = (label) => {
    const m = text.match(new RegExp(`^${label}=([\\s\\S]*?)(?=\\n(?=#|保留=|剔除=|待判=|预计)|$)`, 'm'));
    return m
      ? [
          ...new Set(
            m[1]
              .replace(/[^一-鿿]/g, '')
              .split('')
              .filter(Boolean),
          ),
        ]
      : [];
  };
  return { keep: grab('保留'), drop: grab('剔除') };
};
let verdicts = null;
if (fs.existsSync(path.join(RAW, VERDICT_FILE))) {
  const text = read(VERDICT_FILE);
  const { keep, drop } = parseVerdicts(text);
  const both = keep.filter((c) => drop.includes(c));
  if (both.length) throw new Error(`判定自相矛盾，这些字同时被标了保留和剔除：${both.join(' ')}`);
  // 0.7.0 起准入放宽到一二三级字表：只认一级字表时，薇 琬 琰 澈 澜 汀 鸾 笙 这一类永远进不来，
  // 而它们正是「新意」那一批（见 docs/l0-待判表.md 的第三个视角）。虚词与忌讳字的闸门不变。
  const bad = keep.filter((c) => !WH123.has(c) || XU.has(c) || BAD.has(c));
  if (bad.length) throw new Error(`判定里有不该进白名单的字（不在一二三级字表／虚词／忌讳）：${bad.join(' ')}`);
  if (!keep.length) throw new Error(`${VERDICT_FILE} 存在但「保留」是空的——要么给出判定，要么删掉这个文件回到种子版`);
  verdicts = { keep, drop, sha: createHash('sha256').update(text).digest('hex').slice(0, 16) };
}
const L0 = new Set(verdicts ? [...L0_SEED, ...verdicts.keep] : L0_SEED);
if (verdicts)
  console.log(
    `L0 白名单＝种子 ${L0_SEED.size} ＋ 人工保留 ${verdicts.keep.length} 字（剔除 ${verdicts.drop.length}）＝ ${L0.size} 字，判定文本 ${verdicts.sha}`,
  );
else console.log(`L0 白名单＝种子 ${L0_SEED.size} 字（未找到 ${VERDICT_FILE}，用种子版）`);

const BOOKS = [
  { key: 'shijing', code: 'sj', label: '诗经', strict: true },
  { key: 'chuci', code: 'cc', label: '楚辞', strict: true },
  { key: 'lunyu', code: 'ly', label: '论语', strict: false },
  { key: 'shuimo', code: 'ts', label: '唐诗', strict: true },
  { key: 'song300', code: 'song', label: '宋词', strict: false },
  { key: 'daofa', code: 'df', label: '道法', strict: false },
  { key: 'yuefu', code: 'yf', label: '乐府', strict: true },
];
const BOOK_STRICT = Object.fromEntries(BOOKS.map((b) => [b.key, b.strict]));

// 双名取字：起点必须落音步边界，与第二字的间隔最多 3 字（同句读内）。间隔越大越不成词，评分里单独降权。
const MAX_GAP = 3;

// 音步按体裁配，不按字数配（这是自审时改掉的 bug）
function offsets(book, n) {
  if (book === 'shijing' || book === 'shuimo' || book === 'yuefu')
    return { 4: [0, 2], 5: [0, 2], 7: [0, 2, 4] }[n] ?? [...Array(n - 1).keys()];
  if (book === 'chuci') return { 4: [0, 2], 5: [0, 3], 7: [0, 2, 4] }[n] ?? [...Array(n - 1).keys()];
  return [...Array(n - 1).keys()];
}

const SPLIT = /[。！？；]/;
// 跨字取词时，若某个取字在原文里紧邻同一个字（浩浩昊天 的 浩、青青子佩 的 青），它是叠词的一半，
// 与远处那个字粘成的「青佩/浩天」不是语义单元。这类粘连对不进池（2026-10-15 你拍板剔除）。
const inRedup = (cs, i) => (i > 0 && cs[i - 1] === cs[i]) || (i < cs.length - 1 && cs[i + 1] === cs[i]);
const COMMA = /[，、：]/;
// 语料各句本身带标点，用「，」拼接后会出现行首多余标点与「：，」这类叠标点；只影响展示，不影响取词
const tidy = (s) =>
  s
    .replace(/^[\s，、：；]+/, '')
    .replace(/[\s，、：；]+$/, '')
    .replace(/([：；])[\s，、：；]+/g, '$1')
    .replace(/([，、])[\s，、：；]+/g, '$1');

// 道法的一条目里放的是同一章/卦里互不相干的几个句读，用「，」拼会造出一个原文里没有的连读长句，
// 所以按「。」拼——拼完正好被 SPLIT 还原成各自的出处行。
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
  if (book === 'lunyu') return j.flatMap((ch) => ch.paragraphs.map(() => ({ title: ch.chapter, author: '' })));
  if (book === 'song300') return j.map((po) => ({ title: po.rhythmic ?? '', author: po.author ?? '' }));
  return j.map((po) => ({ title: po.title ?? '', author: po.author ?? '' }));
}

const unitCounts = {};
const unitsByBook = {};
for (const b of BOOKS) {
  unitCounts[b.key] = new Map();
  unitsByBook[b.key] = { segs: 0, chars: 0 };
}
const foot = new Map();
let sent = 0,
  segChars = 0;

for (const { key: book } of BOOKS) {
  const texts = rawText(book);
  const metas = rawMeta(book);
  for (let ti = 0; ti < texts.length; ti++) {
    const { title, author } = metas[ti];
    for (const s of String(texts[ti]).split(SPLIT)) {
      const line = s.trim();
      if (!line) continue;
      sent += 1;
      for (const u of line.split(COMMA)) {
        const cleaned = u.replace(/[“”‘’「」《》（）()]/g, '').trim();
        if (!cleaned) continue;
        for (const seg of cleaned.replace(NOT_CJK, '').split('兮')) {
          if (seg.length < 2) continue;
          segChars += seg.length;
          unitsByBook[book].segs += 1;
          unitsByBook[book].chars += seg.length;
          unitCounts[book].set(seg, (unitCounts[book].get(seg) ?? 0) + 1);
          const offs = offsets(book, seg.length);
          const cs = [...seg];
          for (const i of offs) {
            for (let gap = 1; gap <= MAX_GAP; gap++) {
              const j = i + gap;
              if (j >= cs.length) break;
              if (gap > 1 && (inRedup(cs, i) || inRedup(cs, j))) continue;
              const pair = cs[i] + cs[j];
              const rec = { book, title, author, line: tidy(line), seg, foot: i, gap };
              const cur = foot.get(pair);
              if (!cur || cur.gap > gap) foot.set(pair, rec);
            }
          }
        }
      }
    }
  }
}

function poolOf(d, whitelist) {
  const out = new Map();
  for (const [pair, v] of d) {
    const cs = pair.split('');
    if (cs.every((c) => whitelist.has(c)) && !cs.some((c) => XU.has(c))) out.set(pair, v);
  }
  return out;
}

const pB = poolOf(foot, L0);
const pB_bad = [...pB].filter(([p]) => p.split('').some((c) => BAD.has(c)));
for (const [p] of pB_bad) pB.delete(p);
const pB_hi = [...pB].filter(([p]) => (wf.get(p) ?? 0) >= 5000);
for (const [p] of pB_hi) pB.delete(p);
// 现代汉语成词：白名单扩表后这些字会重新配对（代理过字实测复现「楼上」），必须在构建期删，不能指望字不在表里
const NOISE = new Set(NAME_NOISE);
const pB_noise = [...pB].filter(([p]) => NOISE.has(p));
for (const [p] of pB_noise) pB.delete(p);
// 跨字取词会造出「假叠字」（以德报德→德德、似我心→心心）：不是叠字装置也不是复合词，一律不收
const pB_rep = [...pB].filter(([p, v]) => p[0] === p[1] && v.gap > 1);
for (const [p] of pB_rep) pB.delete(p);
const pC_all = poolOf(foot, WH1);
pC_all.forEach((v, k) => {
  if (BAD.has(k[0]) || BAD.has(k[1]) || NOISE.has(k) || (wf.get(k) ?? 0) >= 5000 || (k[0] === k[1] && v.gap > 1))
    pC_all.delete(k);
});
// pMix：一个雅字（L0）带一个一级字。全量 Pool-C 只测规模、不随包发布（体积预算见 6.1）
const pMix = new Map();
for (const [pair, v] of pC_all) if (L0.has(pair[0]) || L0.has(pair[1])) pMix.set(pair, v);

const dup = (p) => p[0] === p[1];
const sameShape = [...pB].filter(([p]) => (wf.get(p) ?? 0) >= 500);

// top10% 名句：该书内 seg 出现次数的 90 分位，且至少出现 2 次
const lineThreshold = {};
for (const { key } of BOOKS) {
  const arr = [...unitCounts[key].values()].sort((a, b) => a - b);
  if (!arr.length) {
    lineThreshold[key] = Infinity;
    continue;
  }
  const q = arr[Math.floor(arr.length * 0.9)] ?? arr[arr.length - 1];
  lineThreshold[key] = Math.max(2, q);
}

const syllable = (ch) =>
  pinyin(ch, { toneType: 'none', type: 'string', multiple: true })
    .split(/[,\s]+/)
    .filter(Boolean);
const marked = (ch) =>
  pinyin(ch, { toneType: 'default', type: 'string', multiple: true })
    .split(/[,\s]+/)
    .filter(Boolean);
const numbered = (ch) =>
  pinyin(ch, { toneType: 'num', type: 'string', multiple: true })
    .split(/[,\s]+/)
    .filter(Boolean);

// 一条读音＝一个带调音节。toneType:'none' 会把同音节的四声去重（解 jie3·jie4·xie4 只剩 jie xie），
// 所以不能拿它当逐读音列表，否则 syl/mark/tone 三个数组错位：478 个字的第 2 条读音起标成别的音节。
function readingsOf(ch) {
  const pm = marked(ch);
  const num = numbered(ch);
  if (!pm.length || pm.length !== num.length)
    throw new Error(`读音表错位：${ch} default=${pm.length} num=${num.length}`);
  return pm.map((mark, i) => ({ syl: num[i].replace(/\d+$/, ''), mark, tone: Number(num[i].match(/\d+$/)?.[0]) || 0 }));
}

// 一票定性会被「零信号字」拖错（尧圣/雪松/清洁 全被判偏女），所以标签改成运行期按强弱两级判定；
// 构建期只留一份分布统计给门禁对照，标签本身不进 candidates.json，避免两处实现漂移。
function genderClass(name) {
  const s = [...new Set(name.split(''))];
  const f = s.filter((c) => femaleSet.has(c)).length;
  const m = s.filter((c) => maleSet.has(c)).length;
  if (f && m) return 'n';
  if (!f && !m) return 'n';
  return (f ? 'f' : 'm') + (f + m === s.length ? '.strong' : '.weak');
}

const ascii = (title) =>
  pinyin(title || 'x', { toneType: 'none', type: 'string' })
    .replace(/[^a-z]/gi, '')
    .toLowerCase() || 'x';
const sortPairs = (m) =>
  [...m.entries()].sort((a, b) =>
    a[1].book < b[1].book ? -1 : a[1].book > b[1].book ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );

function makeList(entries, tier) {
  const seq = {};
  return entries.map(([name, v]) => {
    const bookCode = BOOKS.find((b) => b.key === v.book).code;
    const k = `${tier}${bookCode}_${ascii(v.title)}`;
    // id 里带名字、序号只按「篇＋去声调拼音」计数：池子扩容时旧 id 不位移。
    // 计数键用拼音而不是汉字，所以同篇同音不同字（采薇的 依依/翼翼）共用前缀，
    // 按出现顺序递增 _001/_002。碰撞规模由 verify 4c 计数并记进 meta（见 DESIGN.md）。
    const base = `${k}_${ascii(name)}`;
    seq[base] = (seq[base] ?? 0) + 1;
    const gapPenalty = v.gap === 1 ? 0 : v.gap === 2 ? -4 : -8;
    const staticScore =
      20 +
      (dup(name) ? 3 : 0) +
      gapPenalty +
      ((unitCounts[v.book].get(v.seg) ?? 0) >= lineThreshold[v.book] ? 8 : 0) +
      (v.book === 'chuci' || v.book === 'shijing' ? 3 : 0);
    const w = wf.get(name) ?? 0;
    return {
      id: `${base}_${String(seq[base]).padStart(3, '0')}`,
      name,
      chars: name.split(''), // 只在构建期用（单名出处对齐、门禁统计）；写产物时剥掉，见下方 write
      tier,
      book: v.book,
      title: v.title,
      author: v.author,
      line: v.line,
      seg: v.seg,
      foot: v.foot,
      gap: v.gap,
      strict: BOOK_STRICT[v.book],
      redup: dup(name),
      famous: (unitCounts[v.book].get(v.seg) ?? 0) >= lineThreshold[v.book],
      risk: w >= 500 ? { word: name, freq: w } : null,
      score: staticScore,
    };
  });
}

const candidates = makeList(sortPairs(pB), 'B');
const poolMix = makeList(sortPairs(pMix), 'C');

// 成词证据（0.4.0 新增）：这两个字在七部典籍正文里作为「相邻两字」出现过几次。
// 口径写死在这里：每篇正文单独取（不跨篇拼接）→ 按句读（句号的标点、逗号、顿号、冒号一类非汉字字符）切成段
// → 只在段内做长度 2 的滑动窗计数，允许重叠（所以「依依」在「依依依依」里算 3 次）。
// 切段这一步是有意的：「X，Y」这种跨句读的相邻不算成词，否则逗号两侧的字会被误当成一个词。
// 算出来的数进候选条目，运行时只读不算。
// 为什么要它：用户反馈「名字像硬凑」。跨字取词（gap 2/3）本来就是从一句里挑两个字，
// 如果这两个字在语料里从没挨在一起过，那它就是纯粹拼出来的，而不是典籍里现成的词。
const adjacent = new Map();
for (const { key } of BOOKS) {
  for (const text of rawText(key)) {
    for (const seg of text.split(/[^\u4e00-\u9fff]+/)) {
      for (let i = 0; i + 1 < seg.length; i++) {
        const k = seg.slice(i, i + 2);
        adjacent.set(k, (adjacent.get(k) ?? 0) + 1);
      }
    }
  }
}
// 拆词标记：跨字取词时，被跳过的那个中间字与两端在原句里本来就挨着，而那一处在语料里是成词的——
// 说明我们把一个现成的词剪开了（清扬婉兮 → 取「清婉」）。存下被拆开的原词，卡片上说得清是哪一处。
function splitPair(c) {
  if (c.gap < 2) return null;
  const s = [...c.seg];
  for (const [x, y] of [
    [c.foot, c.foot + 1],
    [c.foot + 1, c.foot + 2],
  ]) {
    const a = s[x];
    const b = s[y];
    if (!a || !b) continue;
    const pair = a + b;
    if ((adjacent.get(pair) ?? 0) >= 2 || wf.has(pair)) return pair;
  }
  return null;
}
for (const c of candidates) {
  const a = adjacent.get(c.name) ?? 0;
  const w = wf.get(c.name) ?? 0;
  if (a) c.a = a;
  if (w) c.w = w;
  const sp = splitPair(c);
  if (sp) c.spl = sp;
}
// 成词判定：语料里相邻出现过至少两次（不只这一条出处），或现代汉语词表收录，或是典籍里的叠字
// 真实用名证据：次数原样带上（卡片要写「N 人用过」），性别只在「≥5 次且 80% 单侧」时才算有向
const realSide = (rec) => {
  const t = rec[1] + rec[2];
  if (t < 5) return undefined;
  return rec[1] / t >= 0.8 ? 'm' : rec[2] / t >= 0.8 ? 'f' : 'n';
};
const GMALE = new Set([...attrs.male]);
const GFEMALE = new Set([...attrs.female]);
let realNamed = 0;
let realResolved = 0;
const realSideCount = { m: 0, f: 0, n: 0 };
for (const c of candidates) {
  const rec = GIVEN_NAMES[c.name];
  if (!rec) continue;
  c.rn = rec[0];
  realNamed += 1;
  const s = realSide(rec);
  if (!s) continue;
  c.rs = s;
  realSideCount[s] += 1;
  // 与 src/engine/name.ts 的 genderOf 同一条规则：只有「两个字都不在性别风格字表内」时，真实语料的标注才补档。
  // 「两表都有字」是字表给出的正面中性证据，不用一条逐名标注去推翻它。
  const cs = [...new Set([...c.name])];
  if (!cs.some((x) => GMALE.has(x) || GFEMALE.has(x)) && (s === 'm' || s === 'f')) realResolved += 1;
}

const isWordCand = (c) => (c.a ?? 0) >= 2 || (c.w ?? 0) > 0 || c.redup;

// 单字名：每个 L0 字取一个音步对齐的双字词做出处（分数最高、再按 id 最小），无对齐出处则不收录
const singles = [];
for (const ch of [...L0].sort()) {
  const hits = candidates.filter((c) => c.chars.includes(ch));
  if (!hits.length) continue;
  const best = hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))[0];
  const at = [...best.name].indexOf(ch);
  singles.push({
    char: ch,
    from: best.name,
    id: `S_${best.id}`,
    book: best.book,
    title: best.title,
    author: best.author,
    line: best.line,
    seg: best.seg,
    foot: best.foot + at * (best.gap ?? 1),
    gap: 0,
    strict: best.strict,
    famous: best.famous,
    score: best.score - 8,
  });
}

// 出处今译：本仓库自撰（data/raw/LICENSES.md），一行「原句\t释义」。
// 只有候选与单字出处的原句需要释义；缺一条、多一条都在构建期炸掉，不许静默留白。
const LINE_GLOSS_RAW = new Map();
for (const line of read('line_gloss.tsv').split('\n')) {
  if (!line) continue;
  const tab = line.indexOf('\t');
  if (tab < 0) throw new Error(`line_gloss.tsv 行格式错误（缺 Tab）：${line}`);
  const src = line.slice(0, tab);
  const gl = line.slice(tab + 1);
  if (!src || !gl) throw new Error(`line_gloss.tsv 有空字段：${line}`);
  if (LINE_GLOSS_RAW.has(src)) throw new Error(`line_gloss.tsv 原句重复：${src}`);
  LINE_GLOSS_RAW.set(src, gl);
}

// 按「候选 → 单字」的首次出现顺序编号；lg 是数组下标，运行时 LINE_GLOSS[lg] 直接取
const lineGloss = [];
const glossIndex = new Map();
const glossGaps = new Set(); // 今译覆盖不到的出处句：允许存在，但必须被数出来、被界面标成「待补」
const glossAt = (src) => {
  if (!LINE_GLOSS_RAW.has(src)) {
    glossGaps.add(src);
    return -1;
  }
  let i = glossIndex.get(src);
  if (i === undefined) {
    i = lineGloss.length;
    glossIndex.set(src, i);
    lineGloss.push(LINE_GLOSS_RAW.get(src));
  }
  return i;
};
for (const c of candidates) c.lg = glossAt(c.line);
for (const s of singles) s.lg = glossAt(s.line);
const unusedGloss = [...LINE_GLOSS_RAW.keys()].filter((src) => !glossIndex.has(src));
console.log(
  `今译覆盖：释义 ${LINE_GLOSS_RAW.size} 条｜被候选或单名用到 ${glossIndex.size} 条｜释义闲置 ${unusedGloss.length} 条｜出处句缺今译 ${glossGaps.size} 句`,
);
if (unusedGloss.length)
  throw new Error(`line_gloss.tsv 有 ${unusedGloss.length} 条释义没有对应原句：${unusedGloss.slice(0, 3).join(' | ')}`);
{
  // 覆盖率地板：扩池允许带来「原文照引、今译待补」的条目，但不能把它扩成译文大面积缺席的库
  const total = candidates.length + singles.length;
  const gap = candidates.filter((c) => c.lg === -1).length + singles.filter((s) => s.lg === -1).length;
  if ((total - gap) / total < 0.8)
    throw new Error(`今译覆盖率跌破 80%（缺 ${gap}/${total}）：这一轮扩池带进来的原句太多而译文没跟上`);
}

const chars = {};
for (const ch of [...WH123].sort()) {
  const rs = readingsOf(ch);
  // 带调拼音与「是否在白名单里」都不再存：前者由 src/engine/tone.ts 推导（下面逐条核对上游写法），
  // 后者由 whitelist-L0.json 那一份名单推导。8,105 个字省下来实测 26,146 B gzip。
  const rec = {
    py: rs.map((r) => r.syl),
    t: rs.map((r) => r.tone),
    lvl: WH1.has(ch) ? 1 : WH2.has(ch) ? 2 : 3,
    cf: cf.get(ch) ?? 0,
  };
  // 有才带字段，缺则省略：让「查不到」和「值为 0」在数据里可区分
  const sh = SHAPE[ch];
  if (Array.isArray(sh)) {
    if (Number.isInteger(sh[0])) rec.st = sh[0];
    if (sh[1]) rec.sx = sh[1];
  }
  if (GIVEN_FREQ[ch]) rec.gn = GIVEN_FREQ[ch];
  chars[ch] = rec;
}

// 字义只对名用字（L0）发布：卡片逐字显示，其余字不留
const gloss = Object.fromEntries(
  [...L0]
    .sort()
    .filter((c) => GLOSS[c])
    .map((c) => [c, GLOSS[c]]),
);

const negWords = new Set();
for (const [w, f] of wf) {
  if (w.length < 2 || w.length > 4 || f < 500) continue;
  if (![...w].every((c) => WH1.has(c))) continue;
  if (![...w].some((c) => BAD.has(c))) continue;
  negWords.add(w);
}
for (const w of [
  '肚子疼',
  '屁股',
  '王八',
  '乌龟',
  '太监',
  '傻瓜',
  '混蛋',
  '要饭',
  '死路',
  '苦命',
  '尸首',
  '绝后',
  '病故',
  '夭折',
  '短命',
  '贱人',
  '下贱',
  '亡命',
  '完蛋',
  '废物',
  '毒药',
  '祸害',
  '丧气',
  '晦气',
  '倒霉',
  '垃圾',
  '粪便',
  '蛆虫',
  '瘟病',
  '痢疾',
  '癌变',
  '绝症',
  '残废',
  '瞎子',
  '聋子',
  '哑巴',
  '疯子',
  '骗子',
  '盗贼',
  '强盗',
  '凶手',
  '卖花',
  '输钱',
  '毒酒',
  '气绝',
])
  negWords.add(w);

const homophoneFull = new Map();
const homophoneInitial = new Map();
for (const w of [...negWords].sort()) {
  const syl = [...w].flatMap(syllable);
  if (syl.length !== w.length) continue;
  const full = syl.join('');
  const ini = syl.map((s) => s[0]).join('');
  if (!homophoneFull.has(full)) homophoneFull.set(full, w);
  if (w.length >= 3 && !homophoneInitial.has(ini)) homophoneInitial.set(ini, w);
}
const homophone = {
  full: [...homophoneFull.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([py, w]) => ({ py, w })),
  initial: [...homophoneInitial.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([py, w]) => ({ py, w })),
};

const riskHigh = [...wf]
  .filter(([w, f]) => f >= 5000 && w.length === 2 && [...w].every((c) => WH1.has(c)))
  .map(([w]) => w)
  .sort();
const riskMidCount = [...wf].filter(
  ([w, f]) => f >= 500 && f < 5000 && w.length === 2 && [...w].every((c) => WH12.has(c)),
).length;

// 部首提示只覆盖候选里真出现过的字：其余留白（留白 ≠ 无五行），不做筛选、不做吉凶
const poolCharsSeen = new Set();
for (const c of candidates) for (const ch of c.chars) poolCharsSeen.add(ch);
for (const s of singles) poolCharsSeen.add(s.char);
const radical = Object.fromEntries(
  [...poolCharsSeen]
    .sort()
    .filter((ch) => radicalOf(ch))
    .map((ch) => [ch, radicalOf(ch)]),
);
const radicalDist = {};
for (const v of Object.values(radical)) radicalDist[v] = (radicalDist[v] ?? 0) + 1;

fs.mkdirSync(OUT, { recursive: true });
// 真实人名档：从 120 万真实姓名语料里取「真有人用过」的名字，补的是典籍取词给不了的那一半需求
// （名字数量与「真有人这么叫过」）。口径：次数 10～600（下界滤掉只见过一两次的噪声——10 次是在
// 120 万条真实姓名里被十个以上的人用过，仍然算「真有人这么叫」；上界滤掉婷婷／丽丽这类满街都是的），
// 两个字都必须在名用字白名单 L0 内（与典籍候选同一套用字口径，白名单没批过的字这一档也不越权），
// 并且不与候选池任何一条双名重名（名字唯一性是门禁）。
const REAL_MIN = 10;
const REAL_MAX = 600;
const poolNames = new Set(candidates.map((c) => c.name));
const realNames = Object.entries(GIVEN_NAMES)
  .filter(([name, rec]) => {
    if (name.length !== 2 || poolNames.has(name)) return false;
    if (rec[0] < REAL_MIN || rec[0] > REAL_MAX) return false;
    return [...name].every((ch) => L0.has(ch));
  })
  .map(([name, rec]) => {
    const it = { name, rn: rec[0], src: 'real' };
    const s = realSide(rec);
    if (s) it.rs = s;
    return it;
  })
  .sort((a, b) => (a.name < b.name ? -1 : 1));

const meta = {
  generated_by: 'scripts/build-data.mjs',
  L0_size: L0.size,
  gloss_lines: lineGloss.length, // 实际进包的今译条数（一句一条）
  gloss_gap_items: candidates.filter((c) => c.lg === -1).length + singles.filter((s) => s.lg === -1).length,
  gloss_gap_lines: glossGaps.size,
  L0_seed: L0_SEED.size,
  L0_added: verdicts ? verdicts.keep.length : 0,
  L0_dropped: verdicts ? verdicts.drop.length : 0,
  L0_verdicts_sha256: verdicts ? verdicts.sha : null,
  sentences: sent,
  seg_chars: segChars,
  units_by_book: unitsByBook,
  foot_pairs: foot.size,
  pool_B: candidates.length,
  corpus_sha: corpusSha,
  id_prefix_stats: (() => {
    const byBase = new Map();
    for (const c of candidates) {
      const base = c.id.replace(/_\d{3}$/, '');
      byBase.set(base, (byBase.get(base) ?? 0) + 1);
    }
    const sizes = [...byBase.values()];
    return { groups: sizes.length, collisions: sizes.filter((n) => n > 1).length, max_group: Math.max(...sizes) };
  })(),
  by_gap: Object.fromEntries([1, 2, 3].map((g) => [`gap${g}`, candidates.filter((c) => c.gap === g).length])),
  pool_C: pC_all.size,
  pool_mix_measured: poolMix.length,
  singles: singles.length,
  singles_without_source: L0.size - singles.length,
  risk_mid_dropped: riskMidCount,
  redup: candidates.filter((c) => c.redup).length,
  same_shape: sameShape.map(([p]) => p),
  removed_highfreq: pB_hi.map(([p]) => p),
  removed_noise: pB_noise.map(([p]) => p),
  removed_bad: pB_bad.map(([p]) => p),
  removed_repeat: pB_rep.map(([p]) => p),
  per_book: Object.fromEntries(BOOKS.map((b) => [b.key, candidates.filter((c) => c.book === b.key).length])),
  gender_table: {
    female: [...femaleSet].length,
    male: [...maleSet].length,
    overlap: [...femaleSet].filter((c) => maleSet.has(c)).length,
  },
  gender_dist: (() => {
    const d = {};
    for (const c of candidates) {
      const k = genderClass(c.name);
      d[k] = (d[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(d).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  })(),
  radical_chars: Object.keys(radical).length,
  radical_dist: Object.fromEntries(Object.entries(radicalDist).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  radical_named: candidates.filter((c) => c.chars.some((ch) => radical[ch])).length,
  shape_chars: Object.keys(SHAPE).length,
  gloss_chars: Object.keys(gloss).length,
  line_gloss: lineGloss.length,
  given_freq_chars: Object.keys(GIVEN_FREQ).length,
  // 真实用名证据（口径见上面 realSide 那段）
  pool_real_named: realNamed,
  real_tier: realNames.length,
  real_tier_genders: Object.values(realNames).reduce((a, x) => a + (x.rs ? 1 : 0), 0),
  pool_real_side_m: realSideCount.m,
  pool_real_side_f: realSideCount.f,
  pool_real_side_n: realSideCount.n,
  pool_real_resolved: realResolved,
  // 成词层（口径见上面 adjacent 那段）
  pool_word: candidates.filter(isWordCand).length,
  pool_attested: candidates.filter((c) => (c.a ?? 0) >= 2).length,
  pool_modern_word: candidates.filter((c) => (c.w ?? 0) > 0).length,
  pool_no_evidence: candidates.filter((c) => !isWordCand(c)).length,
  pool_split: candidates.filter((c) => c.spl).length,
};
const write = (name, data) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data) + '\n');

// ── 编码：可共享的与可推导的都不重复存（DESIGN.md 1.3.1）────────────────────────
// candidates.json 里 31.0 KB gzip 是原句、15.7 KB 是 id、10.6 KB 是篇名与作者、6.7 KB 是取词段。
// 这三样在同一条句读／同一篇作品上重复出现，所以集中成两张共享表（sources.json），
// 每条记录只留下「表下标 ＋ 自己独有的字段」。id 不在产物里存整串，但它可由
// 层＋书码＋篇名拼音＋名字拼音＋序号逐字重建：收藏、拉黑、分享链接里的 id 因此不变。
if (candidates.some((c) => c.tier !== 'B')) throw new Error('双名层的 tier 不再是全 B，id 推导要一起改');
const titleTable = [];
const titleIndex = new Map();
const lineTable = [];
const lineIndex = new Map();
const titleSlot = (c) => {
  const k = `${c.book}\u0000${c.title}\u0000${c.author}`;
  let i = titleIndex.get(k);
  if (i === undefined) {
    i = titleTable.length;
    titleIndex.set(k, i);
    titleTable.push({
      bk: c.book,
      code: BOOKS.find((b) => b.key === c.book).code,
      t: c.title,
      au: c.author,
      slug: ascii(c.title),
      st: BOOK_STRICT[c.book], // 严格诗体（音步起点）随篇名存一次，不在每条候选上重复
    });
  }
  return i;
};
const lineSlot = (line, lg) => {
  let i = lineIndex.get(line);
  if (i === undefined) {
    i = lineTable.length;
    lineIndex.set(line, i);
    lineTable.push({ s: line, g: lg ?? -1 });
  } else if (lineTable[i].g !== (lg ?? -1)) {
    throw new Error(`同一句的今译下标不一致：${line}`);
  }
  return i;
};
const idSeq = (id) => {
  const m = /^(.+)_(\d{3})$/.exec(id);
  if (!m) throw new Error(`id 形状不认识：${id}`);
  return Number(m[2]);
};
const segSlot = (c, line) => {
  const at = line.indexOf(c.seg);
  return at >= 0 ? { so: at, sn: c.seg.length } : { so: -1, sn: 0, sg: c.seg }; // 取词段不是连续子串时（拆词的那几条）原样存
};
const compactPair = (c) => {
  const li = lineSlot(c.line, c.lg);
  const out = {
    name: c.name,
    ti: titleSlot(c),
    li,
    ...segSlot(c, c.line),
    ns: ascii(c.name),
    sq: idSeq(c.id),
    foot: c.foot,
    gap: c.gap,
    score: c.score,
  };
  for (const k of ['a', 'w', 'spl', 'redup', 'famous', 'risk', 'rn', 'rs']) if (c[k] !== undefined) out[k] = c[k];
  return out;
};
const compactSingle = (c) => {
  const li = lineSlot(c.line, c.lg);
  const out = {
    char: c.char,
    from: c.from,
    ti: titleSlot(c),
    li,
    ...segSlot(c, c.line),
    ns: ascii(c.from),
    sq: idSeq(c.id.slice(2)), // 单字名的 id 是 S_＋出处双名的 id
    foot: c.foot,
    score: c.score,
  };
  if (c.famous) out.famous = true;
  return out;
};
// 产物里不存 chars：双名的 chars 恒等于 name 拆字，1,525 条存下来实测多花 7,951 B gzip
// （91,428 → 83,478 B）。运行时由 src/engine/data.ts 从 name 展开，形状不变。
write('candidates.json', candidates.map(compactPair));

write('singles.json', singles.map(compactSingle));

// 两张共享表要在候选与单名都填完之后才写得出内容
write('sources.json', { titles: titleTable, lines: lineTable });
meta.src_titles = titleTable.length; // 产物里的篇名条目数（545 篇 vs 1,660 条双名）
meta.src_lines = lineTable.length; // 共享原句表条数
meta.src_lines_gap = lineTable.filter((l) => l.g === -1).length; // 其中还没有今译的句子数
write('realnames.json', realNames);
write('chars.json', chars);
write('homophone.json', homophone);
write('risk.json', { high: riskHigh });
write('whitelist-L0.json', [...L0].sort());
// 性别风格只发这两张字表：标签与「判定依据」都在运行期算，构建期不再产出第二份标签
write('gender.json', { female: [...femaleSet].sort().join(''), male: [...maleSet].sort().join('') });
// 部首提示：字→五部元素名，只覆盖候选里出现过的字；引擎运行时按字查，查不到就留白
write('radical.json', radical);
// 字义：名用字逐字短释义（本义优先），卡片上「取字」旁展示
write('gloss.json', gloss);
// 出处今译：按原句首次出现顺序的纯数组，条目用 lg 下标取；不重复存句子，省体积
write('line_gloss.json', lineGloss);
{
  // 「今译待补」清单：哪些出处句还没有今译，按书分组写进 docs，下一轮补的时候照这张表勾。
  const byBook = new Map();
  for (const c of [...candidates, ...singles]) {
    if (c.lg !== -1) continue;
    const set = byBook.get(c.book) ?? new Set();
    set.add(c.line);
    byBook.set(c.book, set);
  }
  const md = [
    '# 今译待补清单',
    '',
    '由 `npm run build:data` 生成，不要手工编辑。这些原句有出处、有原文，但还没有现代汉语今译：',
    '卡片与导出里对应位置显示「今译待补」，不是缺漏被藏起来了。补法：在 `data/raw/line_gloss.tsv` 加一行「原句 TAB 今译」，重跑构建。',
    '',
    `共 ${glossGaps.size} 句，落在 ${[...byBook.keys()].length} 本书、${meta.gloss_gap_items} 条候选上（总候选 ${candidates.length} 条）。`,
    '',
    ...[...byBook].map(([b, set]) => `## ${b}（${set.size} 句）\n\n${[...set].map((l) => `- ${l}`).join('\n')}\n`),
  ].join('\n');
  fs.mkdirSync('docs', { recursive: true }); // 夹具里可能没有 docs/，清单要跟着产物一起写出来
  fs.writeFileSync('docs/gloss-gaps.md', md);
}
// 混合层实测 193 KB gzip，超出体积预算，且设计里它就是一层噪声：不进包，只出到 data/measured 供人工翻查
fs.mkdirSync('data/measured', { recursive: true });
fs.writeFileSync(
  'data/measured/poolC.json',
  JSON.stringify(
    poolMix.map((c) => ({
      name: c.name,
      book: c.book,
      title: c.title,
      seg: c.seg,
      foot: c.foot,
      gap: c.gap,
      score: c.score,
    })),
  ) + '\n',
);
const SHIPPED = [
  'candidates.json',
  'singles.json',
  'realnames.json',
  'chars.json',
  'homophone.json',
  'risk.json',
  'whitelist-L0.json',
  'gender.json',
  'radical.json',
  'gloss.json',
  'line_gloss.json',
  'sources.json',
];
// 只记未压缩字节数：gzip 结果和压缩器版本有关，写进包体会让构建不可复现（体积门槛由 size-check 现算，不进包）
meta.ship_bytes = Object.fromEntries(SHIPPED.map((f) => [f, fs.statSync(path.join(OUT, f)).size]));
meta.ship_bytes_total = Object.values(meta.ship_bytes).reduce((a, b) => a + b, 0);
write('meta.json', meta);

console.log(JSON.stringify(meta, null, 1));
