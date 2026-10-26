import { useMemo } from 'react';
import { glossOf, lineGlossOf, nicknames, polyphoneTags, popularity, radicalTags, sameSoundPeers, shapeTags } from '../engine/name';
import { BOOK_LABEL, type Book, type Result } from '../engine/types';

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

// 出处行只依赖这些字段：有出处的 Result、PoolItem、SingleItem 都满足，自选页可复用同一套渲染
export type SourceRef = {
  book: Book; title: string; author: string; line: string;
  seg: string; foot: number; gap: number; lg: number; strict: boolean;
};

function sourceLabel(r: SourceRef) {
  return `《${BOOK_LABEL[r.book]}·${r.title}${r.author ? `·${r.author}` : ''}》`;
}

// 出处行：默认折叠，展开后显示原文高亮 + 今译
export function Source({ r }: { r: SourceRef }) {
  const at = r.line.indexOf(r.seg);
  if (at < 0) {
    return (
      <div className="text-meta text-ink-2">
        <div>{sourceLabel(r)}</div>
        <div className="mt-0.5">取词段「<mark className="rounded px-0.5">{r.seg}</mark>」</div>
        <p className="mt-1.5 border-l-2 border-line pl-2 text-meta text-ink-3">
          <span className="mr-1 rounded-ctl px-1 text-ink-3">今译</span>
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
    <div className="text-body text-ink-2">
      {w.cutLeft && <span className="text-ink-3">…</span>}
      {pieces.map((p, i) => {
        return p.mark
          ? <mark key={i} className="rounded px-0.5 font-medium">{p.text}</mark>
          : <span key={i}>{p.text}</span>;
      })}
      {w.cutRight ? <span className="text-ink-3">…</span> : <span className="text-ink-3">。</span>}
      <div className="mt-1 text-meta text-ink-3">
        {sourceLabel(r)} · {where}
        {gap > 1 && ' · 跨字取词，看原文自辨'}
        {!r.strict && ' · 长短句/散文宽口径'}
      </div>
      <p className="mt-1.5 border-l-2 border-line pl-2 text-meta text-ink-3">
        <span className="mr-1 rounded-ctl px-1 text-ink-3">今译</span>
        {lineGlossOf(r)}
      </p>
    </div>
  );
}

export default function NameCard({ r, fav, blocked, onFav, onBlock, onShare, onCopy, onTitle, onSameSound, sameTitle }: {
  r: Result; fav: boolean; blocked: boolean; onFav: () => void; onBlock: () => void;
  onShare?: () => void; onCopy?: () => void;
  // 按篇看：把筛选收窄到这一篇；按音看：把搜索换成这个名字的拼音（去声调）
  onTitle?: () => void; onSameSound?: () => void;
  // 这一篇在当前筛选后还剩多少条（含自己）。由调用方按候选池算好传进来：
  // 按全语料算的话，设了禁用字、性别或典籍之后按钮写 5 条、点进去只有 2 条
  sameTitle?: number;
}) {
  const marked = r.flags.filter((f) => !f.startsWith('同形'));
  const shadow = r.flags.filter((f) => f.startsWith('同形'));
  const g = r.gender;
  const rad = radicalTags(r.name);
  const gloss = useMemo(() => [...new Set([...r.name])].map((ch) => ({ ch, g: glossOf(ch) })).filter((x): x is { ch: string; g: string } => !!x.g), [r.name]);
  const shape = useMemo(() => shapeTags(r.name), [r.name]);
  const poly = useMemo(() => polyphoneTags(r.name), [r.name]);
  const pop = useMemo(() => popularity(r.name), [r.name]);
  const nns = nicknames(r.name);
  const peers = useMemo(() => sameSoundPeers(r.name, 4), [r.name]);

  // 性别标签：偏女=暖色、偏男=冷色（浅色/深色各有一套对比度达标的取值）
  const gBadge = useMemo(() => {
    if (g.side === 'n') return null;
    const weak = g.strong ? '' : '疑似';
    const side = g.side === 'f' ? '偏女' : '偏男';
    return { text: `${weak}${side}`, cls: g.side === 'f' ? 'chip-warm' : 'chip-cool' };
  }, [g]);

  const shapeShown = shape.chars.length > 0 || !!shape.note;

  return (
    <article className="card">
      {/* 第一层：名字本体（衬线放大）+ 读音 + 性别倾向 */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-serif text-name text-ink sm:text-name-lg">{r.full}</h3>
        {gBadge && (
          <span className={`chip ${gBadge.cls}`} title={g.why}>{gBadge.text}</span>
        )}
      </div>
      <p className="mt-0.5 text-meta tabular-nums text-ink-3">{r.readings.join(' ') || '读音留白'}</p>

      {/* 第二层：出处（这本应用的核心凭据，一行常驻，点开看原句与今译） */}
      <details className="mt-2.5">
        <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 text-meta text-ink-2 hover:text-ink lg:min-h-8">
          <svg className="size-3 shrink-0 text-ink-3 transition-transform open:rotate-90" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M4.5 2l5 4-5 4z" />
          </svg>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{sourceLabel(r)}</span>
        </summary>
        <div className="mt-2 border-t border-line pt-2">
          <Source r={r} />
        </div>
      </details>

      {/* 第三层：事实（字义 / 字形 / 常见度 / 多音 / 部首 / 小名）统一成「标签 + 值」两列，
          不再是十几个颜色各异的小胶囊 */}
      {(gloss.length > 0 || shapeShown || poly.length > 0 || pop.lead || rad.length > 0 || nns.length > 0) && (
        <dl className="meta-row mt-2.5">
          {gloss.length > 0 && (
            <><dt className="text-ink-3">字义</dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-0.5">
                {gloss.map((x) => <span key={x.ch}><span className="font-serif text-ink">{x.ch}</span> {x.g}</span>)}
              </dd></>
          )}
          {shapeShown && (
            <><dt className="text-ink-3">字形</dt>
              <dd className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                {shape.chars.map((c) => (
                  <span key={c.ch}>{c.ch}·{c.sx ?? '结构未收录'}·{c.st != null ? `${c.st}画` : '笔画未收录'}</span>
                ))}
                {shape.strokesTotal != null
                  ? <span className="tabular-nums">共 {shape.strokesTotal} 画</span>
                  : <span className="text-ink-3">笔画合计不全</span>}
                {shape.note && <span className="chip chip-warn">{shape.note}</span>}
              </dd></>
          )}
          {pop.lead && (
            <>
              <dt className="text-ink-3">常见度</dt>
              <dd>
                <span className="chip chip-accent"
                  title={`用字常见度是估算：依据 114 万真实姓名去姓后的用字频次（${pop.chars.map((c) => `${c.ch} ${c.band}`).join('、')}），不是户籍重名率`}>
                  用字常见度 {pop.band}
                </span>
              </dd>
            </>
          )}
          {poly.length > 0 && (
            <>
              <dt className="text-ink-3">多音</dt>
              <dd className="flex flex-wrap gap-1.5">
                {poly.map((p) => <span key={p.ch} className="chip chip-cool max-w-full whitespace-normal">多音 {p.ch} {p.reads.join('/')}</span>)}
              </dd>
            </>
          )}
          {rad.length > 0 && (
            <>
              <dt className="text-ink-3">部首</dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-0.5"
                title="部首提示＝该字在康熙字典里所属的部首，只标落在 木/火/水/金/土 五部的字，其余留白（留白不代表该字无五行）。本应用不做五行筛选、不判吉凶。">
                {rad.map((x) => <span key={x.ch}>{x.ch} · {x.el}部</span>)}
              </dd>
            </>
          )}
          {peers.length > 0 && (
            <>
              <dt className="text-ink-3">同音</dt>
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{peers.map((p) => p.name).join('、')}</span>
                <span className="text-meta text-ink-3" title={`同音写法出自《${BOOK_LABEL[r.book]}》等条目：${peers.map((p) => `${p.name}《${BOOK_LABEL[p.book]}·${p.title}》`).join('、')}`}>去声调同音，按常用读音</span>
                {onSameSound && <button onClick={onSameSound} className="btn btn-quiet text-meta">按拼音看</button>}
              </dd>
            </>
          )}
          {nns.length > 0 && (
            <><dt className="text-ink-3">小名</dt><dd>{nns.join(' · ')}</dd></>
          )}
        </dl>
      )}

      {/* 第四层：只有需要提醒时才出现的警示 */}
      {(marked.length > 0 || shadow.length > 0) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {marked.map((f) => <span key={f} className="chip chip-danger max-w-full whitespace-normal">{f}</span>)}
          {shadow.map((f) => <span key={f} className="chip chip-warn max-w-full whitespace-normal">{f}</span>)}
        </div>
      )}

      {/* 分数明细：默认折叠 */}
      <details className="mt-3 text-meta text-ink-2 no-print">
        <summary className="flex min-h-11 cursor-pointer select-none items-center text-ink-3 hover:text-ink lg:min-h-8">分数明细</summary>
        <ul className="mt-1.5 space-y-0.5">
          {r.deltas.map((d) => (
            <li key={d.rule} className="flex justify-between gap-4">
              <span>{d.rule}</span>
              <span className={`tabular-nums ${d.delta < 0 ? 'text-danger' : 'text-ok'}`}>{d.delta > 0 ? `+${d.delta}` : d.delta}</span>
            </li>
          ))}
        </ul>
      </details>

      {/* 操作：手机端 44px 高，桌面 36px */}
      <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
        <button onClick={onFav} aria-pressed={fav} className={`btn ${fav ? 'btn-on' : ''}`}>
          {fav ? '已收藏' : '收藏'}
        </button>
        <button onClick={onBlock} aria-pressed={blocked} title="拉黑后这个名字不再出现在候选与「搭配」里" className={`btn ${blocked ? 'btn-danger' : ''}`}>
          {blocked ? '已拉黑' : '拉黑'}
        </button>
        {onTitle && sameTitle !== undefined && sameTitle > 1 && (
          <button onClick={onTitle} className="btn btn-quiet" title={`《${r.title}》里还有 ${sameTitle - 1} 条候选`}>同篇还有 {sameTitle - 1} 条</button>
        )}
        {onCopy && <button onClick={onCopy} className="btn btn-quiet">复制信息</button>}
        {onShare && <button onClick={onShare} className="btn btn-quiet">分享卡</button>}
      </div>
    </article>
  );
}
