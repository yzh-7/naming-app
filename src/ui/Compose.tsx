import { useEffect, useMemo, useState } from 'react';
import {
  charFacts, cleanSurname, composeName, findCombo, findItem, L0_CHARS, pairCandidates,
  readings, scoreItem, shapeTags, surnameReads,
} from '../engine/name';
import { CHARS, POOL, SINGLES } from '../engine/data';
import { BOOK_COUNT, BOOK_LABEL, type Opts, type Result, type ShareName } from '../engine/types';
import * as store from '../store/local';
import { Source } from './NameCard';

const CJK = /^[一-鿿]$/;
const RANDOM_COUNT = 8;

type Props = {
  surname: string; setSurname: (s: string) => void;
  reading: number; setReading: (n: number) => void;
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

export default function Compose({ surname, setSurname, reading, setReading, opts, fav, onFav, onShare, onCopy }: Props) {
  const [draft, setDraft] = useState<store.ComposeDraft>(store.loadCompose);
  const [picker, setPicker] = useState<0 | 1 | null>(null);
  const [q, setQ] = useState('');
  const [onlyL0, setOnlyL0] = useState(true);
  const [randoms, setRandoms] = useState<string[]>([]);
  const [freeRandom, setFreeRandom] = useState(false);

  useEffect(() => store.saveCompose(draft), [draft]);

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
    const src = chars[0] && !chars[1] ? pairCandidates(chars[0]) : chars[1] && !chars[0] ? pairCandidates(chars[1]) : [];
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
  const clearChar = (i: number) => setDraft((d) => ({ ...d, chars: Array.from({ length: d.length }, (_, k) => (k === i ? '' : d.chars[k] ?? '')) }));
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

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">姓（可复姓）</span>
            <input value={surname} onChange={(e) => setSurname(e.target.value)} onBlur={() => setSurname(sur)}
              placeholder="如 苏 / 欧阳" aria-label="姓氏（自选）"
              className="w-32 rounded border border-neutral-300 px-3 py-2 font-serif text-lg outline-none focus:border-neutral-500 dark:border-neutral-700" />
          </label>
          {surReads.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">{sur.length > 1 ? `姓首字「${sur[0]}」的读音` : '姓的读音（多音姓请选）'}</span>
              <select value={pick} onChange={(e) => setReading(Number(e.target.value))}
                className="rounded border border-neutral-300 px-2 py-2 text-sm dark:border-neutral-700">
                {surReads.map((r, i) => <option key={i} value={i}>{sur[0]} {r.mark}</option>)}
              </select>
            </label>
          )}
          <div>
            <span className="mb-1 block text-xs text-neutral-500">名字字数</span>
            <div className="flex gap-1">
              {([2, 1] as const).map((n) => (
                <button key={n} onClick={() => setLength(n)}
                  className={`rounded px-3 py-2 text-sm ring-1 ${want === n ? 'bg-neutral-900 text-white ring-neutral-900' : 'ring-neutral-200 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800'}`}>
                  {n === 2 ? '双名' : '单名'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {Array.from({ length: want }, (_, i) => {
            const ch = chars[i];
            return (
              <div key={i} className="flex items-end gap-1">
                <button onClick={() => { setPicker(i as 0 | 1); setQ(''); }} aria-label={`选择第 ${i + 1} 字`}
                  className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 font-serif text-3xl hover:border-neutral-500 dark:border-neutral-700 dark:hover:border-neutral-500">
                  {ch || <span className="text-sm text-neutral-500">第 {i + 1} 字</span>}
                </button>
                {ch && (
                  <button onClick={() => clearChar(i)} aria-label={`清除第 ${i + 1} 字`}
                    className="mb-1 rounded px-1.5 py-1 text-xs text-neutral-500 ring-1 ring-neutral-200 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800">×</button>
                )}
              </div>
            );
          })}
          <button onClick={fillRandom} className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">换一批随机</button>
          <label className="mb-2 flex items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" checked={freeRandom} onChange={(e) => setFreeRandom(e.target.checked)} className="size-4 accent-neutral-800" />
            随机自由组合（不看有无出处）
          </label>
        </div>

        {picker !== null && (
          <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex flex-wrap items-center gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label={`第 ${picker + 1} 字搜索`}
                placeholder="输入汉字或拼音，如 子 / zi" className="w-44 rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
              <button onClick={() => setOnlyL0((v) => !v)} aria-pressed={onlyL0}
                className={`rounded-full px-3 py-1 text-xs ring-1 ${onlyL0 ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'text-neutral-500 ring-neutral-200 dark:ring-neutral-700'}`}>
                仅名用字表
              </button>
              <span className="text-xs text-neutral-500">点字填入第 {picker + 1} 字；也可直接输入任意汉字</span>
              <button onClick={() => { setPicker(null); setQ(''); }} className="ml-auto rounded px-2 py-1 text-xs text-neutral-500 ring-1 ring-neutral-200 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800">关闭</button>
            </div>
            {CJK.test(q) && (
              <button onClick={() => setChar(picker, q)}
                className="rounded bg-amber-50 px-3 py-1.5 text-sm text-amber-900 ring-1 ring-amber-200">
                使用「{q}」{charFacts(q).l0 ? '' : '（不在名用字表）'}
              </button>
            )}
            {/^[一-鿿]{2}$/.test(q) && (
              <button onClick={() => { setDraft((d) => ({ ...d, chars: [...q] })); setPicker(null); setQ(''); }}
                className="rounded bg-amber-50 px-3 py-1.5 text-sm text-amber-900 ring-1 ring-amber-200">
                直接使用「{q}」
              </button>
            )}
            <div className="flex max-h-56 flex-wrap gap-1 overflow-y-auto">
              {charList(q, onlyL0).map((ch) => (
                <button key={ch} onClick={() => setChar(picker, ch)}
                  className="h-9 w-9 rounded font-serif text-lg ring-1 ring-neutral-200 hover:bg-amber-50 dark:ring-neutral-700 dark:hover:bg-neutral-800">
                  {ch}
                </button>
              ))}
            </div>
          </div>
        )}

        {facts.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
            {facts.map((f) => (
              <span key={f.ch}>
                <span className="font-serif text-sm text-neutral-900 dark:text-neutral-100">{f.ch}</span>{' '}
                {f.gloss ?? '字义留白'}
                {f.st ? ` · ${f.st}画` : ''}{f.sx ? ` · ${f.sx}` : ''} · {f.band}
                {!f.l0 && <span className="ml-1 rounded bg-amber-50 px-1 text-amber-800 ring-1 ring-amber-100">不在名用字表</span>}
              </span>
            ))}
          </div>
        )}
      </section>

      {!sur && (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          先填姓氏，再选第 1、2 个字（或只选一个字），下面会核对读音、字义与出处。
        </p>
      )}

      {sur && !ready && (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          {want === 2 ? '还差一个字。也可以从下面的「随机」或「搭配」里挑。' : '还没选字。'}
        </p>
      )}

      {ready && composed && (
        <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-serif text-3xl tracking-wider">{composed.full}</h2>
            <span className="text-xs text-neutral-500">{composed.readings.join(' ') || '读音留白'}</span>
          </div>
          {shape?.note && <p className="text-xs text-amber-800 dark:text-amber-200">{shape.note}</p>}
          {composed.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {composed.flags.map((f) => (
                <span key={f} className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 ring-1 ring-red-100">{f}</span>
              ))}
            </div>
          )}
          {!composed.allL0 && <p className="text-xs text-amber-800 dark:text-amber-200">有字不在名用字表：仍做读音与谐音核对，但字义/常见度可能留白。</p>}

          {source ? (
            <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <Source r={source} />
            </div>
          ) : (
            <p className="border-t border-neutral-100 pt-3 text-sm text-neutral-500 dark:border-neutral-800">
              {BOOK_COUNT} 本典籍里没有「{name}」这个搭配的出处。这里只做事实核对，不拿别的句子凑出处。
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {scored && (
              <button onClick={() => onFav(scored)}
                className={`rounded px-3 py-1 text-sm ring-1 ${fav.has(scored.id) ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'text-neutral-600 ring-neutral-200 hover:bg-neutral-50 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-800'}`}>
                {fav.has(scored.id) ? '已收藏' : '收藏'}
              </button>
            )}
            <button onClick={() => onShare(scored ?? { full: composed.full, name: composed.name, readings: composed.readings })}
              className="rounded px-3 py-1 text-sm text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-800">分享卡</button>
            <button onClick={() => onCopy(scored ?? { full: composed.full, name: composed.name, readings: composed.readings })}
              className="rounded px-3 py-1 text-sm text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-800">复制信息</button>
            {!scored && <span className="text-xs text-neutral-500">无出处的组合不进收藏（收藏按出处条目定位）</span>}
          </div>
        </section>
      )}

      {randoms.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs text-neutral-500">
            随机 {randoms.length} 个{freeRandom ? '（自由组合，可能有出处也可能没有）' : '（都有典籍出处）'} · 点一下填入
          </h3>
          <div className="flex flex-wrap gap-2">
            {randoms.map((nm) => {
              const hit = findCombo(nm);
              return (
                <button key={nm} onClick={() => applyRandom(nm)}
                  className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600">
                  <span className="font-serif text-lg">{nm}</span>
                  <span className="ml-2 text-xs text-neutral-500">{hit ? `· ${BOOK_LABEL[hit.book]}` : '· 无出处'}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {pairHints.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs text-neutral-500">
            与「{chars[0] || chars[1]}」在典籍同一句读里搭配过的字（{pairHints.length} 个）· 点一下填入
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {pairHints.map((h) => (
              <button key={h.ch} onClick={() => setChar(chars[0] ? 1 : 0, h.ch)} title={`${h.name} · 《${BOOK_LABEL[h.book]}·${h.title}》`}
                className="rounded px-2.5 py-1 font-serif text-base ring-1 ring-neutral-200 hover:bg-amber-50 dark:ring-neutral-700 dark:hover:bg-neutral-800">
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
  return base.filter((ch) => readings(ch).some((r) => r.syl.startsWith(needle) || r.mark.toLowerCase().startsWith(needle)));
}
