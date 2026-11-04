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
  };
}
const cand = JSON.parse(fs.readFileSync(`${OUT}/candidates.json`, 'utf8')).map((c) => expandItem(c, ''));
const singles = JSON.parse(fs.readFileSync(`${OUT}/singles.json`, 'utf8')).map((c) => expandItem(c, 'S_'));
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
  ok(rawGloss.size === 1140, `raw 今译 ${rawGloss.size} 行`);
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
  const unused = [...rawGloss.keys()].filter((src) => !byLine.has(src));
  ok(
    unused.length === 0,
    `raw 今译没有闲置条目（闲置 ${unused.length} 条：写了译文的句子必须真被候选用到）`,
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

console.log('4d) 成词证据：a / w / spl 由 data/raw 与 jieba 词典独立重算核对（默认只给成词层的名字）');
{
  const books = ['shijing', 'chuci', 'lunyu', 'shuimo', 'song300', 'daofa', 'yuefu'];
  const adj = new Map();
  for (const b of books) {
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
  const jieba = new Map();
  for (const line of fs.readFileSync('data/raw/jieba_dict.txt', 'utf8').split('\n')) {
    const p = line.split(' ');
    if (p.length >= 3) jieba.set(p[0], Number(p[1]));
  }
  const badA = [];
  const badW = [];
  const badSpl = [];
  for (const c of cand) {
    const a = adj.get(c.name) ?? 0;
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
