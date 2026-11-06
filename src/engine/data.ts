import candidatesJson from '../data/candidates.json';
import singlesJson from '../data/singles.json';
import realNamesJson from '../data/realnames.json';
import charsJson from '../data/chars.json';
import whitelistJson from '../data/whitelist-L0.json';
import sourcesJson from '../data/sources.json';
import homophoneJson from '../data/homophone.json';
import riskJson from '../data/risk.json';
import genderJson from '../data/gender.json';
import radicalJson from '../data/radical.json';
import glossJson from '../data/gloss.json';
import lineGlossJson from '../data/line_gloss.json';
import metaJson from '../data/meta.json';
import {
  BOOK_ORDER,
  type AltRef,
  type Book,
  type CharInfo,
  type Homophone,
  type PoolItem,
  type RealItem,
  type SingleItem,
} from './types';
import { markSyllable } from './tone';

// 构建产物是 JSON，TypeScript 只能 `as` 断言；这里在加载时做一遍结构自检，
// 让数据出错时在启动阶段大声失败（而不是在使用时变成 undefined 的静默 bug）。
function fail(what: string): never {
  throw new Error(`数据自检失败：${what}`);
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number';
const isArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : fail('期望数组'));

const BOOKS = new Set<string>(BOOK_ORDER);

// 白名单与带调写法都不进 chars.json：前者是 whitelist-L0.json 那一份名单，后者是 py + t 的纯函数
// （见 src/engine/tone.ts）。两处都由这里合成，界面上拿到的形状和以前一样。
const L0_CHARS = new Set(
  Array.isArray(whitelistJson) && whitelistJson.every(isStr) ? whitelistJson : fail('whitelist-L0 不是字符串数组'),
);

// 产物里不存 chars：双名条目的 chars 恒等于 name 拆字，1,525 条存下来要多花 7,951 B gzip
// （实测同一份数据，删掉这个字段 91,428 → 83,478 B）。加载时由 name 展开，运行时的 PoolItem
// 形状不变，取词、打分、界面都不用改。自检仍然逐条校验 name 是两个字——存不出 chars 不等于
// 可以少一个校验：字数的口径在这里守着。
// 共享表：原句、篇名（含 id 里的书码与拼音）、今译下标。产物里每条候选只存下标。
// 0.14.0 起，「只为 alternates 新建的条目」用紧凑形（主出处那一段一条没动，字节与下标都不位移）：
//   原句 → 一个字符串。带今译的句子必然已被某条主出处用到，所以追加段里的句子一律没有今译。
//   篇名 → [书, 篇名, 作者, 是否名篇]。alternate 不参与 id 重建，所以不存 code／slug。
type SourceTitle = { bk: string; code: string; t: string; au: string; slug: string; st: boolean };
type SourceLine = { s: string; g: number };
function asSources(v: unknown): {
  titles: SourceTitle[];
  lines: SourceLine[];
  compactTitles: Set<number>;
  compactLines: Set<number>;
} {
  if (!isObj(v) || !Array.isArray(v.titles) || !Array.isArray(v.lines)) fail('sources 不是 { titles, lines }');
  const compactTitles = new Set<number>();
  const compactLines = new Set<number>();
  const titles = v.titles.map((x, i) => {
    if (Array.isArray(x)) {
      compactTitles.add(i);
      if (
        x.length !== 4 ||
        !isStr(x[0]) ||
        !BOOKS.has(x[0]) ||
        !isStr(x[1]) ||
        !x[1] ||
        !isStr(x[2]) ||
        typeof x[3] !== 'boolean'
      )
        fail(`sources.titles[${i}] 是紧凑形篇名但形状不对（期望 [书, 篇名, 作者, 是否名篇]）`);
      return { bk: x[0], code: x[0], t: x[1], au: x[2], slug: '', st: x[3] };
    }
    if (
      !isObj(x) ||
      !isStr(x.bk) ||
      !BOOKS.has(x.bk) ||
      !isStr(x.code) ||
      !isStr(x.t) ||
      !isStr(x.au) ||
      !isStr(x.slug) ||
      typeof x.st !== 'boolean'
    )
      fail(`sources.titles[${i}] 结构不符`);
    return x as unknown as SourceTitle;
  });
  const lines = v.lines.map((x, i) => {
    if (isStr(x)) {
      compactLines.add(i);
      return { s: x, g: -1 };
    }
    if (!isObj(x) || !isStr(x.s) || !isNum(x.g)) fail(`sources.lines[${i}] 结构不符`);
    return x as unknown as SourceLine;
  });
  if (!titles.length || !lines.length) fail('sources 表是空的');
  return { titles, lines, compactTitles, compactLines };
}
const SOURCES = asSources(sourcesJson);

// 取词段在产物里是「起始下标 + 长度」（拆词那几条不是连续子串，原样存 sg）
const segOf = (line: string, it: Record<string, unknown>, where: string): string => {
  const so = it.so;
  const sn = it.sn;
  if (!isNum(so) || !isNum(sn)) fail(`${where} 缺少取词段位置`);
  if (so === -1) {
    if (!isStr(it.sg)) fail(`${where} 的取词段不是连续子串却没存原文`);
    return it.sg;
  }
  if (so < 0 || sn < 1 || so + sn > line.length) fail(`${where} 的取词段下标越界`);
  return line.slice(so, so + sn);
};

// id 不在产物里存整串，由 层＋书码＋篇名拼音＋名字拼音＋序号 逐字重建：
// 收藏、拉黑、分享链接里那些 id 因此一个都没变。
const idOf = (title: SourceTitle, ns: string, sq: number, prefix = ''): string =>
  `${prefix}B${title.code}_${title.slug}_${ns}_${String(sq).padStart(3, '0')}`;

// 多出处（alternates）：产物里每条候选的 `alt` 是扁平整数数组，每 4 个数一条 [ti, li, pa, d]——
// 篇名下标、原句下标、取词首字在那条原句里的下标、两个取字在原句里的距离；
// 同一个名字里 `li` 存的是相对上一条的差值（第一条相对 0），加载时逐条累加还原。
// 原句与篇名原文一条都不重复存。加载期逐条咬死：下标必须存在、必须不越界、必须真指到那两个字的
// 这对位置（line[pa] 与 line[pa+d] 就是这个名字的两个字）。形状或位置不对就在这里炸，不等到界面上变成 undefined。
// 「这一处真的属于那一篇」这件事产物自己证不了（原句表按文本去重，同一句文本可以被多篇共用），
// 由构建门禁 scripts/verify.mjs 4h 从 data/raw 独立重算逐条核对。
function asAlts(name: string, v: unknown, where: string): AltRef[] {
  if (!Array.isArray(v)) fail(`${where} 的 alt 不是数组`);
  if (v.length % 4 !== 0) fail(`${where} 的 alt 长度不是 4 的倍数（每条出处四个下标）`);
  const chars = [...name];
  const out: AltRef[] = [];
  const seen = new Set<number>();
  let prevLi = 0;
  for (let i = 0; i < v.length; i += 4) {
    const [ti, liDelta, pa, d] = v.slice(i, i + 4) as unknown[];
    if (![ti, liDelta, pa, d].every((x) => Number.isInteger(x)))
      fail(`${where} 的 alt 里有不是整数的下标（第 ${i / 4 + 1} 条）`);
    const li = prevLi + (liDelta as number);
    prevLi = li;
    if (li < 0 || li >= SOURCES.lines.length) fail(`${where} 的 alternate 原句下标越界（li=${li}）`);
    const title = SOURCES.titles[ti as number];
    const src = SOURCES.lines[li];
    if (!title || !src) fail(`${where} 的 alternate 共享表下标越界（ti=${ti} li=${li}）`);
    const at = pa as number;
    const at2 = at + (d as number);
    // 与构建期同口径：按码点数位置（语料全在 BMP 内，两种口径实测一致，但只认一种才不会再分叉）
    const cs = [...src.s];
    if ((d as number) < 1 || at < 0 || at2 >= cs.length) fail(`${where} 的 alternate 取词下标越界（pa=${at} d=${d}）`);
    if (cs[at] !== chars[0] || cs[at2] !== chars[1])
      fail(
        `${where} 的 alternate 下标没指到那两个字的这对位置：「${src.s}」第 ${at + 1}／${at2 + 1} 字是 ${cs[at]}${cs[at2]}`,
      );
    const key = (ti as number) * 1_000_003 + li * 1009 + at * 7 + (d as number);
    if (seen.has(key)) fail(`${where} 的 alt 里有重复的出处（ti=${ti} li=${li} pa=${at} d=${d}）`);
    seen.add(key);
    out.push({
      ti: ti as number,
      li,
      book: title.bk as Book,
      title: title.t,
      author: title.au,
      strict: title.st,
      line: src.s,
      at,
      at2,
      win: cs.slice(at, at2 + 1).join(''),
      lg: src.g,
    });
  }
  return out;
}

// 可选字段有才带（DESIGN.md 1.3.1）：产物里 `redup`／`famous` 只带 `true`，`risk` 只带那个对象。
// 缺键就是 false／null —— 这不是「放松校验」，而是换一条更强的校验：恒假的键不许进产物，
// 出现了（`redup:false`、`famous:false`、`risk:null`）就地炸，因为它说明构建脚本与声明的口径分叉了。
// 运行时形状因此与改动前逐字段相同：界面对 redup／famous 读真值、对 risk 读 null，不用改读法。
function trueFlag(v: unknown, key: string, where: string): boolean {
  if (v === undefined) return false;
  if (v !== true) fail(`${where} 的 ${key} 存成了 ${JSON.stringify(v)}：恒假就不该带这个键（缺键＝false）`);
  return true;
}
function riskOf(v: unknown, where: string): PoolItem['risk'] {
  if (v === undefined) return null;
  if (!isObj(v) || !isStr(v.word) || !isNum(v.freq))
    fail(`${where} 的 risk 存成了 ${JSON.stringify(v)}：没有同形风险就不该带这个键（缺键＝null）`);
  return { word: v.word, freq: v.freq };
}

function asPool(v: unknown, what: string): PoolItem[] {
  const out: PoolItem[] = [];
  for (const it of isArr(v)) {
    if (
      !isObj(it) ||
      !isStr(it.name) ||
      [...it.name].length !== 2 ||
      // 用字口径不许被产物绕过：白名单没批过的字不许进候选池（以前只有真实人名档守这一条）
      ![...it.name].every((ch) => L0_CHARS.has(ch)) ||
      !isNum(it.ti) ||
      !isNum(it.li) ||
      !isStr(it.ns) ||
      !isNum(it.sq) ||
      !isNum(it.foot) ||
      !isNum(it.gap) ||
      !isNum(it.score) ||
      // 恒假的可选字段不许进产物（见下面 trueFlag／riskOf）：出现了就是构建脚本没照 1.3.1 的口径写
      ('redup' in it && it.redup !== true) ||
      ('famous' in it && it.famous !== true) ||
      ('risk' in it && !isObj(it.risk)) ||
      ['id', 'chars', 'book', 'title', 'author', 'line', 'seg', 'tier', 'strict', 'lg', 'alts'].some((k) => k in it)
    ) {
      fail(`${what} 有结构不符的条目（可共享或可推导的字段不许直接存；恒假的可选字段不许存）`);
    }
    const title = SOURCES.titles[it.ti];
    const line = SOURCES.lines[it.li];
    if (!title || !line) fail(`${what} 里的「${it.name}」共享表下标越界`);
    // 主出处必须落在两张表的「完整形」那一段：紧凑形条目只为 alternates 存在，篇名没有 slug（进不了 id）
    if (SOURCES.compactTitles.has(it.ti) || SOURCES.compactLines.has(it.li))
      fail(`${what} 里的「${it.name}」主出处指到了只为 alternates 追加的紧凑形条目上`);
    const text = line.s;
    const where = `${what} 里的「${it.name}」`;
    const alts = it.alt === undefined ? undefined : asAlts(it.name, it.alt, where);
    // 产物里的 `alt` 是编码，运行时只留展开后的 `alts`：把下标数组原样带进内存会让卡片与导出读到没校验过的数
    const rest = { ...(it as unknown as Record<string, unknown>) };
    delete rest.alt;
    // 这三个键在产物里是「有才带」的稀疏形状，运行时必须是完整形状（界面上的 `??` 与打分都按它读）
    for (const k of ['redup', 'famous', 'risk']) delete rest[k];
    out.push({
      ...(rest as unknown as Omit<
        PoolItem,
        'id' | 'chars' | 'book' | 'title' | 'author' | 'line' | 'seg' | 'tier' | 'strict' | 'lg' | 'alt' | 'alts'
      >),
      id: idOf(title, it.ns, it.sq),
      chars: [...it.name],
      tier: 'B',
      book: title.bk as PoolItem['book'],
      title: title.t,
      author: title.au,
      line: text,
      seg: segOf(text, it, where),
      foot: it.foot,
      gap: it.gap,
      score: it.score,
      strict: title.st,
      lg: line.g,
      redup: trueFlag(it.redup, 'redup', where),
      famous: trueFlag(it.famous, 'famous', where),
      risk: riskOf(it.risk, where),
      ...(alts ? { alts } : {}),
    });
  }
  return out;
}

function asSingles(v: unknown): SingleItem[] {
  const out: SingleItem[] = [];
  for (const it of isArr(v)) {
    if (
      !isObj(it) ||
      !isStr(it.char) ||
      [...it.char].length !== 1 ||
      !isStr(it.from) ||
      !isNum(it.ti) ||
      !isNum(it.li) ||
      !isStr(it.ns) ||
      !isNum(it.sq) ||
      !isNum(it.foot) ||
      !isNum(it.score) ||
      ('famous' in it && it.famous !== true) ||
      ['id', 'book', 'title', 'author', 'line', 'seg', 'gap', 'strict', 'lg'].some((k) => k in it)
    ) {
      fail('singles 有结构不符的条目（可共享或可推导的字段不许直接存；恒假的可选字段不许存）');
    }
    const title = SOURCES.titles[it.ti];
    const line = SOURCES.lines[it.li];
    if (!title || !line) fail(`singles 里的「${it.char}」共享表下标越界`);
    out.push({
      ...(it as unknown as Omit<
        SingleItem,
        'id' | 'book' | 'title' | 'author' | 'line' | 'seg' | 'gap' | 'strict' | 'lg' | 'famous'
      >),
      // 单字名的 id 一直是「S_＋出处双名的 id」，所以出处那一条的序号也从产物里来，重建后逐字不变
      id: idOf(title, it.ns, it.sq, 'S_'),
      book: title.bk as SingleItem['book'],
      title: title.t,
      author: title.au,
      line: line.s,
      seg: segOf(line.s, it, `singles 里的「${it.char}」`),
      foot: it.foot,
      gap: 0, // 单字名没有「间隔几个字」这一说：它取自出处双名的那个字位
      strict: title.st,
      lg: line.g,
      // 名句层从它那条出处继承：产物只在真带分时带 `famous:true`，缺键＝false（与候选池同一口径）
      famous: trueFlag(it.famous, 'famous', `singles 里的「${it.char}」`),
    });
  }
  return out;
}

function asChars(v: unknown): Record<string, CharInfo> {
  if (!isObj(v)) fail('chars 不是对象');
  const out: Record<string, CharInfo> = {};
  for (const [k, c] of Object.entries(v)) {
    if (
      !isObj(c) ||
      !Array.isArray(c.py) ||
      !c.py.every(isStr) ||
      !Array.isArray(c.t) ||
      !c.t.every(isNum) ||
      c.py.length !== c.t.length ||
      !isNum(c.cf)
    ) {
      fail(`chars["${k}"] 结构不符`);
    }
    if ('pm' in c || 'l0' in c)
      fail(
        `chars["${k}"] 里又存了可以推导的字段：pm 由 py 加声调推导、l0 由 whitelist-L0 推导，存下来就是 8,105 份重复`,
      );
    const py = c.py as string[];
    const tones = c.t as number[];
    out[k] = {
      ...(c as unknown as Omit<CharInfo, 'pm' | 'l0'>),
      pm: py.map((syl, i) => markSyllable(syl, tones[i] ?? 0)),
      l0: L0_CHARS.has(k),
    };
  }
  return out;
}

function asHomo(v: unknown, what: string): Homophone {
  for (const e of isArr(v)) if (!isObj(e) || !isStr(e.py) || !isStr(e.w)) fail(`${what} 有结构不符的条目`);
  return v as Homophone;
}

function asStrSet(v: unknown, what: string): Set<string> {
  if (typeof v === 'string') return new Set(v.split(''));
  if (!Array.isArray(v) || !v.every(isStr)) fail(`${what} 既不是字符串也不是字符串数组`);
  return new Set(v);
}

const RADICAL_SET = new Set(['木', '火', '水', '金', '土']);
function asRadical(v: unknown): Record<string, '木' | '火' | '水' | '金' | '土'> {
  if (!isObj(v)) fail('radical 不是对象');
  for (const [k, c] of Object.entries(v)) if (!isStr(c) || !RADICAL_SET.has(c)) fail(`radical["${k}"] 取值非康熙五部`);
  return v as Record<string, '木' | '火' | '水' | '金' | '土'>;
}

function asLineGloss(v: unknown): string[] {
  for (const g of isArr(v)) if (!isStr(g) || !g) fail('line_gloss 有非字符串或空释义');
  return v as string[];
}

function asGloss(v: unknown): Record<string, string> {
  if (!isObj(v)) fail('gloss 不是对象');
  for (const [k, g] of Object.entries(v)) if (!isStr(g)) fail(`gloss["${k}"] 不是字符串`);
  return v as Record<string, string>;
}

const META_KEYS = [
  'pool_B',
  'singles',
  'L0_size',
  'L0_seed',
  'L0_added',
  'ship_bytes_total',
  'radical_chars',
  'radical_named',
  'gloss_chars',
  'line_gloss',
  'gloss_gap_items',
  'gloss_gap_lines',
  'gloss_lines_primary',
  'src_titles',
  'src_lines',
  'src_lines_gap',
  'real_tier',
  'real_tier_genders',
  'pool_real_named',
  'pool_real_side_m',
  'pool_real_side_f',
  'pool_real_side_n',
  'pool_real_resolved',
  'pool_word',
  'pool_no_evidence',
  'pool_split',
  'famous_threshold',
  'pool_famous',
  'singles_famous',
  'alt_total',
  'alt_names',
  'alt_max',
  'alt_lines_added',
  'alt_titles_added',
] as const;
type Meta = {
  pool_B: number;
  by_gap: { gap1: number; gap2: number; gap3: number };
  singles: number;
  singles_without_source: number;
  L0_size: number;
  L0_seed: number;
  L0_added: number;
  per_book: Record<string, number>;
  ship_bytes_total: number;
  radical_chars: number;
  radical_dist: Record<Radical, number>;
  radical_named: number;
  shape_chars: number;
  gloss_chars: number;
  line_gloss: number;
  // 今译覆盖的缺口：条目数与唯一原句数（界面在这些位置显示「今译待补」，逐句清单 docs/gloss-gaps.md）
  gloss_gap_items: number;
  gloss_gap_lines: number;
  gloss_lines_primary: number;
  // 共享表规模：篇名条目数、共享原句条数、其中还没有今译的句子数
  src_titles: number;
  src_lines: number;
  src_lines_gap: number;
  given_freq_chars: number;
  // 真实用名证据：这名字在 120 万真实姓名语料里出现过多少次、上游标什么性别（口径见 derive-cnname-given.mjs）
  real_tier: number;
  real_tier_genders: number;
  pool_real_named: number;
  pool_real_side_m: number;
  pool_real_side_f: number;
  pool_real_side_n: number;
  pool_real_resolved: number;
  // 成词层：默认只给「这两个字在典籍里本来就挨着」的名字，三个计数在构建期算好（口径见 build-data）
  pool_word: number;
  pool_attested: number;
  pool_modern_word: number;
  pool_no_evidence: number;
  pool_split: number;
  // 名句层：跨全池的单一阈值 T，与该守住的条数（单字名继承它那条出处）。口径见 build-data／verify 4g
  famous_threshold: number;
  pool_famous: number;
  singles_famous: number;
  // 多出处（0.14.0）：处数合计／带 alternates 的条数／单名最多几处／为它追加的原句与篇名条目数
  alt_total: number;
  alt_names: number;
  alt_max: number;
  alt_lines_added: number;
  alt_titles_added: number;
  alt_occurrences: number;
  corpus_sha: string;
  id_prefix_stats: { groups: number; collisions: number; max_group: number };
};
// 康熙五部的固定键名：界面按这五个键取计数，所以类型上必须是这五个键，
// 构建产物少了哪个就在启动自检时报错，而不是到界面上变成 undefined。
export const RADICALS = ['木', '火', '水', '金', '土'] as const;
export type Radical = (typeof RADICALS)[number];

function asMeta(v: unknown): Meta {
  if (!isObj(v)) fail('meta 不是对象');
  for (const k of META_KEYS) if (!isNum(v[k])) fail(`meta.${k} 不是数字`);
  if (!isObj(v.by_gap) || !isNum(v.by_gap.gap1)) fail('meta.by_gap 结构不符');
  if (!isStr(v.corpus_sha) || !/^[0-9a-f]{12}$/.test(v.corpus_sha)) fail('meta.corpus_sha 不是 12 位十六进制');
  const s = v.id_prefix_stats;
  if (!isObj(s) || !isNum(s.groups) || !isNum(s.collisions) || !isNum(s.max_group))
    fail('meta.id_prefix_stats 结构不符');
  const rd = v.radical_dist;
  if (!isObj(rd) || !RADICALS.every((k) => isNum(rd[k]))) fail('meta.radical_dist 缺少康熙五部之一的计数');
  return v as unknown as Meta;
}

// 构建注入的应用版本（vite.config 的 __APP_VERSION__，取自 package.json）。
declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export const POOL = asPool(candidatesJson, 'candidates');
export const SINGLES = asSingles(singlesJson);
export const LINE_GLOSS = asLineGloss(lineGlossJson);
export const CHARS = asChars(charsJson);
// 真实人名档：产物只存 name / rn / rs / src 四个字段，id 与「无出处」的那些空字段在加载时补，
// 界面与打分拿到的形状和典籍候选一致（book 为 'real'，line 为空表示没有原句可引）。
// 自检逐条校验：两个字都必须是白名单 L0 内的字——这一档不许绕过用字白名单。
function asReal(v: unknown, what: string, chars: Record<string, CharInfo>): RealItem[] {
  const out: RealItem[] = [];
  for (const raw of isArr(v)) {
    if (!isObj(raw)) fail(`${what} 有结构不符的条目`);
    const it = raw as { name?: unknown; rn?: unknown; rs?: unknown; src?: unknown };
    const rs = it.rs;
    if (
      !isStr(it.name) ||
      [...it.name].length !== 2 ||
      !isNum(it.rn) ||
      (it.rn as number) < 1 ||
      (it as { src?: unknown }).src !== 'real' ||
      (rs !== undefined && rs !== 'm' && rs !== 'f' && rs !== 'n') ||
      'id' in it ||
      'line' in it
    )
      fail(`${what} 有结构不符的条目`);
    const name = it.name as string;
    for (const ch of name) if (!chars[ch]?.l0) fail(`${what} 里的「${name}」用到了白名单外的字 ${ch}`);
    out.push({
      id: `RN_${name}`,
      name,
      book: 'real',
      title: '',
      author: '',
      line: '',
      seg: '',
      foot: 0,
      gap: 0,
      strict: false,
      redup: false,
      lg: -1,
      rn: it.rn as number,
      ...(rs === 'm' || rs === 'f' || rs === 'n' ? { rs } : {}),
    });
  }
  return out;
}

export const HOMO_FULL = asHomo(homophoneJson.full, 'homophone.full');
export const HOMO_INIT = asHomo(homophoneJson.initial, 'homophone.initial');
export const RISK_HIGH = asStrSet(riskJson.high, 'risk.high');
// 性别风格的两张字表：只有字表进包，标签由引擎现算，这样卡片上的「依据」和筛选必然同源
export const GENDER_FEMALE = asStrSet((genderJson as { female: unknown }).female, 'gender.female');
export const GENDER_MALE = asStrSet((genderJson as { male: unknown }).male, 'gender.male');
export const REAL_ITEMS = asReal(realNamesJson, 'realnames', CHARS);
// 康熙五部（木/火/水/金/土）里出来的字才有值；查不到就留白，留白不代表该字「无五行」
export const RADICAL = asRadical(radicalJson);
// 字义：名用字逐字短释义（本义优先）。只对 L0 字发布，查不到就留白
export const GLOSS = asGloss(glossJson);
// 出处今译：条目只存 lg 下标。lg = -1 是明确的「这句还没有今译」（界面显示「今译待补」，
// 逐句清单在 docs/gloss-gaps.md）；其它取不到就是构建产物坏了，启动即失败。
for (const it of [...POOL, ...SINGLES])
  if (it.lg !== -1 && !LINE_GLOSS[it.lg]) fail(`${it.id} 的 lg=${it.lg} 取不到今译`);
export const META = asMeta(metaJson);
