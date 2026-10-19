import type { Gender, Opts, SortKey } from '../engine/types';
import { BOOK_ORDER } from '../engine/types';

const SORTS: SortKey[] = ['score', 'strokes', 'popular', 'book'];

export type FavRecord = { id: string; note?: string; group?: string; ts: number };
export type Theme = 'light' | 'dark' | 'system';

const K = {
  fav: 'naming.favorites.v1',
  block: 'naming.blocklist.v1',
  surname: 'naming.surname.v1',
  reading: 'naming.surnameReading.v1',
  opts: 'naming.opts.v1',
  theme: 'naming.theme.v1',
  compose: 'naming.compose.v1',
};

function readRaw(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

// 收藏：新格式是记录数组（带备注/分组），旧格式是 id 字符串数组。读到旧格式就地升级，顺序（最近的在前）保留
export function loadFavorites(): FavRecord[] {
  const raw = readRaw(K.fav);
  if (!Array.isArray(raw)) return [];
  const out: FavRecord[] = [];
  const seen = new Set<string>();
  raw.forEach((x, i) => {
    if (typeof x === 'string') {
      if (!seen.has(x)) { seen.add(x); out.push({ id: x, ts: i }); }
    } else if (x && typeof x === 'object') {
      const r = x as Record<string, unknown>;
      if (typeof r.id !== 'string' || seen.has(r.id)) return;
      seen.add(r.id);
      out.push({
        id: r.id,
        note: typeof r.note === 'string' && r.note ? r.note : undefined,
        group: typeof r.group === 'string' && r.group ? r.group : undefined,
        ts: typeof r.ts === 'number' ? r.ts : i,
      });
    }
  });
  return out;
}
const writeFav = (list: FavRecord[]) => localStorage.setItem(K.fav, JSON.stringify(list));
// 导入用：整体写回（合并/覆盖都由调用方决定）
export const saveFavorites = (list: FavRecord[]) => { writeFav(list); return list; };
export const addFavorite = (id: string): FavRecord[] => {
  const l = loadFavorites();
  if (!l.some((r) => r.id === id)) l.unshift({ id, ts: Date.now() });
  writeFav(l);
  return l;
};
export const removeFavorite = (id: string): FavRecord[] => {
  writeFav(loadFavorites().filter((r) => r.id !== id));
  return loadFavorites();
};
export const updateFavorite = (id: string, patch: { note?: string; group?: string }): FavRecord[] => {
  const l = loadFavorites().map((r) => (r.id === id ? { ...r, ...patch } : r));
  writeFav(l);
  return l;
};

function readList(key: string): string[] {
  const v = readRaw(key);
  return Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string'))] : [];
}
function writeList(key: string, list: string[]) {
  localStorage.setItem(key, JSON.stringify([...new Set(list)]));
}

export const loadBlocklist = () => readList(K.block);
export const saveBlocklist = (list: string[]) => { writeList(K.block, list); return readList(K.block); };
export const addBlock = (id: string) => { const l = readList(K.block); if (!l.includes(id)) l.unshift(id); writeList(K.block, l); return l; };
export const removeBlock = (id: string) => { writeList(K.block, readList(K.block).filter((x) => x !== id)); return readList(K.block); };

export const loadSurname = () => localStorage.getItem(K.surname) ?? '';
export const saveSurname = (s: string) => localStorage.setItem(K.surname, s);
export const loadReading = () => Number(localStorage.getItem(K.reading) ?? '0');
export const saveReading = (n: number) => localStorage.setItem(K.reading, String(n));

export function loadTheme(): Theme {
  const t = localStorage.getItem(K.theme);
  if (t === 'dark' || t === 'light' || t === 'system') return t;
  return 'system';
}
export const saveTheme = (t: Theme) => localStorage.setItem(K.theme, t);
export const prefersDark = () => !!(typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
export const resolveDark = (t: Theme) => t === 'dark' || (t === 'system' && prefersDark());
export const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];
export const THEME_LABEL: Record<Theme, string> = { light: '浅色', dark: '深色', system: '跟随系统' };

const POP_FLOORS = [0, 100, 500, 2000];

const DEFAULT: Opts = {
  gender: 'any',
  genderWeak: false,
  length: 2,
  books: Object.fromEntries(BOOK_ORDER.map((b) => [b, true])) as Opts['books'],
  redupOnly: false,
  exclude: [],
  count: 12,
  search: '',
  sort: 'score',
  strokeMax: 0,
  noMonotone: false,
  popFloor: 0,
};
export { DEFAULT as DEFAULT_OPTS };

export function loadOpts(): Opts {
  try {
    const raw = JSON.parse(localStorage.getItem(K.opts) ?? '{}') as Partial<Opts> & { books?: Partial<Opts['books']> };
    const books = { ...DEFAULT.books };
    for (const b of BOOK_ORDER) if (typeof raw.books?.[b] === 'boolean') books[b] = raw.books[b] as boolean;
    const count = Number.isInteger(raw.count) && (raw.count as number) >= 0 && (raw.count as number) <= 600 ? raw.count as number : DEFAULT.count;
    const length = raw.length === 1 ? 1 : 2;
    return {
      ...DEFAULT,
      gender: (['any', 'f', 'm'] as Gender[]).includes(raw.gender as Gender) ? (raw.gender as Gender) : DEFAULT.gender,
      genderWeak: !!raw.genderWeak,
      length,
      // 单名层没有叠字；这个组合会清空候选池，而叠字开关在单名下不显示，用户看不见也关不掉
      redupOnly: length === 2 && !!raw.redupOnly,
      books,
      count,
      search: typeof raw.search === 'string' ? raw.search.slice(0, 40) : DEFAULT.search,
      sort: SORTS.includes(raw.sort as SortKey) ? (raw.sort as SortKey) : DEFAULT.sort,
      strokeMax: Number.isInteger(raw.strokeMax) && (raw.strokeMax as number) >= 0 && (raw.strokeMax as number) <= 64 ? (raw.strokeMax as number) : DEFAULT.strokeMax,
      noMonotone: !!raw.noMonotone,
      popFloor: POP_FLOORS.includes(Number(raw.popFloor)) ? Number(raw.popFloor) : DEFAULT.popFloor,
    };
  } catch {
    return DEFAULT;
  }
}
export const saveOpts = (o: Opts) => localStorage.setItem(K.opts, JSON.stringify({ gender: o.gender, genderWeak: o.genderWeak, length: o.length, redupOnly: o.redupOnly, books: o.books, count: o.count, search: o.search, sort: o.sort, strokeMax: o.strokeMax, noMonotone: o.noMonotone, popFloor: o.popFloor }));

// 自选页草稿：来回切 tab 不丢已选的字。只存纯数据，不存派生结果
export type ComposeDraft = { length: 1 | 2; chars: string[]; free: boolean };
export function loadCompose(): ComposeDraft {
  const raw = readRaw(K.compose);
  if (!raw || typeof raw !== 'object') return { length: 2, chars: [], free: false };
  const r = raw as Record<string, unknown>;
  const chars = Array.isArray(r.chars) ? r.chars.filter((c): c is string => typeof c === 'string' && /^[一-鿿]$/.test(c)).slice(0, 2) : [];
  return { length: r.length === 1 ? 1 : 2, chars, free: !!r.free };
}
export const saveCompose = (d: ComposeDraft) => localStorage.setItem(K.compose, JSON.stringify(d));

export const FAV_KEY = K.fav;
export const BLOCK_KEY = K.block;
