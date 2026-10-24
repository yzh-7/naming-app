import candidatesJson from '../data/candidates.json';
import singlesJson from '../data/singles.json';
import charsJson from '../data/chars.json';
import homophoneJson from '../data/homophone.json';
import riskJson from '../data/risk.json';
import genderJson from '../data/gender.json';
import radicalJson from '../data/radical.json';
import glossJson from '../data/gloss.json';
import lineGlossJson from '../data/line_gloss.json';
import metaJson from '../data/meta.json';
import { BOOK_ORDER, type CharInfo, type Homophone, type PoolItem, type SingleItem } from './types';

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

function asPool(v: unknown, what: string): PoolItem[] {
  for (const it of isArr(v)) {
    if (!isObj(it) || !isStr(it.id) || !isStr(it.name) || !Array.isArray(it.chars) || !it.chars.every(isStr) ||
        !isStr(it.book) || !BOOKS.has(it.book) || !isStr(it.title) || !isStr(it.line) ||
        !isNum(it.foot) || !isNum(it.gap) || typeof it.strict !== 'boolean' || !isNum(it.lg)) {
      fail(`${what} 有结构不符的条目`);
    }
  }
  return v as PoolItem[];
}

function asSingles(v: unknown): SingleItem[] {
  for (const it of isArr(v)) {
    if (!isObj(it) || !isStr(it.id) || !isStr(it.char) || !isStr(it.from) || !isStr(it.book) ||
        !BOOKS.has(it.book) || !isStr(it.line) || !isNum(it.foot) || !isNum(it.gap) || !isNum(it.lg)) {
      fail('singles 有结构不符的条目');
    }
  }
  return v as SingleItem[];
}

function asChars(v: unknown): Record<string, CharInfo> {
  if (!isObj(v)) fail('chars 不是对象');
  for (const [k, c] of Object.entries(v)) {
    if (!isObj(c) || !Array.isArray(c.py) || !c.py.every(isStr) || !Array.isArray(c.pm) || !Array.isArray(c.t) ||
        !isNum(c.lvl) || !isNum(c.cf) || typeof c.l0 !== 'boolean') {
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

const META_KEYS = ['pool_B', 'singles', 'L0_size', 'L0_seed', 'L0_added', 'ship_bytes_total', 'radical_chars', 'radical_named', 'gloss_chars', 'line_gloss'] as const;
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
  radical_dist: Record<string, number>;
  radical_named: number;
  shape_chars: number;
  gloss_chars: number;
  line_gloss: number;
  given_freq_chars: number;
};
function asMeta(v: unknown): Meta {
  if (!isObj(v)) fail('meta 不是对象');
  for (const k of META_KEYS) if (!isNum(v[k])) fail(`meta.${k} 不是数字`);
  if (!isObj(v.by_gap) || !isNum(v.by_gap.gap1)) fail('meta.by_gap 结构不符');
  return v as unknown as Meta;
}

export const POOL = asPool(candidatesJson, 'candidates');
export const SINGLES = asSingles(singlesJson);
export const LINE_GLOSS = asLineGloss(lineGlossJson);
export const CHARS = asChars(charsJson);
export const HOMO_FULL = asHomo(homophoneJson.full, 'homophone.full');
export const HOMO_INIT = asHomo(homophoneJson.initial, 'homophone.initial');
export const RISK_HIGH = asStrSet(riskJson.high, 'risk.high');
// 性别风格的两张字表：只有字表进包，标签由引擎现算，这样卡片上的「依据」和筛选必然同源
export const GENDER_FEMALE = asStrSet((genderJson as { female: unknown }).female, 'gender.female');
export const GENDER_MALE = asStrSet((genderJson as { male: unknown }).male, 'gender.male');
// 康熙五部（木/火/水/金/土）里出来的字才有值；查不到就留白，留白不代表该字「无五行」
export const RADICAL = asRadical(radicalJson);
// 字义：名用字逐字短释义（本义优先）。只对 L0 字发布，查不到就留白
export const GLOSS = asGloss(glossJson);
// 出处今译：与候选/单字逐条对应，条目只存 lg 下标；越界就是构建产物坏了，启动即失败
for (const it of [...POOL, ...SINGLES]) if (!LINE_GLOSS[it.lg]) fail(`${it.id} 的 lg=${it.lg} 取不到今译`);
export const META = asMeta(metaJson);
