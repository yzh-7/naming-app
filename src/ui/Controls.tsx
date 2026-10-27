import { useEffect, useRef, useState } from 'react';
import { cleanSurname, POOL_TITLES, readings, surnameReads } from '../engine/name';
import {
  AVOID_MAX,
  BOOK_LABEL,
  BOOK_ORDER,
  MUST_POS_LABEL,
  POP_FLOORS,
  STROKE_MAXES,
  cleanAvoid,
  isHan,
  type Book,
  type Gender,
  type MustPos,
  type Opts,
  type SortKey,
} from '../engine/types';

const GENDERS: { v: Gender; label: string; on: string }[] = [
  { v: 'any', label: '不限', on: 'seg-on' },
  { v: 'm', label: '偏男', on: 'seg-cool' } /* 选中态：冷色，与卡片上的偏男同色 */,
  { v: 'f', label: '偏女', on: 'seg-warm' } /* 选中态：暖色，与卡片上的偏女同色 */,
];
const PRESETS = [12, 24, 48];
const SORTS: { v: SortKey; label: string }[] = [
  { v: 'score', label: '按分数' },
  { v: 'strokes', label: '笔画少→多' },
  { v: 'popular', label: '用字常见度' },
  { v: 'book', label: '按出处' },
];

const fmt = (n: number) => n.toLocaleString('en-US');

function poolSummary(poolCount: number, perPage: number, pages: number, pageNo: number): string {
  const parts: string[] = [];
  if (poolCount > 0) {
    parts.push(`候选池 ${fmt(poolCount)} 条`);
    if (pages > 1 && perPage > 0) parts.push(`${perPage}×${pages}页·第${pageNo + 1}页`);
    else if (pages === 1 && perPage > 0) parts.push('一屏全展');
  }
  return parts.join(' · ');
}

/**
 * 汉字输入框。值不由 React 回填：中文输入法组字时框里先出现拉丁字母，回填会把组字打断。
 * 也不能用 key={value} 逼它重建——实测第一个字上屏后焦点掉到 <body>、第二个字直接落空。
 * 这里只在「外部改值」（点「不限」、导入文件、带参数的链接）且框不是当前焦点时把 DOM 拉回状态值，
 * 打字途中 DOM 与状态可以短暂不一致（拉丁字母、超出上限的字），失焦时对齐。
 */
function CharField({
  value,
  onInput,
  maxLength,
  ariaLabel,
  placeholder,
  className,
}: {
  value: string;
  onInput: (raw: string) => void;
  maxLength: number;
  ariaLabel: string;
  placeholder: string;
  className: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el !== document.activeElement && el.value !== value) el.value = value;
  }, [value]);
  return (
    <input
      ref={ref}
      defaultValue={value}
      onChange={(e) => onInput(e.target.value)}
      onBlur={(e) => {
        e.target.value = value;
      }}
      maxLength={maxLength}
      aria-label={ariaLabel}
      placeholder={placeholder}
      className={className}
    />
  );
}

export default function Controls({
  surname,
  setSurname,
  reading,
  setReading,
  opts,
  setOpts,
  poolCount,
  pageNo,
  pages,
  onBatch,
}: {
  surname: string;
  setSurname: (s: string) => void;
  reading: number;
  setReading: (n: number) => void;
  opts: Opts;
  setOpts: React.Dispatch<React.SetStateAction<Opts>>;
  poolCount: number;
  pageNo: number;
  pages: number;
  onBatch: () => void;
}) {
  const sur = cleanSurname(surname);
  const surReadCount = surnameReads(sur);
  const surReads = sur.length > 0 && surReadCount > 1 ? readings(sur[0]) : [];
  const pick = Math.min(reading, surReads.length - 1);
  const perPage = opts.count === 0 ? poolCount : opts.count;
  const patch = (p: Partial<Opts>) => setOpts((o) => ({ ...o, ...p }));
  const toggleBook = (b: Book) => setOpts((o) => ({ ...o, books: { ...o.books, [b]: !o.books[b] } }));

  return (
    <section className="card space-y-4">
      {/* 第一组：姓、读音、名字形态、批量。手机端两列栅格，桌面一行流式 */}
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:flex sm:flex-wrap sm:items-end sm:gap-4">
        <label className="col-span-full">
          <span className="lab mb-1">姓（可复姓）</span>
          <input
            value={surname}
            onChange={(e) => setSurname(e.target.value)}
            onBlur={() => setSurname(sur)}
            placeholder="如 苏 / 欧阳"
            className="field w-full font-serif text-title sm:w-40"
          />
        </label>
        {surReads.length > 1 && (
          <label className="block">
            <span className="lab mb-1">{sur.length > 1 ? `姓首字「${sur[0]}」的读音` : '姓的读音（多音姓请选）'}</span>
            <select value={pick} onChange={(e) => setReading(Number(e.target.value))} className="field w-full">
              {surReads.map((r, i) => (
                <option key={i} value={i}>
                  {sur[0]} {r.mark}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="lab mb-1" title="决定一屏几条，也决定要翻几页">
            每批条数
          </span>
          <select
            value={opts.count === 0 ? 'all' : String(opts.count)}
            onChange={(e) => patch({ count: e.target.value === 'all' ? 0 : Number(e.target.value) })}
            className="field w-full sm:w-auto"
          >
            {PRESETS.map((n) => (
              <option key={n} value={String(n)}>
                {n} 条
              </option>
            ))}
            {opts.count > 0 && opts.count < poolCount && !PRESETS.includes(opts.count) && (
              <option value={String(opts.count)}>{opts.count} 条</option>
            )}
            <option value="all">全部 {fmt(poolCount)} 条</option>
          </select>
        </label>
        <label className="col-span-full sm:block">
          <span className="lab mb-1">名字字数</span>
          <div className="seg w-full sm:w-auto" role="group" aria-label="名字字数">
            {([2, 1] as const).map((n) => (
              <button
                key={n}
                onClick={() => patch(n === 1 ? { length: 1, redupOnly: false } : { length: 2 })}
                aria-pressed={opts.length === n}
                className={`seg-btn flex-1 sm:flex-none ${opts.length === n ? 'seg-on' : ''}`}
              >
                {n === 2 ? '双名' : '单名'}
              </button>
            ))}
          </div>
        </label>
        <label className="col-span-full sm:block">
          <span className="lab mb-1" title="选定后反向名不进候选池">
            性别风格
          </span>
          <div className="seg w-full sm:w-auto" role="group" aria-label="性别风格">
            {GENDERS.map((g) => (
              <button
                key={g.v}
                onClick={() => patch({ gender: g.v })}
                aria-pressed={opts.gender === g.v}
                className={`seg-btn flex-1 sm:flex-none ${opts.gender === g.v ? g.on : ''}`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </label>
        {opts.gender !== 'any' && (
          <button
            onClick={() => patch({ genderWeak: !opts.genderWeak })}
            aria-pressed={opts.genderWeak}
            title="疑似＝只有一个字在性别字表里，其余字两侧都不在"
            className={`chip self-start ${opts.genderWeak ? 'chip-warm' : ''}`}
          >
            含「疑似{opts.gender === 'f' ? '偏女' : '偏男'}」
          </button>
        )}
        <button onClick={onBatch} className="btn-primary col-span-full sm:ml-auto">
          换一批{pages > 1 ? ` · ${pageNo + 1}/${pages}` : ''}
        </button>
      </div>

      {/* 第二组：搜索、指定字、排序 */}
      <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <label className="flex items-center gap-2">
          <span className="lab shrink-0">搜索</span>
          <input
            value={opts.search}
            onChange={(e) => patch({ search: e.target.value })}
            aria-label="搜索名字、拼音或篇名"
            placeholder="名字 / 拼音 / 篇名"
            maxLength={40}
            className="field w-full sm:w-44"
          />
          {opts.search && (
            <button onClick={() => patch({ search: '' })} aria-label="清除搜索" className="btn">
              清除
            </button>
          )}
        </label>
        <label className="flex items-center gap-2">
          <span
            className="lab shrink-0"
            title="只保留这一篇里的候选。篇名可以从卡片上的「同篇候选」进来，也可以在这里直接写"
          >
            篇名
          </span>
          <input
            value={opts.title}
            onChange={(e) => patch({ title: e.target.value })}
            list="pool-titles"
            aria-label="篇名（只看这一篇）"
            placeholder={opts.title ? '' : '如 离骚'}
            maxLength={14}
            className="field w-full sm:w-44"
          />
          <datalist id="pool-titles">
            {POOL_TITLES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {opts.title && (
            <button onClick={() => patch({ title: '' })} aria-label="不限篇名" className="btn">
              不限篇
            </button>
          )}
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <span className="lab shrink-0" title="结果里每条名字都必须含这个字；双名还能限定它当首字或末字">
            指定字
          </span>
          {/* 指定字：一个字。maxLength 2 是给拼音组字留位置（1 会让输入法打不出拼音） */}
          <CharField
            value={opts.mustChar}
            onInput={(raw) => patch({ mustChar: [...raw].find(isHan) ?? '' })}
            maxLength={2}
            ariaLabel="指定用字（结果必须包含）"
            placeholder="如 清"
            className="field w-16 text-center font-serif text-title sm:w-20"
          />
          {opts.mustChar && opts.length === 2 && (
            <select
              value={opts.mustPos}
              onChange={(e) => patch({ mustPos: e.target.value as MustPos })}
              aria-label="指定字的位置"
              className="field w-full sm:w-auto"
            >
              {(['any', 'first', 'last'] as const).map((p) => (
                <option key={p} value={p}>
                  {MUST_POS_LABEL[p]}
                </option>
              ))}
            </select>
          )}
          {opts.mustChar && (
            <button onClick={() => patch({ mustChar: '' })} aria-label="清除指定字" className="btn">
              不限制
            </button>
          )}
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <span
            className="lab shrink-0"
            title="名里出现其中任何一个字，这条候选就不出现（只查名，不查姓）。用于避长辈名讳、家里忌讳的字"
          >
            禁用字
          </span>
          <CharField
            value={opts.avoidChars}
            onInput={(raw) => patch({ avoidChars: cleanAvoid(raw) })}
            maxLength={AVOID_MAX + 4}
            ariaLabel="禁用字（名里出现这些字的候选不出现）"
            placeholder="如 艳涛"
            className="field w-24 text-center font-serif text-title sm:w-28"
          />
          {/* 上限写在这里而不是只写在 title 里：触屏没有 hover，框里能多打几个字（给拼音组字留的位置）也要说明白 */}
          <span className="text-meta text-ink-3 tabular-nums" role="status">
            已填 {[...opts.avoidChars].length}/{AVOID_MAX} 个字
          </span>
          {opts.avoidChars && (
            <button onClick={() => patch({ avoidChars: '' })} aria-label="清除禁用字" className="btn">
              不限
            </button>
          )}
        </label>
        <label className="flex items-center gap-2">
          <span className="lab shrink-0">排序</span>
          <select
            value={opts.sort}
            onChange={(e) => patch({ sort: e.target.value as SortKey })}
            aria-label="结果排序"
            className="field w-full sm:w-auto"
          >
            {SORTS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 第三组：高级筛选（默认收起，手机端少占屏） */}
      <AdvancedFilters opts={opts} patch={patch} toggleBook={toggleBook} />

      {/* 池内计数常驻：筛选折叠起来时也要看得见命中多少 */}
      <p className="measure text-meta tabular-nums text-ink-3" title="「换一批」往后翻，翻满页数看遍全部">
        {poolSummary(poolCount, perPage, pages, pageNo)}
      </p>
      {opts.mustChar && poolCount === 0 && (
        <p role="status" className="measure rounded-card border border-warn-line bg-warn-soft p-3 text-meta text-warn">
          典籍里没有含「{opts.mustChar}」的可用搭配（这个字多半不在名用字表，或所在句读配不出符合其它条件的名字）。
          可换个字，或到{' '}
          <a className="text-accent-ink underline" href="#/compose">
            自选页
          </a>{' '}
          自由搭配这个字并逐字核对事实。
        </p>
      )}
      {opts.avoidChars && poolCount === 0 && (
        <p role="status" className="measure rounded-card border border-warn-line bg-warn-soft p-3 text-meta text-warn">
          禁用字「{opts.avoidChars}」也在收窄结果：先点「不限」，看是不是这几个字把这一池滤空了。
        </p>
      )}
    </section>
  );
}

function AdvancedFilters({
  opts,
  patch,
  toggleBook,
}: {
  opts: Opts;
  patch: (p: Partial<Opts>) => void;
  toggleBook: (b: Book) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="adv-filters"
        className="btn w-full sm:w-auto"
      >
        <svg
          className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4.5 2l5 4-5 4z" />
        </svg>
        {open ? '收起筛选' : '高级筛选'}
      </button>
      {open && (
        <div id="adv-filters" className="mt-3 space-y-3">
          {/* Fact-based filters */}
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">
            <label className="flex items-center gap-2">
              <span className="lab shrink-0">整名笔画</span>
              <select
                value={opts.strokeMax}
                onChange={(e) => patch({ strokeMax: Number(e.target.value) })}
                aria-label="整名笔画上限"
                className="field w-full sm:w-auto"
              >
                {STROKE_MAXES.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="lab shrink-0">用字常见度</span>
              <select
                value={opts.popFloor}
                onChange={(e) => patch({ popFloor: Number(e.target.value) })}
                aria-label="用字常见度下限"
                className="field w-full sm:w-auto"
              >
                {POP_FLOORS.map((p) => (
                  <option key={p.v} value={p.v}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {opts.length === 2 && (
              <button
                onClick={() => patch({ noMonotone: !opts.noMonotone })}
                aria-pressed={opts.noMonotone}
                title="两字结构相同（都是左右/上下…）时字形偏单调，勾上只看不同结构的"
                className={`chip self-start ${opts.noMonotone ? 'chip-ok' : ''}`}
              >
                避开同结构
              </button>
            )}
          </div>

          <p className="measure text-meta text-ink-3">
            「含疑似」＝只有一个字在性别字表里；「避开同结构」＝两字结构相同（都左右、都上下）时字形偏单调。
          </p>

          {/* Books */}
          <div className="space-y-2">
            <span className="lab">典籍</span>
            <div className="flex flex-wrap items-center gap-2">
              {BOOK_ORDER.map((b) => (
                <button
                  key={b}
                  onClick={() => toggleBook(b)}
                  aria-pressed={opts.books[b]}
                  className={`chip ${opts.books[b] ? 'chip-accent' : 'text-ink-3'}`}
                >
                  {BOOK_LABEL[b]}
                </button>
              ))}
              {opts.length === 2 && (
                <button
                  onClick={() => patch({ redupOnly: !opts.redupOnly })}
                  aria-pressed={opts.redupOnly}
                  title="单名层没有叠字，切到双名才能筛"
                  className={`chip ${opts.redupOnly ? 'chip-ok' : 'text-ink-3'}`}
                >
                  只看典籍叠字
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
