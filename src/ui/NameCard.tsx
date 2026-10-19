import { glossOf, lineGlossOf, nicknames, polyphoneTags, popularity, radicalTags, shapeTags } from '../engine/name';
import { BOOK_LABEL, type Result } from '../engine/types';

const WINDOW_MAX = 28;

type Win = { start: number; end: number; cutLeft: boolean; cutRight: boolean };

function windowAround(line: string, from: number, to: number): Win {
  if (line.length <= WINDOW_MAX) return { start: 0, end: line.length, cutLeft: false, cutRight: false };
  const parts: { from: number; to: number }[] = [];
  let from0 = 0;
  for (let i = 0; i < line.length; i++) {
    if ('，、；：'.includes(line[i])) {
      parts.push({ from: from0, to: i + 1 });
      from0 = i + 1;
    }
  }
  if (from0 < line.length) parts.push({ from: from0, to: line.length });
  const hit = parts.findIndex((p) => p.from <= from && p.to >= to);
  if (hit < 0) return { start: 0, end: line.length, cutLeft: false, cutRight: false };
  const lo = Math.max(0, hit - 1);
  const hi = Math.min(parts.length - 1, hit + 1);
  return { start: parts[lo].from, end: parts[hi].to, cutLeft: parts[lo].from > 0, cutRight: parts[hi].to < line.length };
}

function Source({ r }: { r: Result }) {
  const at = r.line.indexOf(r.seg);
  if (at < 0) {
    return (
      <div className="text-sm text-neutral-600 dark:text-neutral-300">
        <div>《{BOOK_LABEL[r.book]}·{r.title}{r.author ? `·${r.author}` : ''}》</div>
        <div className="mt-0.5">取词段「<mark className="bg-amber-100 px-0.5">{r.seg}</mark>」</div>
        <p className="mt-1.5 border-l-2 border-neutral-200 pl-2 text-xs leading-5 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          <span className="mr-1 rounded bg-neutral-100 px-1 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">今译</span>
          {lineGlossOf(r)}
        </p>
      </div>
    );
  }
  const gap = r.gap ?? 1;
  const hots = new Set(gap === 0 ? [at + r.foot] : [at + r.foot, at + r.foot + gap]);
  const spanFrom = Math.min(...hots);
  const spanTo = Math.max(...hots) + 1;
  const w = windowAround(r.line, spanFrom, spanTo);
  const pieces: { text: string; mark: boolean }[] = [];
  for (let i = w.start; i < w.end; i++) {
    const mark = hots.has(i);
    const last = pieces[pieces.length - 1];
    if (last && last.mark === mark) last.text += r.line[i];
    else pieces.push({ text: r.line[i], mark });
  }
  const where = gap === 0
    ? `取词段第 ${r.foot + 1} 字`
    : gap === 1
      ? `取词段第 ${r.foot + 1}–${r.foot + 2} 字`
      : `取词段第 ${r.foot + 1} 与第 ${r.foot + gap + 1} 字（中间隔 ${gap - 1} 字）`;
  return (
    <div className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">
      {w.cutLeft && <span className="text-neutral-500 dark:text-neutral-400">…</span>}
      {pieces.map((p, i) => p.mark
        ? <mark key={i} className="rounded bg-amber-100 px-0.5 font-medium text-neutral-900 dark:text-neutral-100">{p.text}</mark>
        : <span key={i}>{p.text}</span>)}
      {w.cutRight ? <span className="text-neutral-500 dark:text-neutral-400">…</span> : <span className="text-neutral-500 dark:text-neutral-400">。</span>}
      <div className="mt-0.5 text-xs text-neutral-500">
        《{BOOK_LABEL[r.book]}·{r.title}{r.author ? `·${r.author}` : ''}》 · {where}
        {gap > 1 && ' · 跨字取词，看原文自辨'}
        {!r.strict && ' · 长短句/散文宽口径'}
      </div>
      <p className="mt-1.5 border-l-2 border-neutral-200 pl-2 text-xs leading-5 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        <span className="mr-1 rounded bg-neutral-100 px-1 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">今译</span>
        {lineGlossOf(r)}
      </p>
    </div>
  );
}

export default function NameCard({ r, fav, blocked, onFav, onBlock, onShare, onCopy }: {
  r: Result; fav: boolean; blocked: boolean; onFav: () => void; onBlock: () => void;
  onShare?: () => void; onCopy?: () => void;
}) {
  const marked = r.flags.filter((f) => !f.startsWith('同形'));
  const shadow = r.flags.filter((f) => f.startsWith('同形'));
  const g = r.gender;
  const rad = radicalTags(r.name);
  const gloss = [...new Set([...r.name])].map((ch) => ({ ch, g: glossOf(ch) })).filter((x): x is { ch: string; g: string } => !!x.g);
  const shape = shapeTags(r.name);
  const poly = polyphoneTags(r.name);
  const pop = popularity(r.name);
  const nns = nicknames(r.name);
  const gBadge = g.side === 'n' ? null
    : `${g.strong ? '' : '疑似'}${g.side === 'f' ? '偏女' : '偏男'}`;
  return (
    <article className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-3xl tracking-wider text-neutral-900 dark:text-neutral-100">{r.full}</h3>
        <span className="text-xs tabular-nums text-neutral-500">{r.total} 分</span>
      </div>
      <div className="mt-1 text-sm text-neutral-500">{r.readings.join(' ')}</div>
      {gloss.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
          {gloss.map((x) => (
            <span key={x.ch}><span className="font-serif text-sm text-neutral-900 dark:text-neutral-100">{x.ch}</span> {x.g}</span>
          ))}
        </div>
      )}
      {(shape.chars.some((c) => c.sx) || poly.length > 0 || pop.lead) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {shape.chars.filter((c) => c.sx).map((c) => (
            <span key={c.ch} className="rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-600 dark:text-neutral-300">
              {c.ch}·{c.sx}{c.st ? ` ${c.st}画` : ''}
            </span>
          ))}
          {shape.strokes > 0 && <span className="text-xs text-neutral-500 dark:text-neutral-400">共 {shape.strokes} 画</span>}
          {shape.note && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-100">{shape.note}</span>}
          {pop.lead && (
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-800 ring-1 ring-violet-100"
              title={`用字常见度是估算：依据 114 万真实姓名去姓后的用字频次（${pop.chars.map((c) => `${c.ch} ${c.band}`).join('、')}），不是户籍重名率`}>
              用字常见度 {pop.band}
            </span>
          )}
          {poly.map((p) => (
            <span key={p.ch} className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800 ring-1 ring-sky-100">
              多音 {p.ch} {p.reads.join('/')}
            </span>
          ))}
        </div>
      )}
      {nns.length > 0 && (
        <div className="mt-1.5 text-xs text-neutral-500">小名：{nns.join(' · ')}</div>
      )}
      {rad.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5"
          title="部首提示＝该字在康熙字典里所属的部首，只标落在 木/火/水/金/土 五部的字，其余留白（留白不代表该字无五行）。本应用不做五行筛选、不判吉凶。">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">部首</span>
          {rad.map((x) => (
            <span key={x.ch} className="rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-600 dark:text-neutral-300">{x.ch}·{x.el}部</span>
          ))}
        </div>
      )}
      {gBadge && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800 ring-1 ring-sky-100">{gBadge}</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{g.why}</span>
        </div>
      )}
      <div className="mt-3"><Source r={r} /></div>
      {(marked.length > 0 || shadow.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {marked.map((f) => (
            <span key={f} className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 ring-1 ring-red-100">{f}</span>
          ))}
          {shadow.map((f) => (
            <span key={f} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-100">{f}</span>
          ))}
        </div>
      )}
      <details className="mt-3 text-xs text-neutral-600 dark:text-neutral-300 no-print">
        <summary className="cursor-pointer select-none text-neutral-500">分数明细</summary>
        <ul className="mt-1.5 space-y-0.5">
          {r.deltas.map((d) => (
            <li key={d.rule} className="flex justify-between gap-4">
              <span>{d.rule}</span>
              <span className={`tabular-nums ${d.delta < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{d.delta > 0 ? `+${d.delta}` : d.delta}</span>
            </li>
          ))}
        </ul>
      </details>
      <div className="mt-3 flex flex-wrap gap-2 no-print">
        <button onClick={onFav} className={`rounded px-3 py-1 text-sm ring-1 ${fav ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'text-neutral-600 dark:text-neutral-300 ring-neutral-200 dark:ring-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'}`}>
          {fav ? '已收藏' : '收藏'}
        </button>
        <button onClick={onBlock} className={`rounded px-3 py-1 text-sm ring-1 ${blocked ? 'bg-red-50 text-red-700 ring-red-200' : 'text-neutral-600 dark:text-neutral-300 ring-neutral-200 dark:ring-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'}`}>
          {blocked ? '已拉黑（点取消）' : '不再看它'}
        </button>
        {onCopy && <button onClick={onCopy} className="rounded px-3 py-1 text-sm text-neutral-600 dark:text-neutral-300 ring-1 ring-neutral-200 dark:ring-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800">复制信息</button>}
        {onShare && <button onClick={onShare} className="rounded px-3 py-1 text-sm text-neutral-600 dark:text-neutral-300 ring-1 ring-neutral-200 dark:ring-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800">分享卡</button>}
      </div>
    </article>
  );
}
