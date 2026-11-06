// P0 验收：确定性 + 四元组断言 + 结构不变量 + 性别口径。任何一条不过就 exit 1，构建脚本随之失败。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { NAME_NOISE } from './name-noise.mjs';

const OUT = 'src/data';
let fails = 0;
const ok = (cond, msg, extra) => {
  if (cond) console.log('  PASS', msg);
  else {
    fails++;
    console.log('  FAIL', msg, extra ?? '');
  }
};

const hash = () =>
  Object.fromEntries(
    fs
      .readdirSync(OUT)
      .sort()
      .map((f) => [
        f,
        createHash('sha256')
          .update(fs.readFileSync(path.join(OUT, f)))
          .digest('hex')
          .slice(0, 12),
      ]),
  );

console.log('0) 输入指纹：data/raw 必须与 SHA256SUMS 一致，否则实测数字不可复现');
{
  const RAW = 'data/raw';
  const lines = fs.readFileSync(`${RAW}/SHA256SUMS`, 'utf8').trim().split('\n');
  const expected = new Map(
    lines.map((l) => {
      const [h, f] = l.trim().split(/\s+/);
      return [f, h];
    }),
  );
  const present = new Set(
    fs.readdirSync(RAW).filter((f) => !['SHA256SUMS', 'LICENSES.md', 'l0-verdicts.txt', 'licenses'].includes(f)),
  );
  const bad = [];
  for (const [f, h] of expected) {
    if (!present.has(f)) {
      bad.push(`${f} 缺失`);
      continue;
    }
    const got = createHash('sha256')
      .update(fs.readFileSync(path.join(RAW, f)))
      .digest('hex');
    if (got !== h) bad.push(`${f} 字节已变`);
  }
  for (const f of present) if (!expected.has(f)) bad.push(`${f} 未登记`);
  ok(bad.length === 0 && expected.size === present.size, `raw ${expected.size} 个输入文件指纹全部匹配`, bad.join('；'));
  // 人工判定文本不进上游指纹（它是判定结果不是外部语料），改用 meta 里记录的指纹核对，防止「表改了没重建」
  if (fs.existsSync(`${RAW}/l0-verdicts.txt`)) {
    const built = JSON.parse(fs.readFileSync(`${OUT}/meta.json`, 'utf8'));
    const got = createHash('sha256')
      .update(fs.readFileSync(`${RAW}/l0-verdicts.txt`))
      .digest('hex')
      .slice(0, 16);
    ok(
      got === built.L0_verdicts_sha256,
      `判定文本与构建时一致（现 ${got} / 构建记录 ${built.L0_verdicts_sha256}）`,
      '表已改动但没重跑 build:data，src/data 不是当前判定的产物',
    );
  }
}

console.log('1) 确定性：连跑两次 build:data，产物哈希必须一致');
execFileSync('node', ['scripts/build-data.mjs'], { stdio: 'pipe' });
const h1 = hash();
execFileSync('node', ['scripts/build-data.mjs'], { stdio: 'pipe' });
const h2 = hash();
ok(
  JSON.stringify(h1) === JSON.stringify(h2),
  '两次构建字节一致',
  JSON.stringify(h1) === JSON.stringify(h2) ? '' : `${h1} vs ${h2}`,
);

const meta = JSON.parse(fs.readFileSync(`${OUT}/meta.json`, 'utf8'));
const L0 = new Set(JSON.parse(fs.readFileSync(`${OUT}/whitelist-L0.json`, 'utf8')));
const risk = JSON.parse(fs.readFileSync(`${OUT}/risk.json`, 'utf8'));
const SRC = JSON.parse(fs.readFileSync(`${OUT}/sources.json`, 'utf8'));
// 产物里每条候选只存「共享表下标＋自己独有的字段」：原句、篇名、id 都在 sources.json 那张表上。
// 这里独立展开一遍（与 src/engine/data.ts 各自的实现），下面所有规模／出处／id 断言都读展开后的条目。
// 可选字段有才带（DESIGN.md 1.3.1）：`redup`／`famous` 只在真带分时带键、`risk` 只在真有同形风险时带键，
// 缺键在这里补成 false／null——所以 4／4d／4g 那些逐条断言读的仍是布尔与 null，语义与改前一字不差。
// 键本身有没有出现由 4i 与 4g 独立断言（恒假的键不许进产物），那一段读的是没展开过的原始条目。
const pad3 = (n) => String(n).padStart(3, '0');
function expandItem(c, prefix) {
  const t = SRC.titles[c.ti];
  const l = SRC.lines[c.li];
  if (!t || !l) throw new Error(`产物里的共享表下标越界：${c.name ?? c.char}`);
  if (prefix === 'S_' && c.gap !== undefined) throw new Error(`单字名不该再存 gap：${c.char}`);
  return {
    ...c,
    id: `${prefix}B${t.code}_${t.slug}_${c.ns}_${pad3(c.sq)}`,
    tier: 'B',
    book: t.bk,
    title: t.t,
    author: t.au,
    line: l.s,
    seg: c.so === -1 ? c.sg : l.s.slice(c.so, c.so + c.sn),
    gap: prefix === 'S_' ? 0 : c.gap,
    strict: t.st,
    lg: l.g,
    redup: c.redup === true,
    famous: c.famous === true,
    risk: c.risk ?? null,
  };
}
const candRaw = JSON.parse(fs.readFileSync(`${OUT}/candidates.json`, 'utf8'));
const singlesRaw = JSON.parse(fs.readFileSync(`${OUT}/singles.json`, 'utf8'));
const cand = candRaw.map((c) => expandItem(c, ''));
const singles = singlesRaw.map((c) => expandItem(c, 'S_'));
const lineGloss = JSON.parse(fs.readFileSync(`${OUT}/line_gloss.json`, 'utf8'));
const names = new Set(cand.map((c) => c.name));

console.log('2) 实测规模（口径：起点落音步、同句读内间隔≤3、排除叠词粘连、七本典籍）');
// 种子版（没有人工判定）时，下面每个数都精确钉死；一旦人工判定扩表，同样的检查换成「只增不减」的下界，
// 外加结构恒等式（按书之和＝全池＝按间隔之和）——扩表不许让任何一条老名字消失，也不许让数字对不上账。
const SEED_MODE = !meta.L0_added;
const floorGate = (label, actual, seed) =>
  ok(
    SEED_MODE ? actual === seed : actual >= seed,
    `${label}：种子版要求恰为 ${seed}${SEED_MODE ? '' : `，扩表版要求 ≥${seed}`}，实际 ${actual}`,
  );
{
  const seedPool = {
    pool_B: 463,
    gap1: 217,
    gap2: 149,
    gap3: 97,
    redup: 30,
    per_book: { shijing: 58, chuci: 112, lunyu: 26, shuimo: 34, song300: 199, daofa: 34 },
  };
  floorGate('Pool-B', meta.pool_B, seedPool.pool_B);
  for (const g of ['gap1', 'gap2', 'gap3']) floorGate(`间隔分布 ${g}`, meta.by_gap[g], seedPool[g]);
  ok(
    Object.values(meta.by_gap).reduce((a, b) => a + b, 0) === meta.pool_B,
    `按间隔之和＝全池（${JSON.stringify(meta.by_gap)} vs ${meta.pool_B}）`,
  );
  for (const [b, n] of Object.entries(seedPool.per_book)) floorGate(`按书 ${b}`, meta.per_book[b], n);
  ok(
    Object.values(meta.per_book).reduce((a, b) => a + b, 0) === meta.pool_B,
    `按书之和＝全池（${JSON.stringify(meta.per_book)} vs ${meta.pool_B}）`,
  );
  floorGate('叠字', meta.redup, seedPool.redup);
  const repSeed = ['克克', '思思', '德德', '雪雪', '心心'];
  ok(
    SEED_MODE
      ? JSON.stringify(meta.removed_repeat) === JSON.stringify(repSeed)
      : repSeed.every((p) => meta.removed_repeat.includes(p)) && !repSeed.some((p) => names.has(p)),
    `假叠字（同字跨位重复）${SEED_MODE ? '恰为 ' + repSeed.join('/') : '仍全部被剔除：' + repSeed.join('/')}（实际剔除 ${meta.removed_repeat.length} 条）`,
  );
  ok(
    meta.L0_size === meta.L0_seed + meta.L0_added,
    `白名单账目自洽：${meta.L0_size}＝种子 ${meta.L0_seed}＋人工 ${meta.L0_added}`,
  );
  ok(
    !!meta.L0_verdicts_sha256 === meta.L0_added > 0,
    `扩表必须带判定文本指纹（L0_added=${meta.L0_added}，sha=${meta.L0_verdicts_sha256}）`,
  );
  console.log(
    `   白名单：${meta.L0_size} 字（${meta.L0_added ? '种子 ' + meta.L0_seed + '＋人工保留 ' + meta.L0_added + '，剔除 ' + meta.L0_dropped + '，判定 ' + meta.L0_verdicts_sha256 : '仅种子，未扩表'}）`,
  );
}
const segs = Object.values(meta.units_by_book).reduce((a, b) => a + b.segs, 0);
const chs = Object.values(meta.units_by_book).reduce((a, b) => a + b.chars, 0);
const expectLater = []; // 四元组要等 expect() 定义后再执行（见第 3 节末）
ok(segs === 23133 && chs === 101805, `取词段 23,133 / 101,805 字（实际 ${segs} / ${chs}）`);
// 第 6 本道法是「逐条收录」的 curated 语料（22 条句读行），第 7 本乐府是 vendored 语料。
// 加书只该新增、不该删老名字；出处改判只允许间隔严格变小，且必须逐条钉死、不许悄悄发生。
{
  const nonDf = cand.filter((c) => c.book !== 'daofa');
  const tq = cand.find((c) => c.name === '天清');
  ok(
    nonDf.length >= 429 && tq?.book === 'daofa' && tq?.gap === 1 && tq?.title === '清静经',
    `加书不动老池：非道法侧 ${nonDf.length} 条（种子版基线 429＝原 430 减唯一改判 天清→清静经 gap 3→1），天清实际挂 ${tq?.book}·${tq?.title} gap ${tq?.gap}`,
  );
  ok(
    meta.units_by_book.daofa.segs === 68 && meta.units_by_book.daofa.chars === 321,
    `道法语料规模锁定 68 段 / 321 字（实际 ${meta.units_by_book.daofa.segs} / ${meta.units_by_book.daofa.chars}）——curated 语料不许悄悄变胖`,
  );
  ok(
    meta.per_book.yuefu >= 20 && meta.units_by_book.yuefu.segs === 429 && meta.units_by_book.yuefu.chars === 2134,
    `乐府语料规模锁定 429 段 / 2,134 字（实际 ${meta.units_by_book.yuefu.segs} / ${meta.units_by_book.yuefu.chars}，按书新增 ${meta.per_book.yuefu} 条）`,
  );
  // 乐府并入时全池只发生这两条出处改判，间隔都从 3 缩到 2；任何别的改判都会在这里显形
  expectLater.push(['依山', 'yuefu', '琅琊王歌辞', '猛虎依深山', 2, 2], ['江可', 'yuefu', '江南', '江南可采莲', 0, 2]);
}

console.log('3) 四元组断言：名字 + 出处原句 + 音步下标 + 间隔，缺一即无效');
const expect = (name, book, title, seg, foot, gap) => {
  const hit = cand.filter((c) => c.name === name);
  if (hit.length !== 1) {
    ok(false, `${name} 唯一（实际 ${hit.length} 条）`);
    return;
  }
  const r = hit[0];
  ok(
    r.book === book && r.title === title && r.seg === seg && r.foot === foot && r.gap === gap,
    `${name} = ${book}·${title}「${seg}」第 ${foot + 1} 字起、间隔 ${gap}`,
    `实际 ${r.book}·${r.title}「${r.seg}」foot=${r.foot} gap=${r.gap}`,
  );
};
expect('灵均', 'chuci', '离骚', '字余曰灵均', 3, 1);
expect('沐芳', 'chuci', '云中君', '沐芳', 0, 1);
expect('燕婉', 'shijing', '新台', '燕婉之求', 0, 1);
expect('雨桐', 'song300', '鹧鸪天', '殷云度雨疏桐落', 3, 2);
expect('雪松', 'song300', '六丑', '雪绵松润', 0, 2);
expect('芳泽', 'chuci', '离骚', '芳与泽其杂糅', 0, 2);
expect('洁淑', 'chuci', '哀时命', '中皎洁而淑清', 2, 2);
expect('佩龙', 'chuci', '远逝', '佩苍龙之蚴虬', 0, 2);
expect('凤翼', 'chuci', '离骚', '凤皇翼其承旗', 0, 2);
expect('静珍', 'song300', '六丑', '静绕珍丛底', 0, 2);
expect('良智', 'chuci', '愍命', '招贞良与明智', 2, 3);
expect('可勇', 'lunyu', '先进篇', '可使有勇', 0, 3);
expect('玄德', 'daofa', '第六十五章', '是谓玄德', 2, 1);
expect('东华', 'daofa', '清静经', '吾昔受之于东华帝君', 5, 1);
expect('天健', 'daofa', '乾·象', '天行健', 0, 2);
expect('心渊', 'daofa', '第八章', '心善渊', 0, 2);
for (const a of expectLater) expect(...a);
// 道法是「逐条收录」的 curated 语料：下面这些配对只有整本 vendoring 才会出现。它们不在池＝语料没被换成 scraped 全本。
for (const w of [
  '锐可',
  '智慧',
  '圣智',
  '可天',
  '可渊',
  '义克',
  '义宾',
  '鼎金',
  '威天',
  '腾紫',
  '可圣',
  '静基',
  '志可',
  '志光',
  '心天',
  '天柔',
  '祥天',
  '强天',
  '圣天',
  '柔丽',
  '龙天',
  '龙野',
  '美天',
  '承德',
  '心语',
  '天泽',
  '震龙',
  '坤天',
  '震坤',
  '坤震',
  '震天',
  '坤泽',
  '鼎鼎',
])
  ok(!names.has(w), `整本才会出现的道法噪声不在池：${w}`);
for (const w of ['思柔', '清馨', '承宇', '淑清', '玄鹤', '白露', '昭华', '弘毅']) ok(names.has(w), `名篇词在池：${w}`);
for (const w of NAME_NOISE) ok(!names.has(w), `现代成词不在池（构建期删除，与白名单规模无关）：${w}`);
for (const w of ['心心', '德德']) ok(!names.has(w), `假叠字不在池（规则见 removed_repeat）：${w}`);
if (SEED_MODE)
  for (const w of ['静姝', '各敬', '同僚', '苟无', '那堪']) ok(!names.has(w), `种子版字表下不产这些配对：${w}`);
for (const w of ['欣美', '皓白', '翔翼', '龙婉', '浩天', '英白', '青佩', '青柳'])
  ok(!names.has(w), `叠词粘连不在池：${w}`);
ok(names.has('雪天'), '雪天（年年移帐雪中天，两字都不在叠词内）仍须收录——防剔除规则写过头');

console.log('4) 结构不变量（全池）');
const offsets = (book, n) => {
  if (book === 'shijing' || book === 'shuimo' || book === 'yuefu')
    return { 4: [0, 2], 5: [0, 2], 7: [0, 2, 4] }[n] ?? [...Array(n - 1).keys()];
  if (book === 'chuci') return { 4: [0, 2], 5: [0, 3], 7: [0, 2, 4] }[n] ?? [...Array(n - 1).keys()];
  return [...Array(n - 1).keys()];
};
const bad = [];
for (const c of cand) {
  const segCharsArr = Array.from(c.seg);
  if (!c.line || !c.title) bad.push(`${c.id}: 缺出处`);
  if (c.seg.includes('兮')) bad.push(`${c.id}: seg 残留「兮」，说明没按切分点处理`);
  if (![...c.name].every((ch) => L0.has(ch))) bad.push(`${c.id}: 有字不在 L0`);
  if (risk.high.includes(c.name)) bad.push(`${c.id}: 命中高频现代词表`);
  if (!offsets(c.book, c.seg.length).includes(c.foot)) bad.push(`${c.id}: foot 不在该书音步表`);
  if (!(c.gap >= 1 && c.gap <= 3)) bad.push(`${c.id}: gap=${c.gap} 越界`);
  if (segCharsArr[c.foot] + segCharsArr[c.foot + c.gap] !== c.name) bad.push(`${c.id}: name≠seg[foot]+seg[foot+gap]`);
  if (c.name[0] === c.name[1] && c.gap !== 1) bad.push(`${c.id}: 假叠字（同字跨位）`);
  if (
    c.gap > 1 &&
    (segCharsArr[c.foot - 1] === segCharsArr[c.foot] ||
      segCharsArr[c.foot + 1] === segCharsArr[c.foot] ||
      segCharsArr[c.foot + c.gap - 1] === segCharsArr[c.foot + c.gap] ||
      segCharsArr[c.foot + c.gap + 1] === segCharsArr[c.foot + c.gap])
  ) {
    bad.push(`${c.id}: 叠词粘连（取字落在叠词内）`);
  }
  if (c.redup !== (c.name[0] === c.name[1])) bad.push(`${c.id}: redup 标记与字面不符`);
}
for (const s of singles) {
  if (Array.from(s.seg)[s.foot] !== s.char) bad.push(`${s.id}: 单字出处 seg[foot]≠该字`);
  if (s.gap !== 0) bad.push(`${s.id}: 单字名 gap 应为 0`);
  if (!names.has(s.from)) bad.push(`${s.id}: 出处词不在双名池`);
}
ok(bad.length === 0, `全池 ${cand.length} 条 + ${singles.length} 条单字出处结构合法`, bad.slice(0, 6).join(' | '));
const dupIds = cand.length - new Set(cand.map((c) => c.id)).size;
ok(dupIds === 0, `id 唯一（重复 ${dupIds}）`);
// 名字本身也要唯一：同一个双名不得既在《诗经》又在《楚辞》里出现一遍，也不得在同一部典籍里出现两遍。
// 这条断言是 0.4.0 加的用户要求（"结果里不要有重复的名字"）。今天的主池 1,525 条名字互不相同，
// 以后扩表／换语料时若引入同名，这里先红，由构建阶段决定保留哪一条出处（其余并入 alternates）。
const dupNames = cand.length - new Set(cand.map((c) => c.name)).size;
ok(dupNames === 0, `双名名字唯一（重复 ${dupNames} 条）`);
const dupWithin = cand.filter((c) => cand.some((o) => o.name === c.name && o.id !== c.id));
ok(
  dupWithin.length === 0,
  `同一名字不跨典籍重复（涉及 ${dupWithin.length} 条）`,
  dupWithin
    .slice(0, 6)
    .map((c) => c.name)
    .join(' '),
);
const dupSingles = singles.length - new Set(singles.map((s) => s.char)).size;
ok(dupSingles === 0, `单名用字唯一（重复 ${dupSingles} 条）`);
const sameShape = cand
  .filter((c) => c.risk)
  .map((c) => c.name)
  .sort();
const sameShapeSet = new Set(sameShape);
const seedShape = ['东城', '东海', '可可', '清华', '清洁', '白雪', '青海', '青青'];
ok(
  seedShape.every((p) => sameShapeSet.has(p)),
  `同形标注：种子版那 8 条仍在表内并带 risk（实际全池标注 ${sameShape.length} 条：${sameShape.join(' ')}）`,
);
const poolCharsSeen = new Set(cand.flatMap((c) => [...c.name]));
ok(
  singles.length === [...L0].filter((ch) => poolCharsSeen.has(ch)).length &&
    singles.length + meta.singles_without_source === L0.size,
  `单字名＝白名单里有对齐出处的字 ${singles.length} 个（白名单 ${L0.size}，无出处 ${meta.singles_without_source}）`,
);

console.log('4b) 出处今译：按书数覆盖率，缺今译必须是 lg=-1 且被清单数出来');
{
  const rawGloss = new Map();
  for (const line of fs.readFileSync('data/raw/line_gloss.tsv', 'utf8').split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    rawGloss.set(line.slice(0, tab), line.slice(tab + 1));
  }
  ok(
    rawGloss.size >= 1140 && lineGloss.length === rawGloss.size,
    `raw 今译 ${rawGloss.size} 行、进包 ${lineGloss.length} 句（种子版基线 1,140 行，只许多不许少；写了就必须进包）`,
  );
  const items = [...cand, ...singles];
  const bad = [];
  for (const c of items) {
    if (c.lg === -1) {
      if (rawGloss.has(c.line)) bad.push(`${c.id} 的出处在 raw 里有今译却没编号`);
      continue;
    }
    if (!Number.isInteger(c.lg) || c.lg < 0 || c.lg >= lineGloss.length) {
      bad.push(`${c.id} 的 lg ${c.lg} 越界`);
      continue;
    }
    if (rawGloss.get(c.line) !== lineGloss[c.lg]) bad.push(`${c.id} 的今译与 raw 不一致：${c.line}`);
  }
  ok(
    bad.length === 0,
    '每条要么指到与 raw 逐字一致的今译，要么是明确的 -1（不符 ' + bad.length + ' 处）',
    bad.slice(0, 3).join(' | '),
  );
  const byLine = new Map();
  const clash = [];
  for (const c of items) {
    if (c.lg < 0) continue;
    if (byLine.has(c.line) && byLine.get(c.line) !== c.lg) clash.push(c.line);
    byLine.set(c.line, c.lg);
    if (byLine.get(c.lg) !== undefined) continue;
  }
  ok(clash.length === 0, '一句一译：同一原句在所有条目里共用同一个下标', clash.slice(0, 3).join(' | '));
  // 「别处的出处」同样会用到今译：alternates 指到的原句一起算进「被用到」这一侧
  const lineTextV = (l) => (typeof l === 'string' ? l : l.s);
  const altSentences = new Set();
  const glossMismatch = [];
  {
    const rawCand = JSON.parse(fs.readFileSync(`${OUT}/candidates.json`, 'utf8'));
    for (const c of rawCand) {
      let prev = 0;
      for (let i = 0; i < (c.alt ?? []).length; i += 4) {
        prev += c.alt[i + 1];
        const entry = SRC.lines[prev];
        if (!entry) continue;
        const sentence = lineTextV(entry);
        altSentences.add(sentence);
        if (typeof entry === 'object' && rawGloss.get(sentence) !== lineGloss[entry.g])
          glossMismatch.push(`别处出处的一句对不上 raw 释义：${sentence}`);
      }
    }
  }
  ok(
    glossMismatch.length === 0,
    `别处出处带的今译也与 raw 逐字一致（不符 ${glossMismatch.length} 处）`,
    glossMismatch.slice(0, 3).join(' | '),
  );
  const unused = [...rawGloss.keys()].filter((src) => !byLine.has(src) && !altSentences.has(src));
  ok(
    unused.length === 0,
    `raw 今译没有闲置条目（闲置 ${unused.length} 条：写了译文的句子必须真被某条出处用到，主出处或别处出处都算）`,
    unused.slice(0, 3).join(' | '),
  );
  // 按书覆盖率：不再要求「全覆盖」，但每一本都要看得见覆盖到多少、缺多少
  const per = new Map();
  for (const c of items) {
    const t = per.get(c.book) ?? { n: 0, g: 0, lines: new Set(), gapLines: new Set() };
    t.n += 1;
    t.lines.add(c.line);
    if (c.lg >= 0) t.g += 1;
    else t.gapLines.add(c.line);
    per.set(c.book, t);
  }
  let allN = 0;
  let allG = 0;
  for (const [b, t] of [...per].sort((x, y) => y[1].n - x[1].n)) {
    allN += t.n;
    allG += t.g;
    console.log(
      `  ${b}：条目 ${t.n} 条 · 今译覆盖 ${t.g} 条 ${(100 * t.g) / t.n >= 99.5 ? '100%' : ((100 * t.g) / t.n).toFixed(1) + '%'} · 唯一原句 ${t.lines.size} 句（缺今译 ${t.gapLines.size} 句）`,
    );
  }
  ok(
    allG / allN >= 0.8,
    `每一本的今译覆盖率都不低于 80%（实测 ${(100 * allG) / allN} 条 ${((100 * allG) / allN).toFixed(1)}%）`,
  );
  for (const [b, t] of per) ok(t.g / t.n >= 0.6, `${b} 的今译覆盖率 ${((100 * t.g) / t.n).toFixed(1)}% 不低于 60%`);
  const gapItems = items.filter((c) => c.lg === -1).length;
  ok(
    gapItems === meta.gloss_gap_items,
    `缺今译的条目数 ${gapItems} 与 meta.gloss_gap_items 一致（卡片显示「今译待补」）`,
  );
  ok(
    new Set(items.filter((c) => c.lg === -1).map((c) => c.line)).size === meta.gloss_gap_lines,
    '缺今译的唯一原句数与 meta 一致',
  );
}

console.log('4c) 编号前缀碰撞：计数键是去声调拼音，同篇同音不同字共用前缀（这是事实，不是缺陷隐藏）');
{
  const baseOf = (id) => id.replace(/_\d{3}$/, '');
  const byBase = new Map();
  for (const c of cand) byBase.set(baseOf(c.id), (byBase.get(baseOf(c.id)) ?? 0) + 1);
  const colliding = [...byBase.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const stats = { groups: byBase.size, collisions: colliding.length, max_group: Math.max(...byBase.values()) };
  ok(
    stats.groups === meta.id_prefix_stats.groups &&
      stats.collisions === meta.id_prefix_stats.collisions &&
      stats.max_group === meta.id_prefix_stats.max_group,
    `前缀 ${stats.groups} 组，其中 ${stats.collisions} 组 2 条以上，最大组 ${stats.max_group} 条（与 meta 一致）：${colliding.map(([b, n]) => `${b}×${n}`).join(' ')}`,
  );
}

// 语料里「相邻两字」的出现次数：4d 的成词证据与 4g 的名句层共用这一份重算结果。
// 它与 build-data 的 adjacent 是两份各写各的实现——同一条口径（每篇正文单独取、按非汉字字符切段、
// 段内长度 2 的滑动窗、允许重叠），谁改歪了另一份就把谁咬住。
const BOOK_KEYS = ['shijing', 'chuci', 'lunyu', 'shuimo', 'song300', 'daofa', 'yuefu'];
const adjacentCount = (() => {
  const adj = new Map();
  for (const b of BOOK_KEYS) {
    const raw = JSON.parse(fs.readFileSync(`data/raw/${b}.json`, 'utf8'));
    for (const unit of raw) {
      const body = Array.isArray(unit.paragraphs)
        ? unit.paragraphs
        : Array.isArray(unit.content)
          ? unit.content
          : [typeof unit.content === 'string' ? unit.content : ''];
      for (const t of body) {
        if (typeof t !== 'string') continue;
        for (const seg of t.split(/[^\u4e00-\u9fff]+/)) {
          for (let i = 0; i + 1 < seg.length; i++) {
            const k = seg.slice(i, i + 2);
            adj.set(k, (adj.get(k) ?? 0) + 1);
          }
        }
      }
    }
  }
  return adj;
})();

console.log('4d) 成词证据：a / w / spl 由 data/raw 与 jieba 词典独立重算核对（默认只给成词层的名字）');
{
  const jieba = new Map();
  for (const line of fs.readFileSync('data/raw/jieba_dict.txt', 'utf8').split('\n')) {
    const p = line.split(' ');
    if (p.length >= 3) jieba.set(p[0], Number(p[1]));
  }
  const badA = [];
  const badW = [];
  const badSpl = [];
  for (const c of cand) {
    const a = adjacentCount.get(c.name) ?? 0;
    if ((c.a ?? 0) !== a) badA.push(`${c.name}: 记 ${c.a ?? 0} 实算 ${a}`);
    const w = jieba.get(c.name) ?? 0;
    if ((c.w ?? 0) !== w) badW.push(`${c.name}: 记 ${c.w ?? 0} 实算 ${w}`);
    if (c.gap < 2 && c.spl) badSpl.push(`${c.name}: gap ${c.gap} 却带拆词标记`);
    if (
      c.spl &&
      ![...c.seg]
        .slice(c.foot, c.foot + 3)
        .join('')
        .includes(c.spl)
    )
      badSpl.push(`${c.name}: 拆词标记的「${c.spl}」不在取词窗口内`);
  }
  ok(badA.length === 0, `成词次数 a 与语料重算一致（不符 ${badA.length} 条）`, badA.slice(0, 4).join(' | '));
  ok(badW.length === 0, `现代词频 w 与 jieba 词典一致（不符 ${badW.length} 条）`, badW.slice(0, 4).join(' | '));
  ok(
    badSpl.length === 0,
    `拆词标记只落在跨字取词上、写的确实是取词窗口里那一对字（违规 ${badSpl.length} 条）`,
    badSpl.slice(0, 4).join(' | '),
  );
  const word = cand.filter((c) => (c.a ?? 0) >= 2 || (c.w ?? 0) > 0 || c.redup);
  ok(word.length === meta.pool_word, `成词层 ${word.length} 条与 meta 记的一致`);
  ok(cand.length - word.length === meta.pool_no_evidence, `无成词依据 ${cand.length - word.length} 条与 meta 一致`);
  ok(meta.pool_word + meta.pool_no_evidence === meta.pool_B, `成词层 + 无依据 = 全池 ${meta.pool_B}`);
  ok(cand.filter((c) => c.spl).length === meta.pool_split, `拆词标记 ${meta.pool_split} 条与池内实况一致`);
  ok(word.length >= 400, `成词层不能小到没得挑（现 ${word.length} / 全池 ${cand.length}）`);
}

console.log('4e) 真实用名证据：rn / rs 由 data/raw/cnname_given.json 独立重算核对');
{
  const T = JSON.parse(fs.readFileSync('data/raw/cnname_given.json', 'utf8'));
  const attrs = JSON.parse(fs.readFileSync('data/raw/cnname_attributes.json', 'utf8'));
  const MALE = new Set([...attrs.male]);
  const FEMALE = new Set([...attrs.female]);
  const sideOf = (rec) => {
    const t = rec[1] + rec[2];
    if (t < 5) return undefined;
    return rec[1] / t >= 0.8 ? 'm' : rec[2] / t >= 0.8 ? 'f' : 'n';
  };
  const bad = [];
  let named = 0;
  let resolved = 0;
  const cnt = { m: 0, f: 0, n: 0 };
  for (const c of cand) {
    const rec = T[c.name];
    const wantN = rec ? rec[0] : undefined;
    if ((c.rn ?? undefined) !== wantN) bad.push(`${c.name}: rn 记 ${c.rn ?? '无'} 应为 ${wantN ?? '无'}`);
    const s = rec ? sideOf(rec) : undefined;
    if ((c.rs ?? undefined) !== s) bad.push(`${c.name}: rs 记 ${c.rs ?? '无'} 应为 ${s ?? '无'}`);
    if (rec) {
      named += 1;
      if (s) cnt[s] += 1;
    }
    if ((s === 'm' || s === 'f') && ![...new Set([...c.name])].some((x) => MALE.has(x) || FEMALE.has(x))) resolved += 1;
  }
  ok(bad.length === 0, `真实用名次数与性别标注同派生表一致（不符 ${bad.length} 条）`, bad.slice(0, 4).join(' | '));
  ok(named === meta.pool_real_named, `有真实用名记录的候选 ${named} 条与 meta 一致`);
  ok(
    cnt.m === meta.pool_real_side_m && cnt.f === meta.pool_real_side_f && cnt.n === meta.pool_real_side_n,
    `真实语料的性别标注分布 ${JSON.stringify(cnt)} 与 meta 一致`,
  );
  ok(
    resolved === meta.pool_real_resolved,
    `字表给不出侧、由真实语料补档的 ${resolved} 条与 meta 一致（「两表都有字」不推翻）`,
  );
  ok(named >= 500, `真实用名记录不能太稀（现 ${named} / ${cand.length} 条）`);
}

console.log('4f) 真实人名档：来源独立、与派生表一致、跨层不重名');
{
  const real = JSON.parse(fs.readFileSync('src/data/realnames.json', 'utf8'));
  const T = JSON.parse(fs.readFileSync('data/raw/cnname_given.json', 'utf8'));
  const L0 = new Set(JSON.parse(fs.readFileSync('src/data/whitelist-L0.json', 'utf8')));
  const sideOf = (rec) => {
    const t = rec[1] + rec[2];
    if (t < 5) return undefined;
    return rec[1] / t >= 0.8 ? 'm' : rec[2] / t >= 0.8 ? 'f' : 'n';
  };
  // 独立重算这一档的入选集合：次数 10～600、两字都在白名单内、不与候选池重名
  const poolNames = new Set(cand.map((c) => c.name));
  const want = new Map();
  for (const [name, rec] of Object.entries(T)) {
    if (name.length !== 2 || poolNames.has(name)) continue;
    if (rec[0] < 10 || rec[0] > 600) continue;
    if (![...name].every((ch) => L0.has(ch))) continue;
    want.set(name, rec);
  }
  ok(
    real.length === want.size,
    `真实人名档条数 ${real.length}＝独立重算的入选数 ${want.size}`,
    `meta ${meta.real_tier}`,
  );
  ok(real.length === meta.real_tier, `真实人名档条数与 meta.real_tier ${meta.real_tier} 一致`);
  const bad = [];
  const seen = new Set();
  let withSide = 0;
  for (const it of real) {
    const rec = want.get(it.name);
    if (!rec) bad.push(`${it.name} 不该入选（不在派生表的 10～600 段或用了白名单外的字或与候选池重名）`);
    if (seen.has(it.name)) bad.push(`${it.name} 在本档内重复`);
    seen.add(it.name);
    if (poolNames.has(it.name)) bad.push(`${it.name} 与候选池重名（名字必须全局唯一）`);
    if (it.src !== 'real') bad.push(`${it.name} 的来源标记不是 real`);
    if (rec && it.rn !== rec[0]) bad.push(`${it.name} 次数记 ${it.rn} 应为 ${rec[0]}`);
    const s = rec ? sideOf(rec) : undefined;
    if ((it.rs ?? undefined) !== s) bad.push(`${it.name} 性别标注记 ${it.rs ?? '无'} 应为 ${s ?? '无'}`);
    if (it.rs) withSide += 1;
    for (const ch of it.name) if (!L0.has(ch)) bad.push(`${it.name} 用了白名单外的字 ${ch}`);
  }
  ok(
    bad.length === 0,
    `真实人名档逐条与派生表／白名单／唯一性一致（不符 ${bad.length} 处）`,
    bad.slice(0, 4).join(' | '),
  );
  ok(withSide === meta.real_tier_genders, `带性别标注的 ${withSide} 条与 meta 一致`);
  ok(real.length >= 800, `真实人名档要有量（现 ${real.length} 条），否则解决不了「随便一选就没了」`);
}

console.log('4g) 名句层 famous：跨全池的单一阈值与逐条判定，全部由 data/raw 独立重算（不读回 meta 自己跟自己比）');
{
  // 判据（与 build-data 那段各写各的）：候选全池里「这两个字在语料正文里确实挨着过」（a ≥ 1）的那部分取词，
  // 复现次数排成一个数列，取它的 90 分位 T；一条候选的名字 a ≥ T 就记 famous:true，打分 +8。
  const counts = cand
    .map((c) => adjacentCount.get(c.name) ?? 0)
    .filter((v) => v >= 1)
    .sort((a, b) => a - b);
  if (!counts.length) throw new Error('候选全池里没有一条取词在语料里挨着过，名句阈值无从重算');
  const T = counts[Math.floor(counts.length * 0.9)] ?? counts[counts.length - 1];
  const famous = cand.filter((c) => c.famous === true);
  const bad = [];
  for (const c of cand) {
    const want = (adjacentCount.get(c.name) ?? 0) >= T;
    if (!!c.famous !== want)
      bad.push(`${c.name}: a=${adjacentCount.get(c.name) ?? 0} 记 famous=${c.famous} 应为 ${want}`);
  }
  ok(
    bad.length === 0,
    `逐条 famous 与语料重算一致（重算阈值 T=${T}，有复现的取词 ${counts.length} 条，不符 ${bad.length} 条）`,
    bad.slice(0, 4).join(' | '),
  );
  // 同一个判据还管产物的形状：带 `famous` 键 ⟺ 重算该带这一分。恒假的 `famous:false` 不许进产物
  // （DESIGN.md 1.3.1「可选字段有才带」），所以这里断的是「键的有无」本身，不是「键的值」。
  const badKey = [];
  let famousKeys = 0;
  for (const c of candRaw) {
    const want = (adjacentCount.get(c.name) ?? 0) >= T;
    if ('famous' in c) famousKeys += 1;
    if ('famous' in c !== want)
      badKey.push(
        `${c.name}: a=${adjacentCount.get(c.name) ?? 0}，产物里${'famous' in c ? '带 famous 键' : '没有 famous 键'}，按重算应${want ? '带键' : '不带键'}`,
      );
  }
  ok(
    badKey.length === 0,
    `逐条 famous 键的有无与语料重算一致（${candRaw.length} 条双名里带键 ${famousKeys} 份，恒假的不落键；不符 ${badKey.length} 条）`,
    badKey.slice(0, 4).join(' | '),
  );
  const badSingles = [];
  for (const s of singles) {
    const want = (adjacentCount.get(s.from) ?? 0) >= T;
    if (!!s.famous !== want) badSingles.push(`${s.char}←${s.from}: 记 ${s.famous} 应为 ${want}`);
  }
  ok(
    badSingles.length === 0,
    `单字名的名句层继承它那条出处的判定（重算 ${singles.filter((s) => s.famous).length} / ${singles.length} 条，不符 ${badSingles.length} 条）`,
    badSingles.slice(0, 4).join(' | '),
  );
  const badKeySingles = [];
  let famousKeysSingles = 0;
  for (const s of singlesRaw) {
    const want = (adjacentCount.get(s.from) ?? 0) >= T;
    if ('famous' in s) famousKeysSingles += 1;
    if ('famous' in s !== want)
      badKeySingles.push(
        `${s.char}←${s.from}: 产物里${'famous' in s ? '带 famous 键' : '没有 famous 键'}，按重算应${want ? '带键' : '不带键'}`,
      );
  }
  ok(
    badKeySingles.length === 0,
    `单字名的 famous 键同样只落在该带分的那几条上（${singlesRaw.length} 条里带键 ${famousKeysSingles} 份；不符 ${badKeySingles.length} 条）`,
    badKeySingles.slice(0, 4).join(' | '),
  );
  // 退化闸门：阈值必须严于成词门槛（a ≥ 2），命中数必须明显多于旧判据的 58 条，也不许宽到人手一份。
  ok(T >= 3, `阈值 T=${T} 必须严于成词门槛 a ≥ 2，否则名句分与成词分是同一件事`);
  ok(famous.length > 58, `名句层 ${famous.length} 条必须多于旧判据的 58 条（旧判据实为「取词段复现 ≥ 2」）`);
  ok(famous.length <= cand.length * 0.2, `名句层不许宽到人手一份（现 ${famous.length} / ${cand.length} 条）`);
  ok(famous.length === meta.pool_famous, `名句层条数与 meta.pool_famous ${meta.pool_famous} 一致`);
  ok(
    singles.filter((s) => s.famous).length === meta.singles_famous,
    `单字名名句层条数与 meta.singles_famous ${meta.singles_famous} 一致`,
  );
  ok(T === meta.famous_threshold, `构建期记录的阈值与重算一致（meta ${meta.famous_threshold} / 重算 ${T}）`);
  const inPool = new Set(famous.map((c) => c.name));
  const spot = ['明月', '君子', '依依', '昊天'].filter((n) => !inPool.has(n));
  ok(
    spot.length === 0,
    `典籍里反复出现的词必须在名句层里（缺 ${spot.map((n) => `${n} a=${adjacentCount.get(n) ?? 0}`).join(' ') || '无'}）`,
  );
}

console.log('4h) 多出处 alternates：每个双名的全部可核对出处由 data/raw 独立重算，逐条比对产物（不是抽样）');
{
  // 重算口径（与 build-data 那份各写各的实现，谁改歪了另一份就把谁咬住）：
  //   每篇正文单独取（唐诗按「，」拼、道法按「。」拼）→ 按句读 。！？； 切句 → 每句按小句读 ，、： 切段 →
  //   去掉引号与非汉字、以「兮」为切点得到取词段 → 起点落该书音步表、与第二字间隔 1～3、
  //   跨字取词时两个取字都不许落在叠词内 → 每个（起点，间隔）就是一处可核对出处。
  // 去重键：书 · 篇名 · 作者 · 原句 · 那两个字的原句下标 · 间隔——语料里重复的文本撞不出第二处。
  // 主出处＝这些处里间隔最小的那处，同间隔取语料里先出现的那处；其余各处按 [ti, li, pa, d] 存进产物的 alt。
  const textsOf = (b) => {
    const j = JSON.parse(fs.readFileSync(`data/raw/${b}.json`, 'utf8'));
    if (b === 'lunyu') return j.flatMap((ch) => ch.paragraphs);
    if (b === 'shuimo') return j.map((po) => po.paragraphs.join('，'));
    if (b === 'song300') return j.map((po) => (po.paragraphs ?? []).join('，'));
    if (b === 'daofa') return j.map((po) => (po.content ?? []).join('。'));
    return j.map((po) => (po.content ?? []).join('，'));
  };
  const metasOf = (b) => {
    const j = JSON.parse(fs.readFileSync(`data/raw/${b}.json`, 'utf8'));
    if (b === 'lunyu') return j.flatMap((ch) => ch.paragraphs.map(() => ({ title: ch.chapter, author: '' })));
    if (b === 'song300') return j.map((po) => ({ title: po.rhythmic ?? '', author: po.author ?? '' }));
    return j.map((po) => ({ title: po.title ?? '', author: po.author ?? '' }));
  };
  const tidyV = (s) =>
    s
      .replace(/^[\s，、：；]+/, '')
      .replace(/[\s，、：；]+$/, '')
      .replace(/([：；])[\s，、：；]+/g, '$1')
      .replace(/([，、])[\s，、：；]+/g, '$1');
  const QUOTEV = new Set('“”‘’「」《》（）()');
  const cjk = (c) => c >= '一' && c <= '鿿';
  // 两张表里「主出处那一段」是完整形（原句 {s,g}、篇名六字段），「为 alternates 追加的那一段」是紧凑形
  // （原句一个字符串、篇名四元组）：读文本要认这两种形状。
  const lineText = (l) => (typeof l === 'string' ? l : l.s);
  const titleKey = (t) => (Array.isArray(t) ? `${t[0]}\u0000${t[1]}\u0000${t[2]}` : `${t.bk}\u0000${t.t}\u0000${t.au}`);
  const titleIx = new Map(SRC.titles.map((t, i) => [titleKey(t), i]));
  const lineIx = new Map(SRC.lines.map((l, i) => [lineText(l), i]));
  const occ = new Map(); // 名字 → 去重后的全部出处（按语料出现先后）
  for (const b of BOOK_KEYS) {
    const texts = textsOf(b);
    const metas = metasOf(b);
    for (let t = 0; t < texts.length; t++) {
      const { title, author } = metas[t];
      for (const part of String(texts[t]).split(/[。！？；]/)) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const line = tidyV(trimmed);
        const L = [...line];
        const chunks = [];
        let from = 0;
        for (let i = 0; i < L.length; i++) {
          if (/[，、：]/.test(L[i])) {
            chunks.push([from, i]);
            from = i + 1;
          }
        }
        chunks.push([from, L.length]);
        for (const [c0, c1] of chunks) {
          const cells = [];
          for (let i = c0; i < c1; i++) if (!QUOTEV.has(L[i]) && cjk(L[i])) cells.push({ ch: L[i], at: i });
          if (!cells.length) continue;
          const segs = [];
          let cur = [];
          for (const c of cells) {
            if (c.ch === '兮') {
              segs.push(cur);
              cur = [];
            } else cur.push(c);
          }
          segs.push(cur);
          for (const cell of segs) {
            if (cell.length < 2) continue;
            const cs = cell.map((x) => x.ch);
            const seg = cs.join('');
            const redup = (k) => (k > 0 && cs[k - 1] === cs[k]) || (k + 1 < cs.length && cs[k + 1] === cs[k]);
            for (const i of offsets(b, cs.length)) {
              for (let gap = 1; gap <= 3; gap++) {
                const j = i + gap;
                if (j >= cs.length) break;
                if (gap > 1 && (redup(i) || redup(j))) continue;
                const nm = cs[i] + cs[j];
                if (!names.has(nm)) continue;
                let bag = occ.get(nm);
                if (!bag) {
                  bag = { keys: new Set(), list: [] };
                  occ.set(nm, bag);
                }
                const k = `${b}\u0000${title}\u0000${author}\u0000${line}\u0000${cell[i].at}\u0000${cell[j].at}\u0000${gap}`;
                if (bag.keys.has(k)) continue;
                bag.keys.add(k);
                bag.list.push({ book: b, title, author, line, seg, foot: i, gap, pa: cell[i].at, pb: cell[j].at });
              }
            }
          }
        }
      }
    }
  }
  const bad = [];
  // 产物里 alt 每四个整数一条：[ti, li 差值, pa, d]（同一个名字里 li 相对上一条，第一条相对 0）
  const altQuads = (c) => {
    const a = c.alt ?? [];
    if (!Array.isArray(a) || a.length % 4 !== 0) return null;
    const out = [];
    let prev = 0;
    for (let i = 0; i < a.length; i += 4) {
      const li = prev + a[i + 1];
      prev = li;
      out.push({ ti: a[i], li, pa: a[i + 2], d: a[i + 3] });
    }
    return out;
  };
  const usedTitle = new Set();
  const usedLine = new Set();
  let altNames = 0;
  let altTotal = 0;
  let occTotal = 0;
  let altMax = 0;
  for (const c of cand) {
    usedTitle.add(c.ti);
    usedLine.add(c.li);
    const bag = occ.get(c.name);
    if (!bag || !bag.list.length) {
      bad.push(`${c.name}: 语料里重算不到任何出处`);
      continue;
    }
    const list = bag.list;
    occTotal += list.length;
    // 主出处＝间隔最小、同间隔先出现的那一处（严格更小才换）
    let main = list[0];
    for (const o of list) if (o.gap < main.gap) main = o;
    if (
      main.book !== c.book ||
      main.title !== c.title ||
      main.author !== c.author ||
      main.line !== c.line ||
      main.seg !== c.seg ||
      main.foot !== c.foot ||
      main.gap !== c.gap
    ) {
      bad.push(
        `${c.name}: 主出处与重算不符（产物 ${c.book}·${c.title}「${c.seg}」第 ${c.foot + 1} 字起 gap ${c.gap} ／ 重算 ${main.book}·${main.title}「${main.seg}」第 ${main.foot + 1} 字起 gap ${main.gap}）`,
      );
    }
    if (main.gap !== Math.min(...list.map((o) => o.gap))) bad.push(`${c.name}: 主出处不是间隔最小的那处`);
    const want = new Set();
    for (const o of list) {
      if (o === main) continue;
      const ti = titleIx.get(`${o.book}\u0000${o.title}\u0000${o.author}`);
      const li = lineIx.get(o.line);
      if (ti === undefined || li === undefined) {
        bad.push(`${c.name}: 重算出的出处不在共享表里（${o.title}「${o.line}」）`);
        continue;
      }
      want.add(`${ti}|${li}|${o.pa}|${o.pb - o.pa}`);
    }
    const got = altQuads(c);
    if (!got) {
      bad.push(`${c.name}: alt 不是 4 个一组的下标数组`);
      continue;
    }
    altTotal += got.length;
    if (got.length) altNames += 1;
    if (got.length > altMax) altMax = got.length;
    const gotSet = new Set();
    for (const q of got) {
      const title = SRC.titles[q.ti];
      const src = SRC.lines[q.li];
      if (!title || !src) {
        bad.push(`${c.name}: alternate 的共享表下标越界（ti=${q.ti} li=${q.li}）`);
        continue;
      }
      usedTitle.add(q.ti);
      usedLine.add(q.li);
      const cs = [...lineText(src)];
      if (q.d < 1 || q.pa < 0 || q.pa + q.d >= cs.length) {
        bad.push(`${c.name}: alternate 取词下标越界（${src.s} pa=${q.pa} d=${q.d}）`);
        continue;
      }
      // 抽查全部而非抽样：下标必须真指到那条原句里这两个字的这对位置
      if (cs[q.pa] !== c.name[0] || cs[q.pa + q.d] !== c.name[1])
        bad.push(
          `${c.name}: alternate 下标没指到那两个字的这对位置（「${src.s}」第 ${q.pa + 1}／${q.pa + q.d + 1} 字是 ${cs[q.pa]}${cs[q.pa + q.d]}）`,
        );
      const k = `${q.ti}|${q.li}|${q.pa}|${q.d}`;
      if (gotSet.has(k)) bad.push(`${c.name}: alt 里有重复的出处（${k}）`);
      gotSet.add(k);
    }
    if (gotSet.size !== want.size) bad.push(`${c.name}: 处数对不上（重算 ${want.size} 处／产物 ${gotSet.size} 处）`);
    for (const k of want) if (!gotSet.has(k)) bad.push(`${c.name}: 产物少了这一处 ${k}`);
    for (const k of gotSet) if (!want.has(k)) bad.push(`${c.name}: 产物多了这一处 ${k}`);
  }
  console.log(
    `   独立重算：全池 ${cand.length} 条双名共 ${occTotal} 处出处（主出处 ${cand.length} ＋ alternates ${occTotal - cand.length}）｜产物里 alt 合计 ${altTotal} 处、带 alt 的名字 ${altNames} 条、单名最多 ${altMax} 处`,
  );
  ok(
    bad.length === 0,
    `逐条比对：每条双名的「主出处＋alternates」与语料重算完全一致（不符 ${bad.length} 条）`,
    bad.slice(0, 4).join(' | '),
  );
  ok(altTotal > 0, `alternates 总数 > 0（现 ${altTotal} 处挂在 ${altNames} 条名字上）`);
  ok(
    altTotal === occTotal - cand.length,
    `alternates 总数等于独立重算的差值：重算 ${occTotal} 处 − 主出处 ${cand.length} 处 = ${occTotal - cand.length}，产物存 ${altTotal}`,
  );
  const orphanLines = SRC.lines.filter((_, i) => !usedLine.has(i)).length;
  const orphanTitles = SRC.titles.filter((_, i) => !usedTitle.has(i)).length;
  ok(
    orphanLines === 0 && orphanTitles === 0,
    `共享表里没有没人引用的条目（原句表 ${SRC.lines.length} 条／篇名表 ${SRC.titles.length} 条全部被主出处或 alternates 引用）`,
    `没人引用的原句 ${orphanLines} 条、篇名 ${orphanTitles} 篇`,
  );
  ok(
    meta.alt_total === altTotal &&
      meta.alt_names === altNames &&
      meta.alt_max === altMax &&
      meta.alt_occurrences === occTotal,
    `meta 的 alternates 计数与重算一致（meta ${meta.alt_names} 条／${meta.alt_total} 处／最多 ${meta.alt_max}，重算 ${altNames}／${altTotal}／${altMax}）——对照用，判定依据是上面那段重算`,
  );
  // 主出处用的那一段共享表必须是「从头连续的一段」：0..N-1 全被主出处引用，alternates 追加的条目一律排在它后面。
  // 这条守住的是 id 不变的前提（ti/li 不许位移），N 也钉死在 alternates 之前的实测值上。
  const mainLines = new Set([...cand, ...singles].map((c) => c.li));
  const mainTitles = new Set([...cand, ...singles].map((c) => c.ti));
  const contiguous = (set, total) =>
    set.size <= total && [...set].every((i) => i >= 0 && i < set.size) && set.size === new Set([...set]).size;
  ok(
    contiguous(mainLines, SRC.lines.length) && mainLines.size >= 1221,
    `主出处用的原句表是 0..${mainLines.size - 1} 连续一段（${mainLines.size} 条，种子版基线 1,221；为 alternates 追加的 ${SRC.lines.length - mainLines.size} 条排在它之后，下标不位移）`,
  );
  ok(
    contiguous(mainTitles, SRC.titles.length) && mainTitles.size >= 545,
    `主出处用的篇名表是 0..${mainTitles.size - 1} 连续一段（${mainTitles.size} 篇，种子版基线 545；为 alternates 追加的 ${SRC.titles.length - mainTitles.size} 篇排在它之后）`,
  );
  ok(
    meta.alt_lines_added === SRC.lines.length - mainLines.size &&
      meta.alt_titles_added === SRC.titles.length - mainTitles.size,
    `meta 记的追加条目数与实际一致（原句 ${meta.alt_lines_added} 条／篇名 ${meta.alt_titles_added} 篇）`,
  );
  // 追加的条目必须确实是紧凑形；完整形那一段必须一条没改（它守着 id 里的书码与拼音）
  const fullLine = (l) => typeof l === 'object' && l !== null && typeof l.s === 'string' && typeof l.g === 'number';
  const fullTitle = (t) =>
    typeof t === 'object' &&
    t !== null &&
    !Array.isArray(t) &&
    typeof t.code === 'string' &&
    typeof t.slug === 'string' &&
    t.slug !== '';
  const compactTitle = (t) =>
    Array.isArray(t) &&
    t.length === 4 &&
    typeof t[0] === 'string' &&
    typeof t[1] === 'string' &&
    typeof t[2] === 'string' &&
    typeof t[3] === 'boolean';
  ok(
    SRC.lines.slice(0, mainLines.size).every(fullLine) &&
      SRC.lines.slice(mainLines.size).every((l) => typeof l === 'string' || (fullLine(l) && l.g >= 0)),
    `原句表前 ${mainLines.size} 条是完整形 {s,g}（形状与 alternates 之前相同），追加的 ${SRC.lines.length - mainLines.size} 条没有今译的就只是一个字符串、有人补了今译的就是 {s, g}（紧凑形只落在追加段，老条目一条没动）`,
  );
  ok(
    SRC.titles.slice(0, mainTitles.size).every(fullTitle) && SRC.titles.slice(mainTitles.size).every(compactTitle),
    `篇名表前 ${mainTitles.size} 篇是完整形（带 id 要用的 code／slug），追加的 ${SRC.titles.length - mainTitles.size} 篇是四元组［书, 篇名, 作者, 是否名篇］（alternate 不进 id，所以不存拼音）`,
  );
  const singlesWithAlt = singles.filter((s) => 'alt' in s).length;
  ok(
    singlesWithAlt === 0,
    `单字名不挂 alternates（带 alt 的 ${singlesWithAlt} 条）：它的出处就是它那条双名出处的主出处`,
  );
  const realWithAlt = JSON.parse(fs.readFileSync(`${OUT}/realnames.json`, 'utf8')).filter((r) => 'alt' in r).length;
  ok(realWithAlt === 0, `真实人名档不挂 alternates（带 alt 的 ${realWithAlt} 条）：它没有典籍出处`);
}

console.log(
  '4i) 产物形状：恒假的可选字段一律不落键（risk:null / redup:false / famous:false 不进产物，缺键＝null／false）',
);
{
  // 口径是 DESIGN.md 1.3.1「可选字段有才带」，0.14.0 的产物没照做（1,613 个 risk:null、1,612 个 redup:false、
  // 1,567 个 famous:false）。这一节断的不是「键的值」而是「键的有无」：带键 ⟺ 那条判定为真。
  // 逐条依据各自独立：redup 照字面（叠字就是两字相同）、famous 照 4g 的重算、risk 照 4d 已核对过的词频 w（≥500）。
  const bad = [];
  const keyCount = { risk: 0, redup: 0, famous: 0 };
  const riskNames = new Set();
  for (const c of candRaw) {
    for (const k of ['risk', 'redup', 'famous']) if (k in c) keyCount[k] += 1;
    // redup：键只落在真叠字上（两字相同），非叠字一条也不许带
    if ('redup' in c !== (c.name[0] === c.name[1]))
      bad.push(`${c.name}: redup 键的有无与字面不符（带键=${'redup' in c}，字面叠字=${c.name[0] === c.name[1]}）`);
    if ('redup' in c && c.redup !== true)
      bad.push(`${c.name}: redup 存成了 ${JSON.stringify(c.redup)}，恒假就不该带这个键`);
    // risk：键只落在「与现代词同形」（词频 ≥500）那几条上，值就是那个对象，不许是 null
    if ('risk' in c) {
      const w = c.w ?? 0;
      if (c.risk === null) bad.push(`${c.name}: risk 存成了 null，没有同形风险就不该带这个键`);
      else if (!c.risk || typeof c.risk !== 'object' || c.risk.word !== c.name || c.risk.freq !== w)
        bad.push(
          `${c.name}: risk 带了这个键却不是「{word: 名字, freq: 词频}」（${JSON.stringify(c.risk)} vs 词频 ${w}）`,
        );
      else if (w < 500) bad.push(`${c.name}: 重算词频 ${w} 不到 500，不该带 risk`);
      else riskNames.add(c.name);
    }
    // famous：键的有无由 4g 逐条核对（那里有从语料重算的阈值），这里只钉「不许出现 false」
    if ('famous' in c && c.famous !== true)
      bad.push(`${c.name}: famous 存成了 ${JSON.stringify(c.famous)}，恒假就不该带这个键`);
  }
  ok(
    bad.length === 0,
    `带键＝恒真、缺键＝恒假，逐条成立（${candRaw.length} 条双名里带 risk ${keyCount.risk} 份／redup ${keyCount.redup} 份／famous ${keyCount.famous} 份；不符 ${bad.length} 处）`,
    bad.slice(0, 4).join(' | '),
  );
  // 三份恒假的键确实不再随包发：带键的份数必须明显小于条目数，并与 meta 记的判定数对上账
  ok(
    keyCount.risk === meta.same_shape.length && keyCount.redup === meta.redup && keyCount.famous === meta.pool_famous,
    `带键份数与判定数对账：risk ${keyCount.risk}＝meta.same_shape ${meta.same_shape.length}｜redup ${keyCount.redup}＝meta.redup ${meta.redup}｜famous ${keyCount.famous}＝meta.pool_famous ${meta.pool_famous}`,
  );
  const metaShape = new Set(meta.same_shape);
  const shapeDiff = [...metaShape]
    .filter((n) => !riskNames.has(n))
    .concat([...riskNames].filter((n) => !metaShape.has(n)));
  ok(
    shapeDiff.length === 0,
    `带 risk 键的名字与 meta.same_shape 逐名一致（差集 ${shapeDiff.length}：${shapeDiff.slice(0, 6).join(' ')}）`,
  );
  ok(
    keyCount.risk < candRaw.length && keyCount.redup < candRaw.length && keyCount.famous < candRaw.length,
    `恒假的三份没有一份进产物：省略 risk ${candRaw.length - keyCount.risk} 份／redup ${candRaw.length - keyCount.redup} 份／famous ${candRaw.length - keyCount.famous} 份（共 ${3 * candRaw.length - keyCount.risk - keyCount.redup - keyCount.famous} 个键）`,
  );
  // 真实人名档与单字名这一头不许被顺手改动：realnames.json 一个可选键都不带，singles.json 只在带分时带 famous
  const realKeys = JSON.parse(fs.readFileSync(`${OUT}/realnames.json`, 'utf8')).filter((r) =>
    ['risk', 'redup', 'famous'].some((k) => k in r),
  ).length;
  ok(realKeys === 0, `真实人名档不带这三个键（带键的 ${realKeys} 条）：它的 redup:false 由加载时补`);
  const singleBadKeys = singlesRaw.filter((s) => 'famous' in s && s.famous !== true).length;
  const singleRiskKeys = singlesRaw.filter((s) => ['risk', 'redup'].some((k) => k in s)).length;
  ok(
    singleBadKeys === 0 && singleRiskKeys === 0,
    `单字名产物形状不变：只在该带分时带 famous（${singlesRaw.filter((s) => 'famous' in s).length}／${singlesRaw.length} 条），不存 risk／redup（带键的 ${singleRiskKeys} 条）`,
  );
}

console.log('5) 性别风格：字表未漂移 + 强弱两级 + 真筛选不变量');
{
  const rawAttr = JSON.parse(fs.readFileSync('data/raw/cnname_attributes.json', 'utf8'));
  const dict = rawAttr.dict ?? rawAttr;
  const gt = JSON.parse(fs.readFileSync(`${OUT}/gender.json`, 'utf8'));
  const sortJ = (s) => [...s].sort().join('');
  ok(
    sortJ(gt.female) === sortJ(dict.female) && sortJ(gt.male) === sortJ(dict.male),
    `gender.json 与 cnname 属性表逐字一致（女 ${gt.female.length}／男 ${gt.male.length}）`,
  );

  const F = new Set(gt.female);
  const M = new Set(gt.male);
  // 独立重写一遍规则：与 build-data 的 genderClass 不是同一段代码，两处不一致就会在这里炸
  const cls = (name) => {
    const s = [...new Set(name)];
    const f = s.filter((c) => F.has(c));
    const m = s.filter((c) => M.has(c));
    if (!f.length && !m.length) return 'n';
    if (f.length && m.length) return 'n';
    const side = f.length ? 'f' : 'm';
    return `${side}.${f.length + m.length === s.length ? 'strong' : 'weak'}`;
  };
  const dist = {};
  for (const c of cand) dist[cls(c.name)] = (dist[cls(c.name)] ?? 0) + 1;
  ok(
    JSON.stringify(Object.fromEntries(Object.entries(dist).sort((a, b) => (a[0] < b[0] ? -1 : 1)))) ===
      JSON.stringify(meta.gender_dist),
    `强弱分布与构建期一致：${JSON.stringify(meta.gender_dist)}`,
  );
  const expectDist = { 'f.strong': 82, 'f.weak': 109, 'm.strong': 54, 'm.weak': 68, n: 150 };
  if (SEED_MODE) {
    ok(
      JSON.stringify(expectDist) === JSON.stringify(meta.gender_dist),
      `锚定实测分布 82/109/54/68/150（实际 ${JSON.stringify(meta.gender_dist)}）`,
    );
  } else {
    const f = (meta.gender_dist['f.strong'] ?? 0) + (meta.gender_dist['f.weak'] ?? 0);
    const m = (meta.gender_dist['m.strong'] ?? 0) + (meta.gender_dist['m.weak'] ?? 0);
    const ratio = Math.max(f, m) / Math.min(f, m);
    ok(
      f >= expectDist['f.strong'] + expectDist['f.weak'] &&
        m >= expectDist['m.strong'] + expectDist['m.weak'] &&
        ratio < 2,
      `扩表后仍须两侧都够挑且不失衡：女侧 ${f}、男侧 ${m}（极比 ${ratio.toFixed(2)} < 2），种子版基线 191/122（实际 ${JSON.stringify(meta.gender_dist)}）`,
    );
  }
  ok(
    Object.values(meta.gender_dist).reduce((a, b) => a + b, 0) === meta.pool_B,
    '五级标签之和恰为 Pool-B 全池，没有漏判',
  );

  // 这一段断的是**分类档位**：反向一律不属该侧；中性自成一档；同侧分「强命中」与「只靠一个字命中的疑似」。
  // 界面默认档含疑似（src/engine/name.ts 的 genderPass 不区分强弱，Controls.tsx 的「含疑似」只管标签），
  // 所以这两个数不是「界面默认候选集」，别把它读成筛选语义。
  const kept = (side, weak) =>
    cand.filter((c) => {
      const k = cls(c.name);
      if (k === 'n') return true;
      if (!k.startsWith(side)) return false;
      return k.endsWith('.strong') || weak;
    });
  for (const side of ['f', 'm']) {
    const opp = side === 'f' ? 'm' : 'f';
    const strict = kept(side, false);
    const loose = kept(side, true);
    const want = (meta.gender_dist.n ?? 0) + (meta.gender_dist[`${side}.strong`] ?? 0);
    ok(strict.length === want, `${side === 'f' ? '偏女' : '偏男'}的强命中子档 = ${want}（实际 ${strict.length}）`);
    ok(
      loose.length === want + (meta.gender_dist[`${side}.weak`] ?? 0),
      `${side === 'f' ? '偏女' : '偏男'} 强命中＋疑似两个子档之和 = ${want + (meta.gender_dist[`${side}.weak`] ?? 0)}（实际 ${loose.length}）`,
    );
    ok(
      !strict.some((c) => cls(c.name).startsWith(opp)) && !loose.some((c) => cls(c.name).startsWith(opp)),
      `${side === 'f' ? '偏女' : '偏男'} 结果里零条反向名——旧实现只加 4 分时会漏进来`,
    );
    ok(
      !strict.some((c) => cls(c.name) === `${side}.weak`),
      `${side === 'f' ? '偏女' : '偏男'} 档里只靠一个字命中的名都归疑似子档，不与强命中混成一档`,
    );
  }

  for (const w of ['尧圣', '雪松', '清洁', '燕雀', '梦金']) {
    ok(names.has(w) && cls(w).endsWith('.weak'), `${w} 属「疑似」（一票命中）子档（实际 ${cls(w)}）`);
    ok(
      !kept('f', false).some((c) => c.name === w) && !kept('m', false).some((c) => c.name === w),
      `${w} 不进任一侧的强命中子档`,
    );
  }
  for (const [w, side] of [
    ['沐芳', 'f'],
    ['婉婉', 'f'],
    ['承宇', 'm'],
    ['弘毅', 'm'],
  ]) {
    ok(cls(w) === `${side}.strong`, `${w} 为强命中（实际 ${cls(w)}）`);
    ok(
      kept(side, false).some((c) => c.name === w),
      `${w} 在${side === 'f' ? '偏女' : '偏男'}默认候选里`,
    );
  }
  for (const w of ['凤翔', '佩龙', '华英']) {
    ok(cls(w) === 'n', `${w} 两侧都有字 → 中性，不该被定性（实际 ${cls(w)}）`);
    ok(
      kept('f', false).some((c) => c.name === w) && kept('m', false).some((c) => c.name === w),
      `${w} 在两种筛选下都保留`,
    );
  }
  ok(
    !cand.some((c) => 'gender' in c) && !singles.some((s) => 'gender' in s),
    '数据里不再有 gender 字段：标签只由运行期从字表算出，杜绝两处实现漂移（旧的单字名还继承配对词的标签）',
  );
}

console.log('6) 部首提示：由 raw 独立重算，且只是提示、不进筛选与打分');
{
  const EL = { 32: '土', 75: '木', 85: '水', 86: '火', 167: '金' };
  const krs = new Map();
  for (const line of fs.readFileSync('data/raw/unihan_krs_gsc.txt', 'utf8').split('\n')) {
    const [ch, r] = line.split('\t');
    if (ch && /^\d+$/.test((r ?? '').trim())) krs.set(ch, Number(r.trim()));
  }
  ok(krs.size === 8105, `raw 部首表覆盖 8,105 字（实际 ${krs.size}）`);
  const radical = JSON.parse(fs.readFileSync(`${OUT}/radical.json`, 'utf8'));
  const seen = new Set();
  for (const c of cand) for (const ch of c.name) seen.add(ch);
  for (const s of singles) seen.add(s.char);
  const expectMap = {};
  for (const ch of [...seen].sort()) if (EL[krs.get(ch)]) expectMap[ch] = EL[krs.get(ch)];
  ok(
    JSON.stringify(radical) === JSON.stringify(expectMap),
    `radical.json 与 raw 重算逐键一致（${Object.keys(expectMap).length} 字）`,
    JSON.stringify(radical) === JSON.stringify(expectMap)
      ? ''
      : `${Object.keys(radical).join('')} vs ${Object.keys(expectMap).join('')}`,
  );
  const bad = Object.entries(radical).filter(([ch, el]) => !L0.has(ch) || !'木火水金土'.includes(el));
  ok(bad.length === 0, '标注的字都在 L0 内、值只在五部之内', bad.map(([c, e]) => `${c}:${e}`).join(' '));
  ok(
    meta.radical_chars === Object.keys(radical).length,
    `meta.radical_chars = ${Object.keys(radical).length}（实际 ${meta.radical_chars}）`,
  );
  const named = cand.filter((c) => [...c.name].some((ch) => radical[ch])).length;
  ok(
    meta.radical_named === named,
    `meta.radical_named = ${named}/${cand.length} 条双名至少一字可标（实际 ${meta.radical_named}）`,
  );
  const dist = Object.entries(Object.values(radical).reduce((o, v) => ({ ...o, [v]: (o[v] ?? 0) + 1 }), {})).sort(
    (a, b) => (a[0] < b[0] ? -1 : 1),
  );
  ok(
    JSON.stringify(meta.radical_dist) === JSON.stringify(Object.fromEntries(dist)),
    `meta.radical_dist 与重算分布一致（${JSON.stringify(meta.radical_dist)}）`,
  );
  for (const [ch, el] of [
    ['松', '木'],
    ['沐', '水'],
    ['炎', '火'],
    ['金', '金'],
    ['城', '土'],
  ]) {
    ok(radical[ch] === el, `${ch} 的部首是${el}部`);
  }
  // 反向用例：这四字分属心/人/心/女部，规则写过头把它们也标上就会在这里失败
  for (const ch of ['思', '佩', '悦', '婉']) ok(!(ch in radical), `${ch} 必须留白（不属于 木火水金土 五部）`);
  ok(!cand.some((c) => JSON.stringify(c.score).includes('部首')), '部首不进打分：候选分数里没有部首这一项');
}

console.log(fails ? `\nFAILURES: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
