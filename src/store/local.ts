import type { Book, Gender, Opts, SortKey } from '../engine/types';
import { BOOK_ORDER } from '../engine/types';

const SORTS: SortKey[] = ['score', 'strokes', 'popular', 'book'];

// 除 id 外还存一份出处快照：语料更新后 id 尾号可能指向别的名字，靠快照还能找回原来那一条
export type FavRecord = {
  id: string; note?: string; group?: string; ts: number;
  name?: string; book?: Book; title?: string; line?: string;
};
export type Theme = 'light' | 'dark' | 'system';

// 搜索词在写入端就截断，这样「保存 → 重读」与「分享链接 → 打开」得到同一个结果
export const SEARCH_MAX = 40;
// 出处快照的长度上限：足够回查一条记录，又不让收藏文件无限膨胀
const SNAP = { name: 8, title: 30, line: 120 };
export const TITLE_MAX = 30;

const K = {
  fav: 'naming.favorites.v1',
  block: 'naming.blocklist.v1',
  surname: 'naming.surname.v1',
  reading: 'naming.surnameReading.v1',
  opts: 'naming.opts.v1',
  theme: 'naming.theme.v1',
  compose: 'naming.compose.v1',
};

// 存储不可用（隐私模式、配额写满、被站点策略禁用）时不抛出：读回默认值，写入记一次失败，
// 由界面读取 storageUnavailable() 播报「这次没保存」。
let unavailable = false;
export const storageUnavailable = () => unavailable;

// 写入失败不只记状态，也通知订阅者：界面订阅一次，任何一次保存失败都能播报。
// （在 effect 里同步 setState 是 React 不推荐的形状，订阅回调才是）
type StorageListener = () => void;
const storageListeners = new Set<StorageListener>();
export function subscribeStorageFailure(fn: StorageListener): () => void {
  storageListeners.add(fn);
  return () => { storageListeners.delete(fn); };
}
function markUnavailable() {
  const was = unavailable;
  unavailable = true;
  if (!was) for (const fn of storageListeners) fn();
}
// 开机探一次：隐私模式或站点策略禁用存储时 localStorage 直接抛，不必等到第一次保存
export function storageUsable(): boolean {
  const probe = 'naming.probe.v1';
  try {
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    unavailable = false; // 探测成功说明存储恢复，之前的失败标记不该一直挂着
    return true;
  } catch { markUnavailable(); return false; }
}

function readItem(key: string): string | null {
  try { return localStorage.getItem(key); } catch { markUnavailable(); return null; }
}
function writeItem(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { markUnavailable(); return false; }
}

function readRaw(key: string): unknown {
  try { return JSON.parse(readItem(key) ?? 'null'); } catch { return null; }
}

// 一条收藏的消毒：本机与导入文件走同一套规则。非字符串、超长、未知 book 一律收敛，
// 不合法的条目返回 null 由调用方丢弃。旧格式（裸 id 字符串）升级为 FavRecord。
export function sanitizeFav(raw: unknown, index: number): FavRecord | null {
  if (typeof raw === 'string') return raw ? { id: raw.slice(0, 64), ts: index } : null;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
  const rec: FavRecord = { id: r.id.slice(0, 64), ts: typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts : index };
  const note = str(r.note, 120); if (note) rec.note = note;
  const group = str(r.group, 24); if (group) rec.group = group;
  const name = str(r.name, SNAP.name); if (name) rec.name = name;
  const title = str(r.title, SNAP.title); if (title) rec.title = title;
  const line = str(r.line, SNAP.line); if (line) rec.line = line;
  const book = BOOK_ORDER.find((b) => b === r.book); if (book) rec.book = book;
  return rec;
}

// 收藏：旧格式 string[] 自动升级为 FavRecord[]，保留顺序，按 id 去重
export function loadFavorites(): FavRecord[] {
  const raw = readRaw(K.fav);
  if (!Array.isArray(raw)) return [];
  const out: FavRecord[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const rec = sanitizeFav(raw[i], i);
    if (!rec || seen.has(rec.id)) continue;
    seen.add(rec.id);
    out.push(rec);
  }
  return out;
}

const writeFav = (list: FavRecord[]) => { writeItem(K.fav, JSON.stringify(list)); return list; };
export const saveFavorites = (list: FavRecord[]) => writeFav(list);
export const addFavorite = (id: string, snap?: Partial<FavRecord>): FavRecord[] => {
  const l = loadFavorites();
  if (!l.some((r) => r.id === id)) l.unshift({ ...(sanitizeFav({ id, ...snap }, Date.now()) as FavRecord) });
  return writeFav(l);
};
export const removeFavorite = (id: string): FavRecord[] => writeFav(loadFavorites().filter((r) => r.id !== id));
export const updateFavorite = (id: string, patch: { note?: string; group?: string }): FavRecord[] => {
  const l = loadFavorites().map((r) => (r.id === id ? { ...r, ...patch } : r));
  return writeFav(l);
};
// 分组改名 / 取消分组：只改分组标签，收藏本身不删
export const renameGroup = (from: string, to: string): FavRecord[] => {
  const l = loadFavorites().map((r) => (r.group === from ? { ...r, group: to || undefined } : r));
  return writeFav(l);
};
export const clearGroup = (name: string): FavRecord[] => {
  const l = loadFavorites().map((r) => (r.group === name ? { ...r, group: undefined } : r));
  return writeFav(l);
};

function readList(key: string): string[] {
  const v = readRaw(key);
  return Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string'))] : [];
}
function writeList(key: string, list: string[]) { writeItem(key, JSON.stringify([...new Set(list)])); }

export const loadBlocklist = () => readList(K.block);
export const saveBlocklist = (list: string[]) => { writeList(K.block, list); return readList(K.block); };
export const addBlock = (id: string) => { const l = readList(K.block); if (!l.includes(id)) l.unshift(id); writeList(K.block, l); return l; };
export const removeBlock = (id: string) => { writeList(K.block, readList(K.block).filter((x) => x !== id)); return readList(K.block); };

export const loadSurname = () => readItem(K.surname) ?? '';
export const saveSurname = (s: string) => writeItem(K.surname, s);
export const loadReading = () => Number(readItem(K.reading) ?? '0');
export const saveReading = (n: number) => writeItem(K.reading, String(n));

export function loadTheme(): Theme {
  const t = readItem(K.theme);
  if (t === 'dark' || t === 'light' || t === 'system') return t;
  return 'system';
}
export const saveTheme = (t: Theme) => writeItem(K.theme, t);
export const prefersDark = () => !!(typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
export const resolveDark = (t: Theme) => t === 'dark' || (t === 'system' && prefersDark());
export const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];
export const THEME_LABEL: Record<Theme, string> = { light: '浅色', dark: '深色', system: '跟随系统' };

const POP_FLOORS = [0, 100, 500, 2000];

const DEFAULT: Opts = {
  gender: 'any', genderWeak: false, length: 2,
  books: Object.fromEntries(BOOK_ORDER.map((b) => [b, true])) as Opts['books'],
  redupOnly: false, exclude: [], count: 12, search: '', title: '', sort: 'score',
  strokeMax: 0, noMonotone: false, popFloor: 0,
  mustChar: '', mustPos: 'any',
};
export { DEFAULT as DEFAULT_OPTS };

// 越界＝不可信，整项回默认（不是夹到边界）；枚举值只认白名单
const intIn = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
const pickOne = <T extends string>(v: unknown, candidates: readonly T[]): T | undefined =>
  typeof v === 'string' && (candidates as readonly string[]).includes(v) ? (v as T) : undefined;

export function loadOpts(): Opts {
  try {
    const raw = readRaw(K.opts) as Partial<Opts> & { books?: Partial<Opts['books']> };
    // 书籍开关：只接受 boolean
    const books: Record<Book, boolean> = {} as Record<Book, boolean>;
    for (const b of BOOK_ORDER) books[b] = typeof raw.books?.[b] === 'boolean' ? raw.books[b] as boolean : DEFAULT.books[b];
    // 长度：只接受 1 或 2
    const length = raw.length === 1 ? 1 : 2;
    return {
      ...DEFAULT,
      gender: pickOne<Gender>(raw.gender, ['any', 'f', 'm']) ?? DEFAULT.gender,
      genderWeak: !!raw.genderWeak,
      length,
      redupOnly: length === 2 && !!raw.redupOnly,
      books,
      count: intIn(raw.count, 0, 600) ?? DEFAULT.count,
      search: typeof raw.search === 'string' ? raw.search.slice(0, SEARCH_MAX) : DEFAULT.search,
      title: typeof raw.title === 'string' ? raw.title.slice(0, TITLE_MAX) : DEFAULT.title,
      sort: pickOne(raw.sort, SORTS) ?? DEFAULT.sort,
      strokeMax: intIn(raw.strokeMax, 0, 64) ?? DEFAULT.strokeMax,
      noMonotone: !!raw.noMonotone,
      popFloor: POP_FLOORS.includes(Number(raw.popFloor)) ? Number(raw.popFloor) : DEFAULT.popFloor,
      mustChar: typeof raw.mustChar === 'string' && /^[一-鿿]$/.test(raw.mustChar) ? raw.mustChar : DEFAULT.mustChar,
      mustPos: pickOne(raw.mustPos, ['any', 'first', 'last'] as const) ?? DEFAULT.mustPos,
    };
  } catch { return DEFAULT; }
}
export const saveOpts = (o: Opts) => writeItem(K.opts, JSON.stringify({ gender: o.gender, genderWeak: o.genderWeak, length: o.length, redupOnly: o.redupOnly, books: o.books, count: o.count, search: o.search.slice(0, SEARCH_MAX), sort: o.sort, strokeMax: o.strokeMax, noMonotone: o.noMonotone, popFloor: o.popFloor, mustChar: o.mustChar, mustPos: o.mustPos, title: (o.title ?? '').slice(0, TITLE_MAX) }));

export type ComposeDraft = { length: 1 | 2; chars: string[]; free: boolean };
export function loadCompose(): ComposeDraft {
  const raw = readRaw(K.compose);
  if (!raw || typeof raw !== 'object') return { length: 2, chars: [], free: false };
  const r = raw as Record<string, unknown>;
  const chars = Array.isArray(r.chars) ? r.chars.filter((c): c is string => typeof c === 'string' && /^[一-鿿]$/.test(c)).slice(0, 2) : [];
  return { length: r.length === 1 ? 1 : 2, chars, free: !!r.free };
}
export const saveCompose = (d: ComposeDraft) => writeItem(K.compose, JSON.stringify(d));

export const FAV_KEY = K.fav;
export const BLOCK_KEY = K.block;
