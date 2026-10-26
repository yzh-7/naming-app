// 导出/导入与「可分享链接」的编解码。全部是纯函数，便于单测。
import type { Gender, Opts, SortKey } from '../engine/types';
import { BOOK_ORDER } from '../engine/types';
import { DEFAULT_OPTS, SEARCH_MAX, TITLE_MAX, sanitizeFav, type FavRecord } from './local';

// 导入文件的条目上限：一份导出文件的实际量级是几百条，超过这个数就不可能是本机导出的
const FAV_MAX = 5000;
const BLOCK_MAX = 5000;

export type SavedState = {
  app: 'naming-app';
  version: 1;
  exportedAt: string;
  surname: string;
  reading: number;
  opts: Opts;
  favorites: FavRecord[];
  blocklist: string[];
};

const SORTS: SortKey[] = ['score', 'strokes', 'popular', 'book'];
const GENDERS: Gender[] = ['any', 'f', 'm'];
const POP_FLOORS = [0, 100, 500, 2000];

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[^一-鿿]/g, '').slice(0, max) : '');

export function buildState(p: { surname: string; reading: number; opts: Opts; favorites: FavRecord[]; blocklist: string[] }): SavedState {
  return { app: 'naming-app', version: 1, exportedAt: new Date().toISOString(), ...p };
}
export const serialize = (s: SavedState) => JSON.stringify(s, null, 2);

export function sanitizeOpts(raw: unknown): Opts {
  // 与 loadOpts 同一套取值规则；差异只在「导入文件不认识的项回默认」
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Opts> & { books?: Partial<Opts['books']> };
  const books = { ...DEFAULT_OPTS.books };
  for (const b of BOOK_ORDER) if (typeof o.books?.[b] === 'boolean') books[b] = o.books[b] as boolean;
  const count = Number.isInteger(o.count) && (o.count as number) >= 0 && (o.count as number) <= 600 ? (o.count as number) : DEFAULT_OPTS.count;
  return {
    ...DEFAULT_OPTS,
    gender: GENDERS.includes(o.gender as Gender) ? (o.gender as Gender) : 'any',
    genderWeak: !!o.genderWeak,
    length: o.length === 1 ? 1 : 2,
    books,
    redupOnly: !!o.redupOnly,
    count,
    search: typeof o.search === 'string' ? o.search.slice(0, SEARCH_MAX) : '',
    title: typeof o.title === 'string' ? o.title.slice(0, TITLE_MAX) : '',
    sort: SORTS.includes(o.sort as SortKey) ? (o.sort as SortKey) : 'score',
    strokeMax: Number.isInteger(o.strokeMax) && (o.strokeMax as number) >= 0 && (o.strokeMax as number) <= 64 ? (o.strokeMax as number) : 0,
    noMonotone: !!o.noMonotone,
    popFloor: POP_FLOORS.includes(Number(o.popFloor)) ? Number(o.popFloor) : 0,
    mustChar: typeof o.mustChar === 'string' && /^[一-鿿]$/.test(o.mustChar) ? o.mustChar : '',
    mustPos: o.mustPos === 'first' || o.mustPos === 'last' ? o.mustPos : 'any',
    exclude: [],
  };
}

// 解析导入文件。绝不抛出；失败分三种，界面按 kind 说不同的话，不再把四种情况混成一句
export type ParseError = 'json' | 'foreign' | 'empty';
export type ParseResult = { ok: true; state: SavedState } | { ok: false; error: ParseError };

export function parseState(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'json' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'json' };
  const r = raw as Record<string, unknown>;
  // 带 app 标记但不是本应用的 → 别人的文件；没有标记但要有一个我们认识的键，否则也当别人的文件
  if (typeof r.app === 'string' && r.app !== 'naming-app') return { ok: false, error: 'foreign' };
  if (!['favorites', 'blocklist', 'opts', 'surname', 'reading'].some((k) => k in r)) return { ok: false, error: 'foreign' };

  // 收藏与拉黑逐条消毒（类型、长度、未知 book）、按 id 去重、限量，和读本机时同一套规则
  const favs: FavRecord[] = [];
  if (Array.isArray(r.favorites)) {
    const seen = new Set<string>();
    for (let i = 0; i < r.favorites.length && favs.length < FAV_MAX; i++) {
      const rec = sanitizeFav(r.favorites[i], i);
      if (!rec || seen.has(rec.id)) continue;
      seen.add(rec.id);
      favs.push(rec);
    }
  }
  const blocks: string[] = [];
  if (Array.isArray(r.blocklist)) {
    const seen = new Set<string>();
    for (const x of r.blocklist) {
      if (typeof x !== 'string' || !x || seen.has(x)) continue;
      seen.add(x);
      blocks.push(x.slice(0, 64));
      if (blocks.length >= BLOCK_MAX) break;
    }
  }
  const hasSettings = 'opts' in r || 'surname' in r || 'reading' in r;
  if (!favs.length && !blocks.length && !hasSettings) return { ok: false, error: 'empty' };

  return {
    ok: true,
    state: {
      app: 'naming-app',
      version: 1,
      exportedAt: typeof r.exportedAt === 'string' ? r.exportedAt : new Date().toISOString(),
      surname: clean(r.surname, 2),
      reading: Number.isInteger(r.reading) ? (r.reading as number) : 0,
      opts: sanitizeOpts(r.opts),
      favorites: favs,
      blocklist: blocks,
    },
  };
}

// URL：只带轻量筛选（姓氏/读音/性别/字数/条数/搜索/排序/典籍位），收藏与拉黑留在本机
export function toQuery(s: Pick<SavedState, 'surname' | 'reading' | 'opts'>): string {
  const q = new URLSearchParams();
  if (s.surname) q.set('s', s.surname);
  if (s.reading) q.set('r', String(s.reading));
  const o = s.opts;
  if (o.gender !== 'any') q.set('g', o.gender);
  if (o.length !== 2) q.set('len', '1');
  if (o.count !== DEFAULT_OPTS.count) q.set('n', o.count === 0 ? 'all' : String(o.count));
  if (o.search) q.set('q', o.search.slice(0, SEARCH_MAX));
  if (o.title) q.set('t', o.title.slice(0, TITLE_MAX));
  if (o.sort !== 'score') q.set('o', o.sort);
  if (o.strokeMax) q.set('sm', String(o.strokeMax));
  if (o.noMonotone) q.set('nm', '1');
  if (o.popFloor) q.set('pf', String(o.popFloor));
  const bits = BOOK_ORDER.map((b) => (o.books[b] ? '1' : '0')).join('');
  if (bits !== '1'.repeat(BOOK_ORDER.length)) q.set('b', bits);
  if (o.redupOnly) q.set('d', '1');
  if (o.mustChar) {
    q.set('mc', o.mustChar);
    if (o.mustPos !== 'any') q.set('mp', o.mustPos);
  }
  return q.toString();
}

export function fromQuery(qs: string): { surname?: string; reading?: number; opts: Partial<Opts> } | null {
  const q = new URLSearchParams(qs);
  if (![...q.keys()].length) return null;
  const opts: Partial<Opts> = {};
  const g = q.get('g');
  if (g && GENDERS.includes(g as Gender)) opts.gender = g as Gender;
  if (q.get('len') === '1') opts.length = 1;
  const n = q.get('n');
  if (n === 'all') opts.count = 0;
  else if (n && /^\d+$/.test(n)) opts.count = Math.min(600, Number(n));
  const s = q.get('q');
  if (s) opts.search = s.slice(0, SEARCH_MAX);
  const t = q.get('t');
  if (t) opts.title = t.slice(0, TITLE_MAX);
  const o = q.get('o');
  if (o && SORTS.includes(o as SortKey)) opts.sort = o as SortKey;
  const sm = q.get('sm');
  if (sm && /^\d+$/.test(sm)) { const n = Number(sm); if (n > 0 && n <= 64) opts.strokeMax = n; }
  if (q.get('nm') === '1') opts.noMonotone = true;
  const pf = q.get('pf');
  if (pf && POP_FLOORS.includes(Number(pf)) && Number(pf) > 0) opts.popFloor = Number(pf);
  const b = q.get('b');
  // 兼容旧链接：书数增加后，6 位（或任意短一位）一律按「新书默认开」补齐
  if (b && /^[01]{6,}$/.test(b)) {
    const bits = b.length < BOOK_ORDER.length ? b + '1'.repeat(BOOK_ORDER.length - b.length) : b.slice(0, BOOK_ORDER.length);
    opts.books = Object.fromEntries(BOOK_ORDER.map((k, i) => [k, bits[i] === '1'])) as Opts['books'];
  }
  if (q.get('d') === '1') opts.redupOnly = true;
  const mc = q.get('mc');
  if (mc && /^[一-鿿]$/.test(mc)) {
    opts.mustChar = mc;
    const mp = q.get('mp');
    if (mp === 'first' || mp === 'last') opts.mustPos = mp;
  }
  const surname = q.get('s') ? clean(q.get('s'), 2) : undefined;
  const r = q.get('r');
  return { surname, reading: r && /^\d+$/.test(r) ? Number(r) : undefined, opts };
}
