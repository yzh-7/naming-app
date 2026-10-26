// 导出/导入与「可分享链接」的编解码。全部是纯函数，便于单测。
import type { Book, Opts } from '../engine/types';
import { BOOK_ORDER, cleanSurname } from '../engine/types';
import { DEFAULT_OPTS, SEARCH_MAX, TITLE_MAX, sanitizeFav, sanitizeOpts, sanitizeReading, type FavRecord } from './local';

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

// 姓氏与读音不进 opts（它们不是筛选条件），但清洗规则同样只有一份：姓用 engine 的 cleanSurname，
// 读音用 local 的 sanitizeReading。三条路径口径相同：非法取值回默认（''/0）。
const cleanSur = (s: unknown) => (typeof s === 'string' ? cleanSurname(s) : '');

export function buildState(p: { surname: string; reading: number; opts: Opts; favorites: FavRecord[]; blocklist: string[] }): SavedState {
  return { app: 'naming-app', version: 1, exportedAt: new Date().toISOString(), ...p };
}
export const serialize = (s: SavedState) => JSON.stringify(s, null, 2);

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
      surname: cleanSur(r.surname),
      reading: sanitizeReading(r.reading) ?? 0,
      opts: sanitizeOpts(r.opts),
      favorites: favs,
      blocklist: blocks,
    },
  };
}

// URL：只带轻量筛选（姓氏/读音/性别/字数/条数/搜索/排序/典籍位），收藏与拉黑留在本机。
// 只写非默认项，所以默认筛选产生空串；reading 与 opts 的取值规则不在这里重复一遍——
// 参数文本先解码成 opts 的字段名，再交给 local.ts 的 sanitizeOpts（与本机存储、导入文件同一套）。
export function toQuery(s: Pick<SavedState, 'surname' | 'reading' | 'opts'>): string {
  const q = new URLSearchParams();
  if (s.surname) q.set('s', s.surname);
  if (s.reading) q.set('r', String(s.reading));
  const o = s.opts;
  if (o.gender !== 'any') q.set('g', o.gender);
  // genderWeak 只在性别筛选开着时才起作用，不起作用就不占链接长度
  if (o.genderWeak && o.gender !== 'any') q.set('gw', '1');
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
  if (o.avoidChars) q.set('ac', o.avoidChars);
  return q.toString();
}

// 典籍位：按 BOOK_ORDER 顺序的 0/1 串。兼容旧链接——书数增加后，短一位一律按「新书默认开」补齐
function booksFromBits(bits: string): Record<Book, boolean> | null {
  if (!/^[01]{6,}$/.test(bits)) return null;
  const padded = bits.length < BOOK_ORDER.length ? bits + '1'.repeat(BOOK_ORDER.length - bits.length) : bits.slice(0, BOOK_ORDER.length);
  return Object.fromEntries(BOOK_ORDER.map((k, i) => [k, padded[i] === '1'])) as Record<Book, boolean>;
}

// 返回的 opts 只包含链接里出现过的项：没出现的项保持本机值，出现过的项一律经过同一套消毒
// （取值不认识时按规则回默认，不是忽略这一项）。姓氏与读音同样「出现即进入状态」。
export function fromQuery(qs: string): { surname?: string; reading?: number; opts: Partial<Opts> } | null {
  const q = new URLSearchParams(qs);
  if (![...q.keys()].length) return null;
  const raw: Record<string, unknown> = {};
  const seen = new Set<string>();
  const take = (key: string, value: unknown) => { raw[key] = value; seen.add(key); };

  if (q.has('g')) take('gender', q.get('g'));
  if (q.has('gw')) take('genderWeak', q.get('gw') === '1'); // 布尔参数只认 '1'
  if (q.has('len')) take('length', Number(q.get('len')));
  const n = q.get('n');
  if (n !== null) take('count', n === 'all' ? 0 : Number(n));
  if (q.has('q')) take('search', q.get('q'));
  if (q.has('t')) take('title', q.get('t'));
  if (q.has('o')) take('sort', q.get('o'));
  if (q.has('sm')) take('strokeMax', Number(q.get('sm')));
  if (q.has('nm')) take('noMonotone', q.get('nm') === '1');
  if (q.has('pf')) take('popFloor', Number(q.get('pf')));
  if (q.has('b')) take('books', booksFromBits(q.get('b') ?? '') ?? {});
  if (q.has('d')) take('redupOnly', q.get('d') === '1');
  if (q.has('mc')) take('mustChar', q.get('mc'));
  if (q.has('mp')) take('mustPos', q.get('mp'));
  if (q.has('ac')) take('avoidChars', q.get('ac'));

  const full = sanitizeOpts(raw);
  const opts: Partial<Opts> = {};
  for (const key of seen) (opts as Record<string, unknown>)[key] = (full as unknown as Record<string, unknown>)[key];

  const surname = q.has('s') ? cleanSur(q.get('s')) : undefined;
  const reading = q.has('r') ? sanitizeReading(q.get('r')) ?? 0 : undefined;
  return { surname, reading, opts };
}
