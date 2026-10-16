// P0 验收：确定性 + 四元组断言 + 结构不变量 + 性别口径。任何一条不过就 exit 1，构建脚本随之失败。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { NAME_NOISE } from './name-noise.mjs';

const OUT = 'src/data';
let fails = 0;
const ok = (cond, msg, extra) => { if (cond) console.log('  PASS', msg); else { fails++; console.log('  FAIL', msg, extra ?? ''); } };

const hash = () => Object.fromEntries(fs.readdirSync(OUT).sort().map((f) => [f, createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex').slice(0, 12)]));

console.log('0) 输入指纹：data/raw 必须与 SHA256SUMS 一致，否则实测数字不可复现');
{
  const RAW = 'data/raw';
  const lines = fs.readFileSync(`${RAW}/SHA256SUMS`, 'utf8').trim().split('\n');
  const expected = new Map(lines.map((l) => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
  const present = new Set(fs.readdirSync(RAW).filter((f) => !['SHA256SUMS', 'LICENSES.md', 'l0-verdicts.txt', 'licenses'].includes(f)));
  const bad = [];
  for (const [f, h] of expected) {
    if (!present.has(f)) { bad.push(`${f} 缺失`); continue; }
    const got = createHash('sha256').update(fs.readFileSync(path.join(RAW, f))).digest('hex');
    if (got !== h) bad.push(`${f} 字节已变`);
  }
  for (const f of present) if (!expected.has(f)) bad.push(`${f} 未登记`);
  ok(bad.length === 0 && expected.size === present.size, `raw ${expected.size} 个输入文件指纹全部匹配`, bad.join('；'));
  // 人工判定文本不进上游指纹（它是判定结果不是外部语料），改用 meta 里记录的指纹核对，防止「表改了没重建」
  if (fs.existsSync(`${RAW}/l0-verdicts.txt`)) {
    const built = JSON.parse(fs.readFileSync(`${OUT}/meta.json`, 'utf8'));
    const got = createHash('sha256').update(fs.readFileSync(`${RAW}/l0-verdicts.txt`)).digest('hex').slice(0, 16);
    ok(got === built.L0_verdicts_sha256, `判定文本与构建时一致（现 ${got} / 构建记录 ${built.L0_verdicts_sha256}）`,
      '表已改动但没重跑 build:data，src/data 不是当前判定的产物');
  }
}

console.log('1) 确定性：连跑两次 build:data，产物哈希必须一致');
execFileSync('node', ['scripts/build-data.mjs'], { stdio: 'pipe' });
const h1 = hash();
execFileSync('node', ['scripts/build-data.mjs'], { stdio: 'pipe' });
const h2 = hash();
ok(JSON.stringify(h1) === JSON.stringify(h2), '两次构建字节一致', JSON.stringify(h1) === JSON.stringify(h2) ? '' : `${h1} vs ${h2}`);

const meta = JSON.parse(fs.readFileSync(`${OUT}/meta.json`, 'utf8'));
const L0 = new Set(JSON.parse(fs.readFileSync(`${OUT}/whitelist-L0.json`, 'utf8')));
const risk = JSON.parse(fs.readFileSync(`${OUT}/risk.json`, 'utf8'));
const cand = JSON.parse(fs.readFileSync(`${OUT}/candidates.json`, 'utf8'));
const singles = JSON.parse(fs.readFileSync(`${OUT}/singles.json`, 'utf8'));
const names = new Set(cand.map((c) => c.name));

console.log('2) 实测规模（口径：起点落音步、同句读内间隔≤3、排除叠词粘连、六本典籍）');
// 种子版（没有人工判定）时，下面每个数都精确钉死；一旦人工判定扩表，同样的检查换成「只增不减」的下界，
// 外加结构恒等式（按书之和＝全池＝按间隔之和）——扩表不许让任何一条老名字消失，也不许让数字对不上账。
const SEED_MODE = !meta.L0_added;
const floorGate = (label, actual, seed) => ok(SEED_MODE ? actual === seed : actual >= seed,
  `${label}：种子版要求恰为 ${seed}${SEED_MODE ? '' : `，扩表版要求 ≥${seed}`}，实际 ${actual}`);
{
  const seedPool = { pool_B: 463, gap1: 217, gap2: 149, gap3: 97, redup: 30,
    per_book: { shijing: 58, chuci: 112, lunyu: 26, shuimo: 34, song300: 199, daofa: 34 } };
  floorGate('Pool-B', meta.pool_B, seedPool.pool_B);
  for (const g of ['gap1', 'gap2', 'gap3']) floorGate(`间隔分布 ${g}`, meta.by_gap[g], seedPool[g]);
  ok(Object.values(meta.by_gap).reduce((a, b) => a + b, 0) === meta.pool_B,
    `按间隔之和＝全池（${JSON.stringify(meta.by_gap)} vs ${meta.pool_B}）`);
  for (const [b, n] of Object.entries(seedPool.per_book)) floorGate(`按书 ${b}`, meta.per_book[b], n);
  ok(Object.values(meta.per_book).reduce((a, b) => a + b, 0) === meta.pool_B,
    `按书之和＝全池（${JSON.stringify(meta.per_book)} vs ${meta.pool_B}）`);
  floorGate('叠字', meta.redup, seedPool.redup);
  const repSeed = ['克克', '思思', '德德', '雪雪', '心心'];
  ok(SEED_MODE ? JSON.stringify(meta.removed_repeat) === JSON.stringify(repSeed)
    : repSeed.every((p) => meta.removed_repeat.includes(p)) && !repSeed.some((p) => names.has(p)),
    `假叠字（同字跨位重复）${SEED_MODE ? '恰为 ' + repSeed.join('/') : '仍全部被剔除：' + repSeed.join('/')}（实际剔除 ${meta.removed_repeat.length} 条）`);
  ok(meta.L0_size === meta.L0_seed + meta.L0_added,
    `白名单账目自洽：${meta.L0_size}＝种子 ${meta.L0_seed}＋人工 ${meta.L0_added}`);
  ok(!!meta.L0_verdicts_sha256 === (meta.L0_added > 0),
    `扩表必须带判定文本指纹（L0_added=${meta.L0_added}，sha=${meta.L0_verdicts_sha256}）`);
  console.log(`   白名单：${meta.L0_size} 字（${meta.L0_added ? '种子 ' + meta.L0_seed + '＋人工保留 ' + meta.L0_added + '，剔除 ' + meta.L0_dropped + '，判定 ' + meta.L0_verdicts_sha256 : '仅种子，未扩表'}）`);
}
const segs = Object.values(meta.units_by_book).reduce((a, b) => a + b.segs, 0);
const chs = Object.values(meta.units_by_book).reduce((a, b) => a + b.chars, 0);
ok(segs === 22704 && chs === 99671, `取词段 22,704 / 99,671 字（实际 ${segs} / ${chs}）`);
// 第 6 本是「逐条收录」的 curated 语料（22 条句读行），它只该新增、不该改写老池；唯一的出处改判是天清。
{
  const nonDf = cand.filter((c) => c.book !== 'daofa');
  const tq = cand.find((c) => c.name === '天清');
  ok(nonDf.length >= 429 && tq?.book === 'daofa' && tq?.gap === 1 && tq?.title === '清静经',
    `加书不动老池：五书侧 ${nonDf.length} 条（种子版基线 429＝原 430 减唯一改判 天清→清静经 gap 3→1），天清实际挂 ${tq?.book}·${tq?.title} gap ${tq?.gap}`);
  ok(meta.units_by_book.daofa.segs === 68 && meta.units_by_book.daofa.chars === 321,
    `道法语料规模锁定 68 段 / 321 字（实际 ${meta.units_by_book.daofa.segs} / ${meta.units_by_book.daofa.chars}）——curated 语料不许悄悄变胖`);
}

console.log('3) 四元组断言：名字 + 出处原句 + 音步下标 + 间隔，缺一即无效');
const expect = (name, book, title, seg, foot, gap) => {
  const hit = cand.filter((c) => c.name === name);
  if (hit.length !== 1) { ok(false, `${name} 唯一（实际 ${hit.length} 条）`); return; }
  const r = hit[0];
  ok(r.book === book && r.title === title && r.seg === seg && r.foot === foot && r.gap === gap,
    `${name} = ${book}·${title}「${seg}」第 ${foot + 1} 字起、间隔 ${gap}`,
    `实际 ${r.book}·${r.title}「${r.seg}」foot=${r.foot} gap=${r.gap}`);
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
// 道法是「逐条收录」的 curated 语料：下面这些配对只有整本 vendoring 才会出现。它们不在池＝语料没被换成 scraped 全本。
for (const w of ['锐可', '智慧', '圣智', '可天', '可渊', '义克', '义宾', '鼎金', '威天', '腾紫', '可圣', '静基', '志可', '志光', '心天', '天柔', '祥天', '强天', '圣天', '柔丽', '龙天', '龙野', '美天', '承德', '心语', '天泽', '震龙', '坤天', '震坤', '坤震', '震天', '坤泽', '鼎鼎']) ok(!names.has(w), `整本才会出现的道法噪声不在池：${w}`);
for (const w of ['思柔', '清馨', '承宇', '淑清', '玄鹤', '白露', '昭华', '弘毅']) ok(names.has(w), `名篇词在池：${w}`);
for (const w of NAME_NOISE) ok(!names.has(w), `现代成词不在池（构建期删除，与白名单规模无关）：${w}`);
for (const w of ['心心', '德德']) ok(!names.has(w), `假叠字不在池（规则见 removed_repeat）：${w}`);
if (SEED_MODE) for (const w of ['静姝', '各敬', '同僚', '苟无', '那堪']) ok(!names.has(w), `种子版字表下不产这些配对：${w}`);
for (const w of ['欣美', '皓白', '翔翼', '龙婉', '浩天', '英白', '青佩', '青柳']) ok(!names.has(w), `叠词粘连不在池：${w}`);
ok(names.has('雪天'), '雪天（年年移帐雪中天，两字都不在叠词内）仍须收录——防剔除规则写过头');

console.log('4) 结构不变量（全池）');
const offsets = (book, n) => {
  if (book === 'shijing' || book === 'shuimo') return ({ 4: [0, 2], 5: [0, 2], 7: [0, 2, 4] })[n] ?? [...Array(n - 1).keys()];
  if (book === 'chuci') return ({ 4: [0, 2], 5: [0, 3], 7: [0, 2, 4] })[n] ?? [...Array(n - 1).keys()];
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
  if (c.gap > 1 && (segCharsArr[c.foot - 1] === segCharsArr[c.foot] || segCharsArr[c.foot + 1] === segCharsArr[c.foot]
    || segCharsArr[c.foot + c.gap - 1] === segCharsArr[c.foot + c.gap] || segCharsArr[c.foot + c.gap + 1] === segCharsArr[c.foot + c.gap])) {
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
const sameShape = cand.filter((c) => c.risk).map((c) => c.name).sort();
const sameShapeSet = new Set(sameShape);
const seedShape = ['东城', '东海', '可可', '清华', '清洁', '白雪', '青海', '青青'];
ok(seedShape.every((p) => sameShapeSet.has(p)),
  `同形标注：种子版那 8 条仍在表内并带 risk（实际全池标注 ${sameShape.length} 条：${sameShape.join(' ')}）`);
const poolCharsSeen = new Set(cand.flatMap((c) => c.chars));
ok(singles.length === [...L0].filter((ch) => poolCharsSeen.has(ch)).length && singles.length + meta.singles_without_source === L0.size,
  `单字名＝白名单里有对齐出处的字 ${singles.length} 个（白名单 ${L0.size}，无出处 ${meta.singles_without_source}）`);

console.log('5) 性别风格：字表未漂移 + 强弱两级 + 真筛选不变量');
{
  const rawAttr = JSON.parse(fs.readFileSync('data/raw/cnname_attributes.json', 'utf8'));
  const dict = rawAttr.dict ?? rawAttr;
  const gt = JSON.parse(fs.readFileSync(`${OUT}/gender.json`, 'utf8'));
  const sortJ = (s) => [...s].sort().join('');
  ok(sortJ(gt.female) === sortJ(dict.female) && sortJ(gt.male) === sortJ(dict.male),
    `gender.json 与 cnname 属性表逐字一致（女 ${gt.female.length}／男 ${gt.male.length}）`);

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
  ok(JSON.stringify(Object.fromEntries(Object.entries(dist).sort((a, b) => a[0] < b[0] ? -1 : 1))) === JSON.stringify(meta.gender_dist),
    `强弱分布与构建期一致：${JSON.stringify(meta.gender_dist)}`);
  const expectDist = { 'f.strong': 82, 'f.weak': 109, 'm.strong': 54, 'm.weak': 68, n: 150 };
  if (SEED_MODE) {
    ok(JSON.stringify(expectDist) === JSON.stringify(meta.gender_dist),
      `锚定实测分布 82/109/54/68/150（实际 ${JSON.stringify(meta.gender_dist)}）`);
  } else {
    const f = (meta.gender_dist['f.strong'] ?? 0) + (meta.gender_dist['f.weak'] ?? 0);
    const m = (meta.gender_dist['m.strong'] ?? 0) + (meta.gender_dist['m.weak'] ?? 0);
    const ratio = Math.max(f, m) / Math.min(f, m);
    ok(f >= expectDist['f.strong'] + expectDist['f.weak'] && m >= expectDist['m.strong'] + expectDist['m.weak'] && ratio < 2,
      `扩表后仍须两侧都够挑且不失衡：女侧 ${f}、男侧 ${m}（极比 ${ratio.toFixed(2)} < 2），种子版基线 191/122（实际 ${JSON.stringify(meta.gender_dist)}）`);
  }
  ok(Object.values(meta.gender_dist).reduce((a, b) => a + b, 0) === meta.pool_B, '五级标签之和恰为 Pool-B 全池，没有漏判');

  // 筛选语义：反向一律排除；中性保留；同侧弱命中默认排除（勾「含疑似」才进）
  const kept = (side, weak) => cand.filter((c) => {
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
    ok(strict.length === want, `${side === 'f' ? '偏女' : '偏男'}（不含疑似）候选 = ${want}（实际 ${strict.length}）`);
    ok(loose.length === want + (meta.gender_dist[`${side}.weak`] ?? 0),
      `${side === 'f' ? '偏女' : '偏男'} 勾含疑似后 = ${want + (meta.gender_dist[`${side}.weak`] ?? 0)}（实际 ${loose.length}）`);
    ok(!strict.some((c) => cls(c.name).startsWith(opp)) && !loose.some((c) => cls(c.name).startsWith(opp)),
      `${side === 'f' ? '偏女' : '偏男'} 结果里零条反向名——旧实现只加 4 分时会漏进来`);
    ok(!strict.some((c) => cls(c.name) === `${side}.weak`), `${side === 'f' ? '偏女' : '偏男'} 默认不含只靠一个字命中的名`);
  }

  for (const w of ['尧圣', '雪松', '清洁', '燕雀', '梦金']) {
    ok(names.has(w) && cls(w).endsWith('.weak'), `${w} 属「疑似」（一票命中），默认筛选必须挡掉（实际 ${cls(w)}）`);
    ok(!kept('f', false).some((c) => c.name === w) && !kept('m', false).some((c) => c.name === w), `${w} 不在任一侧的默认候选里`);
  }
  for (const [w, side] of [['沐芳', 'f'], ['婉婉', 'f'], ['承宇', 'm'], ['弘毅', 'm']]) {
    ok(cls(w) === `${side}.strong`, `${w} 为强命中（实际 ${cls(w)}）`);
    ok(kept(side, false).some((c) => c.name === w), `${w} 在${side === 'f' ? '偏女' : '偏男'}默认候选里`);
  }
  for (const w of ['凤翔', '佩龙', '华英']) {
    ok(cls(w) === 'n', `${w} 两侧都有字 → 中性，不该被定性（实际 ${cls(w)}）`);
    ok(kept('f', false).some((c) => c.name === w) && kept('m', false).some((c) => c.name === w), `${w} 在两种筛选下都保留`);
  }
  ok(!cand.some((c) => 'gender' in c) && !singles.some((s) => 'gender' in s),
    '数据里不再有 gender 字段：标签只由运行期从字表算出，杜绝两处实现漂移（旧的单字名还继承配对词的标签）');
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
  for (const c of cand) for (const ch of c.chars) seen.add(ch);
  for (const s of singles) seen.add(s.char);
  const expectMap = {};
  for (const ch of [...seen].sort()) if (EL[krs.get(ch)]) expectMap[ch] = EL[krs.get(ch)];
  ok(JSON.stringify(radical) === JSON.stringify(expectMap),
    `radical.json 与 raw 重算逐键一致（${Object.keys(expectMap).length} 字）`, JSON.stringify(radical) === JSON.stringify(expectMap) ? '' : `${Object.keys(radical).join('')} vs ${Object.keys(expectMap).join('')}`);
  const bad = Object.entries(radical).filter(([ch, el]) => !L0.has(ch) || !'木火水金土'.includes(el));
  ok(bad.length === 0, '标注的字都在 L0 内、值只在五部之内', bad.map(([c, e]) => `${c}:${e}`).join(' '));
  ok(meta.radical_chars === Object.keys(radical).length, `meta.radical_chars = ${Object.keys(radical).length}（实际 ${meta.radical_chars}）`);
  const named = cand.filter((c) => c.chars.some((ch) => radical[ch])).length;
  ok(meta.radical_named === named, `meta.radical_named = ${named}/${cand.length} 条双名至少一字可标（实际 ${meta.radical_named}）`);
  const dist = Object.entries(Object.values(radical).reduce((o, v) => ({ ...o, [v]: (o[v] ?? 0) + 1 }), {})).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  ok(JSON.stringify(meta.radical_dist) === JSON.stringify(Object.fromEntries(dist)),
    `meta.radical_dist 与重算分布一致（${JSON.stringify(meta.radical_dist)}）`);
  for (const [ch, el] of [['松', '木'], ['沐', '水'], ['炎', '火'], ['金', '金'], ['城', '土']]) {
    ok(radical[ch] === el, `${ch} 的部首是${el}部`);
  }
  // 反向用例：这四字分属心/人/心/女部，规则写过头把它们也标上就会在这里失败
  for (const ch of ['思', '佩', '悦', '婉']) ok(!(ch in radical), `${ch} 必须留白（不属于 木火水金土 五部）`);
  ok(!cand.some((c) => JSON.stringify(c.score).includes('部首')), '部首不进打分：候选分数里没有部首这一项');
}

console.log(fails ? `\nFAILURES: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
