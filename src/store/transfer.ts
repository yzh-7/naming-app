// 导出/导入与「可分享链接」的编解码。全部是纯函数，便于单测。
import type { Gender, Opts, SortKey } from '../engine/types';
import { BOOK_ORDER } from '../engine/types';
import { DEFAULT_OPTS, type FavRecord } from './local';

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
    search: typeof o.search === 'string' ? o.search.slice(0, 40) : '',
    sort: SORTS.includes(o.sort as SortKey) ? (o.sort as SortKey) : 'score',
    strokeMax: Number.isInteger(o.strokeMax) && (o.strokeMax as number) >= 0 && (o.strokeMax as number) <= 64 ? (o.strokeMax as number) : 0,
    noMonotone: !!o.noMonotone,
    popFloor: POP_FLOORS.includes(Number(o.popFloor)) ? Number(o.popFloor) : 0,
    exclude: [],
  };
}

// 解析导入文件：结构不合法返回 null，绝不抛出（导入面板会显示错误）
export function parseState(text: string): SavedState | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.app !== 'naming-app' && !('favorites' in r || 'opts' in r)) return null;
  const favs = Array.isArray(r.favorites) ? r.favorites.filter((x): x is FavRecord => !!x && typeof (x as FavRecord).id === 'string') : [];
  const blocks = Array.isArray(r.blocklist) ? r.blocklist.filter((x): x is string => typeof x === 'string') : [];
  return {
    app: 'naming-app',
    version: 1,
    exportedAt: typeof r.exportedAt === 'string' ? r.exportedAt : new Date().toISOString(),
    surname: clean(r.surname, 2),
    reading: Number.isInteger(r.reading) ? (r.reading as number) : 0,
    opts: sanitizeOpts(r.opts),
    favorites: favs,
    blocklist: blocks,
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
  if (o.search) q.set('q', o.search);
  if (o.sort !== 'score') q.set('o', o.sort);
  if (o.strokeMax) q.set('sm', String(o.strokeMax));
  if (o.noMonotone) q.set('nm', '1');
  if (o.popFloor) q.set('pf', String(o.popFloor));
  const bits = BOOK_ORDER.map((b) => (o.books[b] ? '1' : '0')).join('');
  if (bits !== '1'.repeat(BOOK_ORDER.length)) q.set('b', bits);
  if (o.redupOnly) q.set('d', '1');
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
  if (s) opts.search = s.slice(0, 40);
  const o = q.get('o');
  if (o && SORTS.includes(o as SortKey)) opts.sort = o as SortKey;
  const sm = q.get('sm');
  if (sm && /^\d+$/.test(sm)) { const n = Number(sm); if (n > 0 && n <= 64) opts.strokeMax = n; }
  if (q.get('nm') === '1') opts.noMonotone = true;
  const pf = q.get('pf');
  if (pf && POP_FLOORS.includes(Number(pf)) && Number(pf) > 0) opts.popFloor = Number(pf);
  const b = q.get('b');
  if (b && /^[01]{6}$/.test(b)) opts.books = Object.fromEntries(BOOK_ORDER.map((k, i) => [k, b[i] === '1'])) as Opts['books'];
  if (q.get('d') === '1') opts.redupOnly = true;
  const surname = q.get('s') ? clean(q.get('s'), 2) : undefined;
  const r = q.get('r');
  return { surname, reading: r && /^\d+$/.test(r) ? Number(r) : undefined, opts };
}
