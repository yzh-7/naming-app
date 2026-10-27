import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  charFacts,
  cleanSurname,
  composeName,
  findCombo,
  findItem,
  L0_CHARS,
  pairCandidates,
  isKnownSurname,
  readings,
  scoreItem,
  shapeTags,
  surnameReads,
} from '../engine/name';
import { CHARS, POOL, SINGLES } from '../engine/data';
import { BOOK_COUNT, BOOK_LABEL, type Opts, type Result, type ShareName } from '../engine/types';
import * as store from '../store/local';
import { Source } from './NameCard';

const CJK = /^\p{Script=Han}$/u;
const RANDOM_COUNT = 8;

type Props = {
  surname: string;
  setSurname: (s: string) => void;
  reading: number;
  setReading: (n: number) => void;
  opts: Opts;
  fav: Set<string>;
  onFav: (r: Result) => void;
  onShare: (r: Result | ShareName) => void;
  onCopy: (r: Result | ShareName) => void;
};

function pickRandom<T>(list: T[], n: number): T[] {
  const out: T[] = [];
  const seen = new Set<number>();
  while (out.length < n && seen.size < list.length) {
    const i = Math.floor(Math.random() * list.length);
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(list[i]);
  }
  return out;
}

// 有出处的随机池：双名用 Pool-B，单名用 singles；自由组合池用名用字表
const POOL_NAMES = POOL.map((p) => p.name);
const SINGLE_NAMES = SINGLES.map((s) => s.char);
const ALL_CHARS = Object.keys(CHARS).sort((a, b) => (CHARS[b].gn ?? 0) - (CHARS[a].gn ?? 0) || (a < b ? -1 : 1));

export default function Compose({
  surname,
  setSurname,
  reading,
  setReading,
  opts,
  fav,
  onFav,
  onShare,
  onCopy,
}: Props) {
  const [draft, setDraft] = useState<store.ComposeDraft>(store.loadCompose);
  const [picker, setPicker] = useState<0 | 1 | null>(null);
  const [q, setQ] = useState('');
  const [onlyL0, setOnlyL0] = useState(true);
  const [randoms, setRandoms] = useState<string[]>([]);
  const [freeRandom, setFreeRandom] = useState(false);

  useEffect(() => {
    store.saveCompose(draft);
  }, [draft]);

  const sur = cleanSurname(surname);
  const want = draft.length;
  const chars = Array.from({ length: want }, (_, i) => draft.chars[i] ?? '');
  const name = chars.join('');
  const ready = sur.length > 0 && chars.every((c) => CJK.test(c));

  const composed = useMemo(() => (ready ? composeName(sur, name, reading) : null), [ready, sur, name, reading]);
  const source = useMemo(() => (ready ? findCombo(name) : null), [ready, name]);
  const sourceItem = source ? findItem(source.id) : null;
  const scored = sourceItem ? scoreItem(sur, sourceItem, opts, reading) : null;

  const facts = chars.filter(Boolean).map(charFacts);
  const shape = ready ? shapeTags(name) : null;
  // 拉黑的条目不再出现在「随机」与「搭配」里（用户明确说过不想再看到）
  const blocked = useMemo(() => new Set(opts.exclude), [opts.exclude]);
  const pairHints = (() => {
    if (want !== 2) return [];
    const src =
      chars[0] && !chars[1] ? pairCandidates(chars[0]) : chars[1] && !chars[0] ? pairCandidates(chars[1]) : [];
    return src.filter((h) => !blocked.has(h.id)).slice(0, 24);
  })();

  const setChar = (i: number, ch: string) => {
    setDraft((d) => {
      const next = Array.from({ length: d.length }, (_, k) => d.chars[k] ?? '');
      next[i] = ch;
      return { ...d, chars: next };
    });
    setPicker(null);
    setQ('');
  };
  const clearChar = (i: number) =>
    setDraft((d) => ({ ...d, chars: Array.from({ length: d.length }, (_, k) => (k === i ? '' : (d.chars[k] ?? ''))) }));
  const setLength = (n: 1 | 2) => {
    setDraft((d) => ({ ...d, length: n, chars: d.chars.slice(0, n) }));
    setPicker(null);
    setQ('');
  };

  const fillRandom = () => {
    if (!freeRandom) {
      const pool = (want === 2 ? POOL_NAMES : SINGLE_NAMES).filter((nm) => {
        const hit = findCombo(nm);
        return hit && !blocked.has(hit.id);
      });
      setRandoms(pickRandom(pool, RANDOM_COUNT));
      return;
    }
    const out: string[] = [];
    const used = new Set<string>();
    let guard = 0;
    while (out.length < RANDOM_COUNT && guard++ < 500) {
      const picked = pickRandom(L0_CHARS, want).join('');
      if (used.has(picked)) continue;
      used.add(picked);
      out.push(picked);
    }
    setRandoms(out);
  };

  const applyRandom = (nm: string) => setDraft((d) => ({ ...d, chars: [...nm].slice(0, d.length) }));

  const surReadCount = surnameReads(sur);
  const surReads = sur.length > 0 && surReadCount > 1 ? readings(sur[0]) : [];
  const pick = Math.min(reading, Math.max(surReads.length - 1, 0));
  const surUnknown = sur.length > 0 && !isKnownSurname(sur);

  // 选字面板：Escape 关掉，焦点回到原来那个字位；不靠鼠标也能收起来
  const slotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const closePicker = () => {
    const i = picker;
    setPicker(null);
    setQ('');
    slotRefs.current[i ?? 0]?.focus();
  };

  return (
    <div className="space-y-4">
      <section className="card space-y-4">
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
            <label className="col-span-full">
              <span className="lab mb-1">
                {sur.length > 1 ? `姓首字「${sur[0]}」的读音` : '姓的读音（多音姓请选）'}
              </span>
              <select
                value={pick}
                onChange={(e) => setReading(Number(e.target.value))}
                className="field w-full sm:w-auto"
              >
                {surReads.map((r, i) => (
                  <option key={i} value={i}>
                    {sur[0]} {r.mark}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="col-span-full sm:block">
            <span className="lab mb-1">名字字数</span>
            <div className="seg w-full sm:w-auto" role="group" aria-label="名字字数">
              {([2, 1] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setLength(n)}
                  aria-pressed={want === n}
                  className={`seg-btn flex-1 sm:flex-none ${want === n ? 'seg-on' : ''}`}
                >
                  {n === 2 ? '双名' : '单名'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {surUnknown && (
          <p className="rounded-card border border-warn-line bg-warn-soft px-3 py-2 text-meta leading-6 text-warn">
            「{sur}」有字不在读音表（通用规范汉字表 8105 字）内，这次算不出读音与分数；先核对字义，或换一个姓。
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          {Array.from({ length: want }, (_, i) => {
            const ch = chars[i];
            return (
              <div key={i} className="flex items-end gap-1.5">
                <button
                  ref={(el) => {
                    slotRefs.current[i] = el;
                  }}
                  onClick={() => {
                    setPicker(i as 0 | 1);
                    setQ('');
                  }}
                  aria-label={ch ? `选择第 ${i + 1} 字：${ch}` : `选择第 ${i + 1} 字`}
                  aria-expanded={picker === i}
                  className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-card border border-dashed border-line-strong bg-surface-2 font-serif text-name text-ink hover:border-accent hover:bg-accent-soft sm:h-20 sm:w-20 sm:text-name-lg"
                >
                  {ch || <span className="text-meta text-ink-3">第 {i + 1} 字</span>}
                </button>
                {ch && (
                  <button
                    onClick={() => clearChar(i)}
                    aria-label={`清除第 ${i + 1} 字`}
                    className="mb-1 size-11 rounded-ctl border border-line text-ink-3 hover:border-line-strong hover:text-ink lg:size-9"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
            );
          })}
          <button onClick={fillRandom} className="btn-primary w-full sm:ml-auto sm:w-auto">
            换一批随机
          </button>
          <label className="flex min-h-11 w-full items-center gap-2 text-meta text-ink-3 sm:w-auto">
            <input
              type="checkbox"
              checked={freeRandom}
              onChange={(e) => setFreeRandom(e.target.checked)}
              className="size-6 accent-accent"
            />
            随机自由组合（不看有无出处）
          </label>
        </div>

        {picker !== null && (
          <div
            onKeyDown={(e) => {
              if (e.key === 'Escape') closePicker();
            }}
            className="space-y-3 rounded-card border border-line bg-surface-2 p-3 sm:p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
                aria-label={`第 ${picker + 1} 字搜索`}
                placeholder="输入汉字或拼音，如 子 / zi"
                className="field w-full font-serif text-title sm:w-48"
              />
              <button
                onClick={() => setOnlyL0((v) => !v)}
                aria-pressed={onlyL0}
                className={`chip ${onlyL0 ? 'chip-ok' : 'text-ink-3'}`}
              >
                仅名用字表
              </button>
              <button onClick={closePicker} className="btn ml-auto">
                关闭
              </button>
            </div>
            <p className="text-meta text-ink-3">
              点字填入第 {picker + 1} 字；也可直接输入任意汉字（汉字按字找，拼音按音找）。
            </p>
            {CJK.test(q) && (
              <button
                onClick={() => setChar(picker, q)}
                className="btn btn-accent max-w-full whitespace-normal font-serif text-title"
              >
                使用「{q}」{charFacts(q).l0 ? '' : '（不在名用字表）'}
              </button>
            )}
            {/^\p{Script=Han}{2}$/u.test(q) && (
              <button
                onClick={() => {
                  setDraft((d) => ({ ...d, chars: [...q] }));
                  setPicker(null);
                  setQ('');
                }}
                className="btn btn-accent max-w-full whitespace-normal font-serif text-title"
              >
                直接使用「{q}」
              </button>
            )}
            {charList(q, onlyL0).length === 0 && (
              <p className="text-meta text-ink-3">
                没有匹配的字{q ? `：「${q}」` : ''}。汉字按字找、拼音按音找；
                {onlyL0 ? '当前只列名用字表内的字，关掉「仅名用字表」可看全部。' : '这个字表里没有这样的字。'}
              </p>
            )}
            <div
              data-char-grid
              role="group"
              aria-label="候选字"
              className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto pb-1"
            >
              {charList(q, onlyL0).map((ch) => (
                <button
                  key={ch}
                  onClick={() => setChar(picker, ch)}
                  className="h-11 w-11 rounded-ctl border border-line bg-surface font-serif text-glyph text-ink hover:border-accent-line hover:bg-accent-soft lg:h-10 lg:w-10"
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
        )}

        {facts.length > 0 && (
          <dl className="meta-row">
            {facts.map((f, i) => (
              // 同一个字可以填在两格（多多），键要带格位才不会撞
              <Fragment key={`${f.ch}-${i}`}>
                <dt className="font-serif text-body text-ink">{f.ch}</dt>
                <dd>
                  {f.gloss ?? '字义留白'}
                  {f.st ? ` · ${f.st}画` : ''}
                  {f.sx ? ` · ${f.sx}` : ''} · <span className="tabular-nums">{f.band}</span>
                  {!f.l0 && <span className="ml-1 text-warn">不在名用字表</span>}
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
      </section>

      {!sur && (
        <p className="rounded-card border border-dashed border-line-strong bg-surface-2 p-6 text-center text-meta leading-6 text-ink-3">
          先填姓氏，再选第 1、2 个字（或只选一个字），下面会核对读音、字义与出处。
        </p>
      )}

      {sur && !ready && (
        <p className="rounded-card border border-dashed border-line-strong bg-surface-2 p-6 text-center text-meta leading-6 text-ink-3">
          {want === 2 ? '还差一个字。也可以从下面的「随机」或「搭配」里挑。' : '还没选字。'}
        </p>
      )}

      {ready && composed && (
        <section className="card space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="font-serif text-name-lg text-ink">{composed.full}</h2>
            <span className="text-meta tabular-nums text-ink-3">{composed.readings.join(' ') || '读音留白'}</span>
          </div>
          {shape?.note && <p className="text-meta text-warn">{shape.note}</p>}
          {opts.avoidChars && chars.some((c) => opts.avoidChars.includes(c)) && (
            <p className="text-meta text-warn">
              「{chars.filter((c) => opts.avoidChars.includes(c)).join('、')}
              」在生成页的禁用字里：这里是你自己挑的字，照旧能组合，但生成页不会出现含它的名字。
            </p>
          )}
          {composed.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {composed.flags.map((f) => (
                <span key={f} className="chip chip-danger max-w-full whitespace-normal">
                  {f}
                </span>
              ))}
            </div>
          )}
          {!composed.allL0 && (
            <p className="text-meta text-warn">有字不在名用字表：仍做读音与谐音核对，但字义/常见度可能留白。</p>
          )}

          {source ? (
            <div className="border-t border-line pt-3">
              <Source r={source} />
            </div>
          ) : (
            <p className="border-t border-line pt-3 text-body leading-7 text-ink-2">
              {BOOK_COUNT} 本典籍里没有「{name}」这个搭配的出处。这里只做事实核对，不拿别的句子凑出处。
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {scored && (
              <button
                onClick={() => onFav(scored)}
                aria-pressed={fav.has(scored.id)}
                className={fav.has(scored.id) ? 'btn btn-on' : 'btn'}
              >
                {fav.has(scored.id) ? '已收藏' : '收藏'}
              </button>
            )}
            <button
              onClick={() =>
                onShare(scored ?? { full: composed.full, name: composed.name, readings: composed.readings })
              }
              className="btn btn-quiet"
            >
              分享卡
            </button>
            <button
              onClick={() =>
                onCopy(scored ?? { full: composed.full, name: composed.name, readings: composed.readings })
              }
              className="btn btn-quiet"
            >
              复制信息
            </button>
            {!scored && <span className="text-meta text-ink-3">无出处的组合不进收藏（收藏按出处条目定位）</span>}
          </div>
        </section>
      )}

      {randoms.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="lab">
            随机 {randoms.length} 个{freeRandom ? '（自由组合，可能有出处也可能没有）' : '（都有典籍出处）'} ·
            点一下填入
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {randoms.map((nm) => {
              const hit = findCombo(nm);
              return (
                <button
                  key={nm}
                  onClick={() => applyRandom(nm)}
                  className="min-h-11 rounded-card border border-line bg-surface px-3 py-2 text-left text-ink hover:border-line-strong lg:min-h-0"
                >
                  <span className="font-serif text-name">{nm}</span>
                  <span className="ml-2 text-meta text-ink-3">{hit ? `· ${BOOK_LABEL[hit.book]}` : '· 无出处'}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {pairHints.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="lab">
            与「{chars[0] || chars[1]}」在典籍同一句读里搭配过的字（{pairHints.length} 个）· 点一下填入
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {pairHints.map((h) => (
              <button
                key={h.ch}
                onClick={() => setChar(chars[0] ? 1 : 0, h.ch)}
                title={`${h.name} · 《${BOOK_LABEL[h.book]}·${h.title}》`}
                className="chip font-serif text-title hover:border-accent-line hover:bg-accent-soft"
              >
                {h.ch}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// 字选择器列表：默认只列名用字表（293 字），按用字频次降序；搜索支持汉字与拼音
function charList(q: string, onlyL0: boolean): string[] {
  const base = onlyL0 ? L0_CHARS : ALL_CHARS;
  const needle = q.trim().toLowerCase();
  if (!needle) return base;
  if (CJK.test(needle)) return base.filter((ch) => ch === needle);
  return base.filter((ch) =>
    readings(ch).some((r) => r.syl.startsWith(needle) || r.mark.toLowerCase().startsWith(needle)),
  );
}
