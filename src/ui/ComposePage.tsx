import { useEffect, useMemo, useState } from 'react';
import Compose from './Compose';
import TopNav from './TopNav';
import { cleanSurname } from '../engine/name';
import { BOOK_LABEL, BOOK_ORDER, type Opts, type Result, type ShareName } from '../engine/types';
import * as store from '../store/local';
import { copyText, renderShareCard, resultSummary } from '../lib/share';

export default function ComposePage() {
  const [surname, setSurname] = useState(store.loadSurname());
  const [reading, setReading] = useState(store.loadReading());
  const [opts] = useState<Opts>(() => ({ ...store.loadOpts(), exclude: [] }));
  const [fav, setFav] = useState<store.FavRecord[]>(store.loadFavorites);
  const [block] = useState<string[]>(store.loadBlocklist);
  const [theme, setTheme] = useState<store.Theme>(() => store.loadTheme());
  const [notice, setNotice] = useState<string | null>(null);

  const sur = cleanSurname(surname);
  const effective: Opts = useMemo(() => ({ ...opts, exclude: [...block] }), [opts, block]);
  const favIds = useMemo(() => new Set(fav.map((f) => f.id)), [fav]);

  const changeSurname = (s: string) => {
    if (cleanSurname(s) !== sur) setReading(0);
    setSurname(s);
  };

  useEffect(() => store.saveSurname(sur), [sur]);
  useEffect(() => store.saveReading(reading), [reading]);
  useEffect(() => store.saveOpts(opts), [opts]);
  useEffect(() => {
    store.saveTheme(theme);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', store.resolveDark(theme));
    apply();
    if (!mq || theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const doShare = async (r: Result | ShareName) => {
    const url = new URL('./compose.html', window.location.href);
    const blob = await renderShareCard(r, undefined, url.toString());
    const name = r.full;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setNotice(`已复制「${name}」分享卡图片`);
    } catch {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}-分享卡.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      setNotice(`已下载「${name}」分享卡图片`);
    }
  };

  const doCopy = async (r: Result | ShareName) => {
    const text = resultSummary(r);
    await copyText(text);
    setNotice('已复制到剪贴板');
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-neutral-900 focus:px-3 focus:py-2 focus:text-white">跳到内容</a>
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 no-print">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-serif text-2xl">自选组合</h1>
            <p className="mt-0.5 text-xs text-neutral-500">自选姓氏与用字 · 随机推荐有出处的组合 · 实时核对读音/字义/出处</p>
          </div>
          <TopNav current="compose" favCount={fav.length} blockCount={block.length} />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center gap-2 text-sm no-print">
          <button onClick={() => setTheme(store.THEME_ORDER[(store.THEME_ORDER.indexOf(theme) + 1) % store.THEME_ORDER.length])} aria-label={`主题：${store.THEME_LABEL[theme]}（点击切换）`}
            className="rounded px-3 py-1.5 ring-1 ring-neutral-200 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800">
            主题 · {store.THEME_LABEL[theme]}
          </button>
        </div>

        {notice && (
          <p aria-live="polite" className="rounded bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 no-print">
            {notice}
          </p>
        )}

        <Compose
          surname={surname}
          setSurname={changeSurname}
          reading={reading}
          setReading={setReading}
          opts={effective}
          fav={favIds}
          onFav={(r: Result) => {
            if (favIds.has(r.id)) {
              setFav(store.removeFavorite(r.id));
              setNotice(`已取消收藏 ${r.full}`);
            } else {
              setFav(store.addFavorite(r.id));
              setNotice(`已收藏 ${r.full}`);
            }
          }}
          onShare={(r) => void doShare(r)}
          onCopy={(r) => void doCopy(r)}
        />

        <footer className="pt-2 text-xs leading-5 text-neutral-500 no-print">
          候选池 Pool-B {BOOK_ORDER.map((b) => BOOK_LABEL[b]).join(' / ')} · 数据 {Math.round(1505)} 条双名 + 216 字单名出处 · 完全离线。
          <br />
          本应用不做五行筛选、不做八字五格、不判吉凶。只做可核对的事实。
        </footer>
      </main>
    </div>
  );
}
