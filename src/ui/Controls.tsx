import { useState } from 'react';
import { cleanSurname, readings, surnameReads } from '../engine/name';
import { BOOK_LABEL, BOOK_ORDER, POP_FLOORS, STROKE_MAXES, type Book, type Gender, type Opts, type SortKey } from '../engine/types';

const GENDERS: { v: Gender; label: string; color: string }[] = [
  { v: 'any', label: '不限', color: '' },
  { v: 'm', label: '偏男', color: 'bg-sky-50 text-sky-800 ring-sky-200' },
  { v: 'f', label: '偏女', color: 'bg-pink-50 text-pink-800 ring-pink-200' },
];
const PRESETS = [12, 24, 48];
const SORTS: { v: SortKey; label: string }[] = [
  { v: 'score', label: '按分数' },
  { v: 'strokes', label: '笔画少→多' },
  { v: 'popular', label: '用字常见度' },
  { v: 'book', label: '按出处' },
];

function poolSummary(poolCount: number, perPage: number, pages: number, pageNo: number): string {
  const parts: string[] = [];
  if (poolCount > 0) {
    parts.push(`池内 ${poolCount} 条`);
    if (pages > 1 && perPage > 0) parts.push(`${perPage}×${pages}页·第${pageNo + 1}页`);
    else if (pages === 1 && perPage > 0) parts.push('一屏全展');
  }
  return parts.join(' · ');
}

export default function Controls({ surname, setSurname, reading, setReading, opts, setOpts, poolCount, pageNo, pages, onBatch }: {
  surname: string; setSurname: (s: string) => void;
  reading: number; setReading: (n: number) => void;
  opts: Opts; setOpts: React.Dispatch<React.SetStateAction<Opts>>;
  poolCount: number;
  pageNo: number; pages: number; onBatch: () => void;
}) {
  const sur = cleanSurname(surname);
  const surReadCount = surnameReads(sur);
  const surReads = sur.length > 0 && surReadCount > 1 ? readings(sur[0]) : [];
  const pick = Math.min(reading, surReads.length - 1);
  const perPage = opts.count === 0 ? poolCount : opts.count;
  const patch = (p: Partial<Opts>) => setOpts((o) => ({ ...o, ...p }));
  const toggleBook = (b: Book) => setOpts((o) => ({ ...o, books: { ...o.books, [b]: !o.books[b] } }));

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
      {/* Primary controls */}
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">姓（可复姓）</span>
          <input value={surname} onChange={(e) => setSurname(e.target.value)} onBlur={() => setSurname(sur)}
            placeholder="如 苏 / 欧阳" aria-label="姓氏"
            className="w-32 rounded border border-neutral-300 dark:border-neutral-700 px-3 py-2 font-serif text-lg outline-none focus:border-neutral-500" />
        </label>
        {surReads.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">{sur.length > 1 ? `姓首字「${sur[0]}」的读音` : '姓的读音（多音姓请选）'}</span>
            <select value={pick} onChange={(e) => setReading(Number(e.target.value))}
              className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-2 text-sm">
              {surReads.map((r, i) => <option key={i} value={i}>{sur[0]} {r.mark}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">名字字数</span>
          <div className="flex gap-1">
            {([2, 1] as const).map((n) => (
              <button key={n} onClick={() => patch(n === 1 ? { length: 1, redupOnly: false } : { length: 2 })}
                className={`rounded px-3 py-2 text-sm ring-1 ${opts.length === n ? 'bg-neutral-900 text-white ring-neutral-900' : 'ring-neutral-200 dark:ring-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'}`}>
                {n === 2 ? '双名' : '单名'}
              </button>
            ))}
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500" title="选定后反向名不进候选池">性别风格</span>
          <div className="flex gap-1">
            {GENDERS.map((g) => (
              <button key={g.v} onClick={() => patch({ gender: g.v })}
                className={`rounded px-3 py-2 text-sm ring-1 ${opts.gender === g.v ? (g.color ? `${g.color} ring-current` : 'bg-neutral-900 text-white ring-neutral-900') : 'ring-neutral-200 dark:ring-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'}`}>
                {g.label}
              </button>
            ))}
          </div>
        </label>
        {opts.gender !== 'any' && (
          <button onClick={() => patch({ genderWeak: !opts.genderWeak })} title="疑似＝只有一个字在性别字表里，其余字两侧都不在"
            className={`self-center rounded-full px-3 py-1 text-xs ring-1 ${opts.genderWeak ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'text-neutral-500 dark:text-neutral-400 ring-neutral-200 dark:ring-neutral-700'}`}>
            含「疑似{opts.gender === 'f' ? '偏女' : '偏男'}」
          </button>
        )}
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500" title="决定一屏几条，也决定要翻几页">每批条数</span>
          <select value={opts.count === 0 ? 'all' : String(opts.count)}
            onChange={(e) => patch({ count: e.target.value === 'all' ? 0 : Number(e.target.value) })}
            className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-2 text-sm">
            {PRESETS.map((n) => <option key={n} value={String(n)}>{n} 条</option>)}
            {opts.count > 0 && opts.count < poolCount && !PRESETS.includes(opts.count) && (
              <option value={String(opts.count)}>{opts.count} 条</option>
            )}
            <option value="all">全部 {poolCount} 条</option>
          </select>
        </label>
        <button onClick={onBatch} className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">
          换一批{pages > 1 ? ` · ${pageNo + 1}/${pages}` : ''}
        </button>
      </div>

      {/* Search + Sort */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">搜索</span>
          <input value={opts.search} onChange={(e) => patch({ search: e.target.value })} aria-label="搜索名字、拼音或篇名"
            placeholder="名字 / 拼音 / 篇名" className="w-44 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1.5 text-sm outline-none focus:border-neutral-500" />
          {opts.search && <button onClick={() => patch({ search: '' })} aria-label="清除搜索"
            className="rounded px-2 py-1 text-xs text-neutral-500 ring-1 ring-neutral-200 dark:ring-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800">清除</button>}
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">排序</span>
          <select value={opts.sort} onChange={(e) => patch({ sort: e.target.value as SortKey })} aria-label="结果排序"
            className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1.5 text-sm">
            {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {/* Advanced filters (collapsible) */}
      <AdvancedFilters opts={opts} patch={patch} toggleBook={toggleBook} />

      {/* 池内计数常驻：筛选折叠起来时也要看得见命中多少 */}
      <p className="text-xs tabular-nums text-neutral-500" title="「换一批」往后翻，翻满页数看遍全部">
        {poolSummary(poolCount, perPage, pages, pageNo)}
      </p>
    </section>
  );
}

function AdvancedFilters({ opts, patch, toggleBook }: {
  opts: Opts; patch: (p: Partial<Opts>) => void; toggleBook: (b: Book) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
        <svg className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="currentColor">
          <path d="M4.5 2l5 4-5 4z" />
        </svg>
        {open ? '收起筛选' : '高级筛选'}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {/* Fact-based filters */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">整名笔画</span>
              <select value={opts.strokeMax} onChange={(e) => patch({ strokeMax: Number(e.target.value) })} aria-label="整名笔画上限"
                className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1.5 text-sm">
                {STROKE_MAXES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">用字常见度</span>
              <select value={opts.popFloor} onChange={(e) => patch({ popFloor: Number(e.target.value) })} aria-label="用字常见度下限"
                className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1.5 text-sm">
                {POP_FLOORS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
            </label>
            {opts.length === 2 && (
              <button onClick={() => patch({ noMonotone: !opts.noMonotone })} aria-pressed={opts.noMonotone}
                title="两字结构相同（都是左右/上下…）时字形偏单调，勾上只看不同结构的"
                className={`rounded-full px-3 py-1 text-xs ring-1 ${opts.noMonotone ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'text-neutral-500 dark:text-neutral-400 ring-neutral-200 dark:ring-neutral-700'}`}>
                避开同结构
              </button>
            )}
          </div>

          {/* Books */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500">典籍</span>
            {BOOK_ORDER.map((b) => (
              <button key={b} onClick={() => toggleBook(b)}
                className={`rounded-full px-3 py-1 text-xs ring-1 ${opts.books[b] ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'text-neutral-500 dark:text-neutral-400 ring-neutral-200 dark:ring-neutral-700'}`}>
                {BOOK_LABEL[b]}
              </button>
            ))}
            {opts.length === 2 && (
              <button onClick={() => patch({ redupOnly: !opts.redupOnly })} title="单名层没有叠字，切到双名才能筛"
                className={`rounded-full px-3 py-1 text-xs ring-1 ${opts.redupOnly ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'text-neutral-500 dark:text-neutral-400 ring-neutral-200 dark:ring-neutral-700'}`}>
                只看典籍叠字
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
