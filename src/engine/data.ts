import candidatesJson from '../data/candidates.json';
import singlesJson from '../data/singles.json';
import realNamesJson from '../data/realnames.json';
import charsJson from '../data/chars.json';
import homophoneJson from '../data/homophone.json';
import riskJson from '../data/risk.json';
import genderJson from '../data/gender.json';
import radicalJson from '../data/radical.json';
import glossJson from '../data/gloss.json';
import lineGlossJson from '../data/line_gloss.json';
import metaJson from '../data/meta.json';
import { BOOK_ORDER, type CharInfo, type Homophone, type PoolItem, type RealItem, type SingleItem } from './types';

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

// 产物里不存 chars：双名条目的 chars 恒等于 name 拆字，1,525 条存下来要多花 7,951 B gzip
// （实测同一份数据，删掉这个字段 91,428 → 83,478 B）。加载时由 name 展开，运行时的 PoolItem
// 形状不变，取词、打分、界面都不用改。自检仍然逐条校验 name 是两个字——存不出 chars 不等于
// 可以少一个校验：字数的口径在这里守着。
function asPool(v: unknown, what: string): PoolItem[] {
  const out: PoolItem[] = [];
  for (const it of isArr(v)) {
    if (
      !isObj(it) ||
      !isStr(it.id) ||
      !isStr(it.name) ||
      [...it.name].length !== 2 ||
      'chars' in it ||
      !isStr(it.book) ||
      !BOOKS.has(it.book) ||
      !isStr(it.title) ||
      !isStr(it.line) ||
      !isNum(it.foot) ||
      !isNum(it.gap) ||
      typeof it.strict !== 'boolean' ||
      !isNum(it.lg)
    ) {
      fail(`${what} 有结构不符的条目`);
    }
    out.push({ ...(it as unknown as PoolItem), chars: [...(it as unknown as { name: string }).name] });
  }
  return out;
}

function asSingles(v: unknown): SingleItem[] {
  for (const it of isArr(v)) {
    if (
      !isObj(it) ||
      !isStr(it.id) ||
      !isStr(it.char) ||
      !isStr(it.from) ||
      !isStr(it.book) ||
      !BOOKS.has(it.book) ||
      !isStr(it.line) ||
      !isNum(it.foot) ||
      !isNum(it.gap) ||
      !isNum(it.lg)
    ) {
      fail('singles 有结构不符的条目');
    }
  }
  return v as SingleItem[];
}

function asChars(v: unknown): Record<string, CharInfo> {
  if (!isObj(v)) fail('chars 不是对象');
  for (const [k, c] of Object.entries(v)) {
    if (
      !isObj(c) ||
      !Array.isArray(c.py) ||
      !c.py.every(isStr) ||
      !Array.isArray(c.pm) ||
      !Array.isArray(c.t) ||
      !isNum(c.lvl) ||
      !isNum(c.cf) ||
      typeof c.l0 !== 'boolean'
    ) {
      fail(`chars["${k}"] 结构不符`);
    }
  }
  return v as unknown as Record<string, CharInfo>;
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
