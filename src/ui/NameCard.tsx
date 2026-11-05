import { useMemo } from 'react';
import {
  glossOf,
  lineGlossOf,
  nicknames,
  polyphoneTags,
  popularity,
  radicalTags,
  sameSoundPeers,
  shapeTags,
  wordEvidence,
} from '../engine/name';
import { BOOK_LABEL, type AltRef, type Book, type Result } from '../engine/types';

const WINDOW_MAX = 28;

type Win = { start: number; end: number; cutLeft: boolean; cutRight: boolean };

function windowAround(line: string, from: number, to: number): Win {
  if (line.length <= WINDOW_MAX) return { start: 0, end: line.length, cutLeft: false, cutRight: false };
  const parts: { from: number; to: number }[] = [];
  let from0 = 0;
  for (let i = 0; i < line.length; i++) {
    if ('，、；：'.includes(line.charAt(i))) {
      parts.push({ from: from0, to: i + 1 });
      from0 = i + 1;
    }
  }
  if (from0 < line.length) parts.push({ from: from0, to: line.length });
  const hit = parts.findIndex((p) => p.from <= from && p.to >= to);
  if (hit < 0) return { start: 0, end: line.length, cutLeft: false, cutRight: false };
  const lo = Math.max(0, hit - 1);
  const hi = Math.min(parts.length - 1, hit + 1);
  const left = parts[lo];
  const right = parts[hi];
  // lo/hi 已夹在 parts 的范围内；真取不到就退回整句，和上面 hit < 0 的处理一致
  if (!left || !right) return { start: 0, end: line.length, cutLeft: false, cutRight: false };
  return { start: left.from, end: right.to, cutLeft: left.from > 0, cutRight: right.to < line.length };
}

// 出处行只依赖这些字段：有出处的 Result、PoolItem、SingleItem 都满足，自选页可复用同一套渲染
export type SourceRef = {
  book: Book;
  name?: string; // 真实人名档的说明文案要说「这个名字」，典籍出处不需要
  rn?: number; // 真实人名档才有：语料里出现过多少次
  rs?: 'm' | 'f' | 'n';
  title: string;
  author: string;
  line: string;
  seg: string;
  foot: number;
  gap: number;
  lg: number;
  strict: boolean;
};

function sourceLabel(r: SourceRef) {
  // 真实人名档没有典籍可引，出处那一行直说它是什么，不装作有出处
  if (r.book === 'real') return `真实人名 · 语料里 ${r.rn ?? 0} 人用过（非典籍出处）`;
  return `《${BOOK_LABEL[r.book]}·${r.title}${r.author ? `·${r.author}` : ''}》`;
}

// 原句窗口＋那对字的高亮：主出处与「另有出处」共用这一套。传进来的是原句里的绝对下标，
// 所以调用方怎么定位（取词段下标／产物里存的原句下标）都不影响这里画什么。
function marks(line: string, hots: Set<number>) {
  const spanFrom = Math.min(...hots);
  const spanTo = Math.max(...hots) + 1;
  const w = windowAround(line, spanFrom, spanTo);
  const pieces: { text: string; mark: boolean }[] = [];
  for (let i = w.start; i < w.end; i++) {
    const mark = hots.has(i);
    const ch = line.charAt(i);
    const last = pieces[pieces.length - 1];
    if (last && last.mark === mark) last.text += ch;
    else pieces.push({ text: ch, mark });
  }
  return { w, pieces };
}

function Excerpt({ w, pieces }: { w: Win; pieces: { text: string; mark: boolean }[] }) {
  return (
    <>
      {w.cutLeft && <span className="text-ink-3">…</span>}
      {pieces.map((p, i) => {
        return p.mark ? (
          <mark key={i} className="rounded px-0.5 font-medium">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        );
      })}
      {w.cutRight ? <span className="text-ink-3">…</span> : <span className="text-ink-3">。</span>}
    </>
  );
}

// 今译那一段：覆盖不到的句子（lg = -1）明说「待补」，不空着让用户自己猜是没有译文还是渲染坏了
function GlossBlock({ lg, short }: { lg: number; short?: boolean }) {
  const gloss = lineGlossOf({ lg });
  return gloss ? (
    <p className="mt-2 border-l-2 border-line pl-2 text-body leading-6 text-ink-2">
      <span className="mr-1 rounded-ctl px-1 text-meta text-ink-3">今译</span>
      {gloss}
    </p>
  ) : (
    <p className="mt-2 border-l-2 border-line pl-2 text-body leading-6 text-ink-2">
      <span className="mr-1 rounded-ctl px-1 chip text-meta">今译待补</span>
      <span className="text-meta text-ink-3">
        {short
          ? '这一句原文照引，还没有现代汉语今译'
          : '这一句原文照引，但还没有现代汉语今译（清单在 docs/gloss-gaps.md，补一行即进包）'}
      </span>
    </p>
  );
}

// 另有出处的一条：书·篇＋原句（那对字高亮）＋今译。位置是产物里存的原句下标，加载期已逐条咬死过。
export function AltSource({ a }: { a: AltRef }) {
  const { w, pieces } = marks(a.line, new Set([a.at, a.at2]));
  const where =
    a.at2 - a.at === 1
      ? `取词段第 ${a.at + 1}–${a.at2 + 1} 字`
      : `取词段第 ${a.at + 1} 与第 ${a.at2 + 1} 字（中间隔 ${a.at2 - a.at - 1} 字）`;
  return (
    <li className="font-serif text-glyph leading-6 text-ink-2">
      <Excerpt w={w} pieces={pieces} />
      <div className="mt-1 text-meta text-ink-3">
        {sourceLabel({ book: a.book, title: a.title, author: a.author, rn: undefined } as SourceRef)} · {where}
        {!a.strict && ' · 长短句/散文宽口径'}
      </div>
      <GlossBlock lg={a.lg} short />
    </li>
  );
}

// 出处行：默认折叠，展开后显示原文高亮 + 今译
export function Source({ r }: { r: SourceRef }) {
  // 真实人名档的「出处」说的是它自己的证据，不是一段不存在的原文
  if (r.book === 'real') {
    const side = r.rs === 'f' ? '偏女' : r.rs === 'm' ? '偏男' : r.rs === 'n' ? '男女都用' : '未知';
    return (
      <div>
        <p className="font-serif text-glyph leading-6 text-ink-2">真实人名 · 语料里 {r.rn ?? 0} 人用过（非典籍出处）</p>
        <p className="mt-2 border-l-2 border-line pl-2 text-body leading-6 text-ink-2">
          这条不是典籍出处。它来自 120 万条真实姓名语料：「{r.name ?? ''}」这个双字名在语料里出现过 {r.rn ?? 0}{' '}
          次，上游把它标注为
          {side}。它证明有人这么叫过，不证明这个名字有典籍来源；成词与否不适用于它，用字与读音仍按其他标签看。
        </p>
      </div>
    );
  }
  const at = r.line.indexOf(r.seg);
  if (at < 0) {
    return (
      <div className="text-meta text-ink-2">
        <div>{sourceLabel(r)}</div>
        <div className="mt-0.5">
          取词段「<mark className="rounded px-0.5">{r.seg}</mark>」
        </div>
        <GlossBlock lg={r.lg} />
      </div>
    );
  }
  const gap = r.gap ?? 1;
  const hots = new Set(gap === 0 ? [at + r.foot] : [at + r.foot, at + r.foot + gap]);
  const { w, pieces } = marks(r.line, hots);
  const where =
    gap === 0
      ? `取词段第 ${r.foot + 1} 字`
      : gap === 1
        ? `取词段第 ${r.foot + 1}–${r.foot + 2} 字`
        : `取词段第 ${r.foot + 1} 与第 ${r.foot + gap + 1} 字（中间隔 ${gap - 1} 字）`;
  return (
    <div className="font-serif text-glyph leading-6 text-ink-2">
      <Excerpt w={w} pieces={pieces} />
      <div className="mt-1 text-meta text-ink-3">
        {sourceLabel(r)} · {where}
        {gap > 1 && ' · 跨字取词，看原文自辨'}
        {!r.strict && ' · 长短句/散文宽口径'}
      </div>
      <GlossBlock lg={r.lg} />
    </div>
  );
}

export default function NameCard({
  r,
  fav,
  blocked,
  onFav,
  onBlock,
  onShare,
  onCopy,
  onTitle,
  onSameSound,
  sameTitle,
}: {
  r: Result;
  fav: boolean;
  blocked: boolean;
  onFav: () => void;
  onBlock: () => void;
  onShare?: () => void;
  onCopy?: () => void;
  // 按篇看：把筛选收窄到这一篇；按音看：把搜索换成这个名字的拼音（去声调）
  onTitle?: () => void;
  onSameSound?: () => void;
  // 这一篇在当前筛选后还剩多少条（含自己）。由调用方按候选池算好传进来：
  // 按全语料算的话，设了禁用字、性别或典籍之后按钮写 5 条、点进去只有 2 条
  sameTitle?: number;
}) {
  const marked = r.flags.filter((f) => !f.startsWith('同形'));
  const shadow = r.flags.filter((f) => f.startsWith('同形'));
  const g = r.gender;
  const rad = radicalTags(r.name);
  const gloss = useMemo(
    () =>
      [...new Set([...r.name])]
        .map((ch) => ({ ch, g: glossOf(ch) }))
        .filter((x): x is { ch: string; g: string } => !!x.g),
    [r.name],
  );
  const shape = useMemo(() => shapeTags(r.name), [r.name]);
  const poly = useMemo(() => polyphoneTags(r.name), [r.name]);
  const pop = useMemo(() => popularity(r.name), [r.name]);
  const nns = nicknames(r.name);
  const peers = useMemo(() => sameSoundPeers(r.name, 4), [r.name]);

  // 性别标签：偏女=暖色、偏男=冷色（浅色/深色各有一套对比度达标的取值）
  const gBadge = useMemo(() => {
    // 三档都有标签：中性也标出来，否则用户分不清「没标」是「未判定」还是「中性」
    if (g.side === 'n') return { text: '中性', cls: 'chip' };
    const weak = g.strong ? '' : '疑似';
    const side = g.side === 'f' ? '偏女' : '偏男';
    return { text: `${weak}${side}`, cls: g.side === 'f' ? 'chip-warm' : 'chip-cool' };
  }, [g]);

  // 成词证据也常驻卡片：用户问「这名字是不是硬凑的」，答案就这两个字在语料里挨没挨着
  const evChip = useMemo(() => {
    // 真实人名档不参与成词口径：它不是从原句里取字取出来的，挂「未见成词依据」是把它误归类
    if (r.book === 'real') return null;
    const ev = wordEvidence(r as unknown as { a?: number; w?: number; redup?: boolean; spl?: string; char?: string });
    if (ev.tier === 'single') return null;
    const text =
      ev.tier === 'attested'
        ? `成词 · 语料内相邻 ${ev.a} 次`
        : ev.tier === 'modern'
          ? '成词 · 现代词表收录'
          : ev.tier === 'redup'
            ? '成词 · 典籍叠字'
            : '未见成词依据';
    const title = `${ev.why}${ev.spl ? `；拆词：原句里相邻的「${ev.spl}」被剪开，只取了它两边的字` : ''}`;
    return { text, title, cls: ev.tier === 'none' ? 'text-ink-3' : 'chip-ok' };
  }, [r]);

  // 真实用名证据：只在语料里有记录时挂标签，没记录不挂（缺证据不等于名字不好）
  const useChip = useMemo(() => {
    const rn = r.rn ?? 0;
    if (rn < 2) return null;
    const sideLabel = r.rs === 'f' ? '偏女' : r.rs === 'm' ? '偏男' : r.rs === 'n' ? '男女都用' : '未知';
    const title = `120 万条真实姓名语料里这个名字出现过 ${rn} 次；上游性别标注：${sideLabel}。${
      r.gender.conflict ? `${r.gender.conflict}。` : ''
    }上游是逐名标注而非用量分布，这条只证明有人这么叫过`;
    return { text: `真名 · ${rn} 人用过`, title, cls: rn >= 10 ? 'chip-ok' : 'chip' };
  }, [r]);

  const shapeShown = shape.chars.length > 0 || !!shape.note;

  return (
    <article className="card">
      {/* 第一层：名字本体（衬线放大）＋ 分数合计 ＋ 读音 ＋ 性别倾向 */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
          <h3 className="font-serif text-name text-ink sm:text-name-lg">{r.full}</h3>
          {/* 分数合计常驻：默认排序就是按分数排的，那个数字不该只住在「分数明细」里 */}
          <span
            data-block="score-total"
            className="flex items-baseline gap-1.5"
            title="分数合计＝这一池内排序用的那个总分，由可解释的加减项相加，不构成对名字优劣的评价。逐项看下面的「分数明细」"
          >
            <span className="text-meta text-ink-3">分数合计</span>
            <span className="font-serif text-glyph tabular-nums text-accent-ink">{r.total}</span>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {/* 已收藏是设备状态，不是名字本身的属性：常驻在名字旁边，打印时不出现 */}
          {fav && (
            <span className="chip chip-accent no-print" title="这条已经在你本机的收藏里">
              已收藏
            </span>
          )}
          {gBadge && (
            <span className={`chip ${gBadge.cls}`} title={g.conflict ? `${g.why}。${g.conflict}` : g.why}>
              {gBadge.text}
            </span>
          )}
          {useChip && (
            <span className={`chip ${useChip.cls}`} title={useChip.title}>
              {useChip.text}
            </span>
          )}
          {evChip && (
            <span className={`chip ${evChip.cls}`} title={evChip.title}>
              {evChip.text}
            </span>
          )}
        </span>
      </div>
      <p className="mt-0.5 text-meta tabular-nums text-ink-3">{r.readings.join(' ') || '读音留白'}</p>

      {/* 第二层：出处常驻。这本应用的核心凭据就是那句原文，它不该在折叠里——
          原句与今译直接给，书·篇与取词段做小字 */}
      <div data-block="source" className="mt-2.5 border-t border-line pt-2.5">
        <Source r={r} />
      </div>

      {/* 另有几处出处：语料里同一个名字往往不止一处能核对到（0.14.0）。默认折叠——
          卡上常驻的仍是主出处那一句，这一区是把「还有几处」如实列出来，不抢主句的位置 */}
      {r.alts && r.alts.length > 0 && (
        <details
          data-block="alts"
          className="mt-2 text-meta text-ink-2 no-print"
          title="主出处之外，语料里还能核对到这个名字的句读。每条给出书·篇、原句（那对字高亮）与今译"
        >
          <summary className="flex min-h-11 cursor-pointer select-none items-center text-ink-3 hover:text-ink lg:min-h-8">
            另有 {r.alts.length} 处出处
          </summary>
          <ul className="mt-1.5 space-y-3 border-t border-line pt-2">
            {r.alts.map((a) => (
              <AltSource key={`${a.ti}\u0000${a.li}\u0000${a.at}\u0000${a.at2}`} a={a} />
            ))}
          </ul>
        </details>
      )}

      {/* 第三层：事实（字义 / 字形 / 常见度 / 多音 / 部首 / 小名）统一成「标签 + 值」两列，
          不再是十几个颜色各异的小胶囊 */}
      {(gloss.length > 0 || shapeShown || poly.length > 0 || pop.lead || rad.length > 0 || nns.length > 0) && (
        <dl className="meta-row mt-2.5">
          {gloss.length > 0 && (
            <>
              <dt className="text-ink-3">字义</dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-0.5">
                {gloss.map((x) => (
                  <span key={x.ch}>
                    <span className="font-serif text-ink">{x.ch}</span> {x.g}
                  </span>
                ))}
              </dd>
            </>
          )}
          {shapeShown && (
            <>
              <dt className="text-ink-3">字形</dt>
              <dd className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                {shape.chars.map((c) => (
                  <span key={c.ch}>
                    {c.ch}·{c.sx ?? '结构未收录'}·{c.st != null ? `${c.st}画` : '笔画未收录'}
                  </span>
                ))}
                {shape.strokesTotal != null ? (
                  <span className="tabular-nums">共 {shape.strokesTotal} 画</span>
                ) : (
                  <span className="text-ink-3">笔画合计不全</span>
                )}
                {shape.note && <span className="chip chip-warn">{shape.note}</span>}
              </dd>
            </>
          )}
          {pop.lead && (
            <>
              <dt className="text-ink-3">常见度</dt>
              <dd>
                <span
                  className="chip chip-accent"
                  title={`用字常见度是估算：依据 114 万真实姓名去姓后的用字频次（${pop.chars.map((c) => `${c.ch} ${c.band}`).join('、')}），不是户籍重名率`}
                >
                  用字常见度 {pop.band}
                </span>
              </dd>
            </>
          )}
          {poly.length > 0 && (
            <>
              <dt className="text-ink-3">多音</dt>
              <dd className="flex flex-wrap gap-1.5">
                {poly.map((p) => (
                  <span key={p.ch} className="chip chip-cool max-w-full whitespace-normal">
                    多音 {p.ch} {p.reads.join('/')}
                  </span>
                ))}
              </dd>
            </>
          )}
          {rad.length > 0 && (
            <>
              <dt className="text-ink-3">部首</dt>
              <dd
                className="flex flex-wrap gap-x-3 gap-y-0.5"
                title="部首提示＝该字在康熙字典里所属的部首，只标落在 木/火/水/金/土 五部的字，其余留白（留白不代表该字无五行）。本应用不做五行筛选、不判吉凶。"
              >
                {rad.map((x) => (
                  <span key={x.ch}>
                    {x.ch} · {x.el}部
                  </span>
                ))}
              </dd>
            </>
          )}
          {peers.length > 0 && (
            <>
              <dt className="text-ink-3">同音</dt>
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{peers.map((p) => p.name).join('、')}</span>
                <span
                  className="text-meta text-ink-3"
                  title={`同音写法出自《${BOOK_LABEL[r.book]}》等条目：${peers.map((p) => `${p.name}《${BOOK_LABEL[p.book]}·${p.title}》`).join('、')}`}
                >
                  去声调同音，按常用读音
                </span>
                {onSameSound && (
                  <button onClick={onSameSound} className="btn btn-quiet text-meta">
                    按拼音看
                  </button>
                )}
              </dd>
            </>
          )}
          {nns.length > 0 && (
            <>
              <dt className="text-ink-3">小名</dt>
              <dd>{nns.join(' · ')}</dd>
            </>
          )}
        </dl>
      )}

      {/* 第四层：只有需要提醒时才出现的警示 */}
      {(marked.length > 0 || shadow.length > 0) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {marked.map((f) => (
            <span key={f} className="chip chip-danger max-w-full whitespace-normal">
              {f}
            </span>
          ))}
          {shadow.map((f) => (
            <span key={f} className="chip chip-warn max-w-full whitespace-normal">
              {f}
            </span>
          ))}
        </div>
      )}

      {/* 分数明细：默认折叠 */}
      <details data-block="score" className="mt-3 text-meta text-ink-2 no-print">
        <summary className="flex min-h-11 cursor-pointer select-none items-center text-ink-3 hover:text-ink lg:min-h-8">
          分数明细
        </summary>
        <ul className="mt-1.5 space-y-0.5 leading-snug">
          <li className="flex justify-between gap-4 border-b border-line pb-1">
            <span>分数合计</span>
            <span className="tabular-nums font-medium text-ink">{r.total}</span>
          </li>
          {r.deltas.map((d) => (
            <li key={d.rule} className="flex justify-between gap-4">
              <span>{d.rule}</span>
              <span className={`tabular-nums ${d.delta < 0 ? 'text-danger' : 'text-ok'}`}>
                {d.delta > 0 ? `+${d.delta}` : d.delta}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {/* 操作：手机端 44px 高，桌面 36px */}
      <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
        <button onClick={onFav} aria-pressed={fav} className={`btn ${fav ? 'btn-on' : ''}`}>
          {fav ? '已收藏' : '收藏'}
        </button>
        <button
          onClick={onBlock}
          aria-pressed={blocked}
          title="拉黑后这个名字不再出现在候选与「搭配」里"
          className={`btn ${blocked ? 'btn-danger' : ''}`}
        >
          {blocked ? '已拉黑' : '拉黑'}
        </button>
        {onTitle && sameTitle !== undefined && sameTitle > 1 && (
          <button onClick={onTitle} className="btn btn-quiet" title={`《${r.title}》里还有 ${sameTitle - 1} 条候选`}>
            同篇还有 {sameTitle - 1} 条
          </button>
        )}
        {onCopy && (
          <button onClick={onCopy} className="btn btn-quiet">
            复制信息
          </button>
        )}
        {onShare && (
          <button onClick={onShare} className="btn btn-quiet">
            分享卡
          </button>
        )}
      </div>
    </article>
  );
}
