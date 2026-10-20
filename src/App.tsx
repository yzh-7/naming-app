import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { plan, scoreItem, findItem, poolSize, genderStats, cleanSurname, isKnownSurname, surnameReads, shapeTags, popularity, glossOf, lineGlossOf, namePinyin, popScore } from './engine/name';
import { META } from './engine/data';
import { BOOK_LABEL, BOOK_ORDER, type Opts, type Result, type ShareName } from './engine/types';
import Controls from './ui/Controls';
import NameCard from './ui/NameCard';
import TopNav from './ui/TopNav';
import * as store from './store/local';
import { buildState, serialize, parseState, toQuery, fromQuery, type SavedState } from './store/transfer';
import { copyText, downloadText, downloadBlob, renderShareCard, renderListCard, resultSummary } from './lib/share';
import { usePwa } from './lib/pwa';

type Pair = { rec: store.FavRecord; r: Result };
type FavSort = 'recent' | 'score' | 'strokes' | 'popular';

const FAV_SORTS: { v: FavSort; label: string }[] = [
  { v: 'recent', label: '最近收藏' },
  { v: 'score', label: '分数高→低' },
  { v: 'strokes', label: '笔画少→多' },
  { v: 'popular', label: '用字常见度' },
];

export default function App() {
  const initialUrl = useMemo(() => fromQuery(window.location.search), []);
  const [tab, setTab] = useState<'gen' | 'fav' | 'block'>(() => {
    const h = window.location.hash.replace('#', '');
    return h === 'fav' || h === 'block' ? h : 'gen';
  });
  const [surname, setSurname] = useState(initialUrl?.surname ?? store.loadSurname());
  const [reading, setReading] = useState(initialUrl?.reading ?? store.loadReading());
  const [opts, setOpts] = useState<Opts>(() => ({ ...store.loadOpts(), ...(initialUrl?.opts ?? {}), exclude: [] }));
  const [batch, setBatch] = useState(0);
  const [fav, setFav] = useState<store.FavRecord[]>(store.loadFavorites);
  const [block, setBlock] = useState<string[]>(store.loadBlocklist);
  const [theme, setTheme] = useState<store.Theme>(() => store.loadTheme());
  const [compare, setCompare] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<SavedState | null>(null);
  const [favQuery, setFavQuery] = useState('');
  const [favSort, setFavSort] = useState<FavSort>('recent');
  const [favGroup, setFavGroup] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { offline, updateReady, applyUpdate } = usePwa();

  const sur = cleanSurname(surname);
  const knownSur = !sur || isKnownSurname(sur);

  const changeSurname = (s: string) => {
    if (cleanSurname(s) !== sur) setReading(0);
    setSurname(s);
  };

  useEffect(() => store.saveSurname(sur), [sur]);
  useEffect(() => store.saveReading(reading), [reading]);
  useEffect(() => store.saveOpts(opts), [opts]);
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '');
      if (h === 'fav' || h === 'block') setTab(h);
      else setTab('gen');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    store.saveTheme(theme);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', store.resolveDark(theme));
    apply();
    if (!mq || theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const effective: Opts = useMemo(() => ({ ...opts, exclude: [...block] }), [opts, block]);
  const paged = useMemo(
    () => (sur ? plan(sur, effective, batch, reading) : { page: [], pageNo: 0, pages: 0, pool: 0 }),
    [sur, effective, batch, reading],
  );
  const results = paged.page;
  const poolCount = useMemo(() => poolSize(effective), [effective]);
  const poolSame = useMemo(() => (opts.gender === 'any' ? null : genderStats(effective).same), [effective, opts.gender]);

  const scored = useCallback(
    (id: string) => { const it = findItem(id); return it ? scoreItem(sur, it, effective, reading) : null; },
    [sur, effective, reading],
  );
  const favPairs: Pair[] = useMemo(
    () => fav.map((rec) => { const r = scored(rec.id); return r ? { rec, r } : null; }).filter((x): x is Pair => !!x),
    [fav, scored],
  );
  const blockList = useMemo(
    () => block.map((id) => scored(id)).filter((x): x is Result => !!x),
    [block, scored],
  );
  const favGroups = useMemo(() => [...new Set(fav.map((f) => f.group).filter(Boolean))] as string[], [fav]);
  const favView = useMemo(() => {
    const q = favQuery.trim().toLowerCase();
    let list = favPairs;
    if (favGroup) list = list.filter((p) => p.rec.group === favGroup);
    if (q) list = list.filter(({ rec, r }) => `${r.full} ${namePinyin(r.name)} ${r.title} ${rec.note ?? ''} ${rec.group ?? ''}`.toLowerCase().includes(q));
    const out = [...list];
    if (favSort === 'score') out.sort((a, b) => b.r.total - a.r.total);
    else if (favSort === 'strokes') out.sort((a, b) => shapeTags(a.r.name).strokes - shapeTags(b.r.name).strokes);
    else if (favSort === 'popular') out.sort((a, b) => popScore(b.r.name) - popScore(a.r.name));
    return out;
  }, [favPairs, favQuery, favGroup, favSort]);

  const grouped = useMemo(() => {
    const m = new Map<string, Result[]>();
    for (const r of results) m.set(r.book, [...(m.get(r.book) ?? []), r]);
    return BOOK_ORDER.filter((b) => m.has(b)).map((b) => [b, m.get(b)!] as const);
  }, [results]);

  const favIds = useMemo(() => new Set(fav.map((f) => f.id)), [fav]);
  const toggleFav = (r: Result) => setFav(favIds.has(r.id) ? store.removeFavorite(r.id) : store.addFavorite(r.id));
  const toggleBlock = (r: Result) => setBlock(block.includes(r.id) ? store.removeBlock(r.id) : store.addBlock(r.id));
  const toggleCompare = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 3 ? c : [...c, id]));

  const doExport = () => {
    const st = buildState({ surname: sur, reading, opts, favorites: fav, blocklist: block });
    downloadText(serialize(st), `naming-${new Date().toISOString().slice(0, 10)}.json`);
    setNotice(`已导出：收藏 ${fav.length} · 拉黑 ${block.length}`);
  };
  const doImportFile = async (file: File) => {
    const st = parseState(await file.text());
    if (!st) { setNotice('导入失败：不是本应用的导出文件（缺少 favorites / opts）'); return; }
    setPendingImport(st);
  };
  const confirmImport = (mode: 'merge' | 'replace') => {
    if (!pendingImport) return;
    const st = pendingImport;
    setSurname(st.surname); setReading(st.reading); setOpts(st.opts); setBatch(0);
    if (mode === 'merge') {
      const map = new Map(store.loadFavorites().map((r) => [r.id, r]));
      for (const r of st.favorites) if (!map.has(r.id)) map.set(r.id, r);
      setFav(store.saveFavorites([...map.values()]));
      setBlock(store.saveBlocklist([...new Set([...store.loadBlocklist(), ...st.blocklist])]));
    } else {
      setFav(store.saveFavorites(st.favorites));
      setBlock(store.saveBlocklist(st.blocklist));
    }
    setPendingImport(null);
    setNotice(`已导入（${mode === 'merge' ? '合并' : '覆盖'}）：收藏 ${st.favorites.length} · 拉黑 ${st.blocklist.length}`);
  };
  const doCopyLink = async () => {
    const q = toQuery({ surname: sur, reading, opts });
    const url = `${location.origin}${location.pathname}${q ? `?${q}` : ''}`;
    setNotice((await copyText(url)) ? '链接已复制（只含当前筛选，不含收藏）' : '复制失败，请手动复制地址栏');
  };
  const doShare = async (r: Result | ShareName) => {
    const blob = await renderShareCard(r, undefined, `${location.origin}${location.pathname}`);
    downloadBlob(blob, `${r.full}-${r.book}.png`);
    setNotice('分享卡片已生成（含扫码二维码）');
  };
  const doCopy = async (r: Result | ShareName) => {
    setNotice((await copyText(resultSummary(r))) ? '名字信息已复制' : '复制失败');
  };
  const doExportList = async () => {
    const entries = favView.map(({ rec, r }) => ({ r, note: rec.note }));
    const blob = await renderListCard(entries, { title: sur ? `${sur} · 备选名单` : '取名 · 备选名单' });
    downloadBlob(blob, `名单-${new Date().toISOString().slice(0, 10)}.png`);
    setNotice(`名单图已生成（${entries.length} 条）`);
  };
  const doPrint = () => { setTab('fav'); setTimeout(() => window.print?.(), 60); };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-neutral-900 focus:px-3 focus:py-2 focus:text-white">跳到内容</a>
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 no-print">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h1 className="font-serif text-2xl">取名 · 典籍取词</h1>
            <p className="mt-0.5 text-xs text-neutral-500">{BOOK_ORDER.map((b) => BOOK_LABEL[b]).join(' / ')} · 起点落音步、同句读内取两字 + 名用字白名单 · 完全离线</p>
          </div>
          <TopNav current={tab} favCount={fav.length} blockCount={block.length} onNavigate={(t) => setTab(t)} />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {offline && (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 no-print">离线模式：数据都来自本机缓存，功能正常。</p>
        )}
        {updateReady && (
          <p className="flex items-center gap-2 rounded bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-200 no-print">
            有新版本可用。
            <button onClick={applyUpdate} className="rounded bg-sky-900 px-2 py-1 text-xs text-white">刷新</button>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm no-print">
          <button onClick={doExport} className="rounded px-3 py-1.5 ring-1 ring-neutral-200 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800">导出</button>
          <button onClick={() => fileRef.current?.click()} className="rounded px-3 py-1.5 ring-1 ring-neutral-200 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800">导入</button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-hidden="true"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImportFile(f); e.target.value = ''; }} />
          <button onClick={doCopyLink} className="rounded px-3 py-1.5 ring-1 ring-neutral-200 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800">复制链接</button>
          <button onClick={() => setTheme(store.THEME_ORDER[(store.THEME_ORDER.indexOf(theme) + 1) % store.THEME_ORDER.length])} aria-label={`主题：${store.THEME_LABEL[theme]}（点击切换）`}
            className="rounded px-3 py-1.5 ring-1 ring-neutral-200 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800">
            主题 · {store.THEME_LABEL[theme]}
          </button>
        </div>

        {pendingImport && (
          <div role="dialog" aria-label="导入方式" className="space-y-2 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900 no-print">
            <p>这份文件含收藏 {pendingImport.favorites.length} 条 · 拉黑 {pendingImport.blocklist.length} 条。与现有数据怎么合？</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => confirmImport('merge')} className="rounded bg-neutral-900 px-3 py-1.5 text-white">合并（保留两边）</button>
              <button onClick={() => confirmImport('replace')} className="rounded px-3 py-1.5 ring-1 ring-neutral-300 hover:bg-white">覆盖</button>
              <button onClick={() => setPendingImport(null)} className="rounded px-3 py-1.5 ring-1 ring-neutral-300 hover:bg-white">取消</button>
            </div>
          </div>
        )}

        <p aria-live="polite" className={notice ? 'rounded bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 no-print' : 'sr-only'}>
          {notice}
        </p>

        {tab === 'gen' && (
          <>
            <Controls surname={surname} setSurname={changeSurname} reading={reading} setReading={setReading}
              opts={opts} setOpts={setOpts}
              poolCount={poolCount} poolSame={poolSame} pageNo={paged.pageNo} pages={paged.pages}
              onBatch={() => setBatch(batch + 1)} />
            {!sur && (
              <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
                先填姓氏。名字的起点落在典籍原句的音步边界上，第二个字取同句读内隔 0–2 字的位置，两字都须在名用字表内。
              </p>
            )}
            {sur && !knownSur && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                「{sur}」有字不在读音表（通用规范汉字表 8105 字）内，声调、谐音、生僻这些音韵检查这次没有跑，卡片上的读音与分数只反映了典籍那一侧。
              </p>
            )}
            {sur && results.length === 0 && (
              <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
                这个条件下没有剩余候选。{opts.search ? '试试清空搜索；' : ''}{opts.strokeMax || opts.popFloor || opts.noMonotone ? '试试放宽笔画/常见度/结构筛选；' : ''}{opts.redupOnly ? '当前开着「只看典籍叠字」，先取消它；' : ''}其余可能是典籍全选关或都已拉黑。
              </p>
            )}
            <p aria-live="polite" className="sr-only">共 {poolCount} 条候选，第 {paged.pageNo + 1} 页，共 {paged.pages} 页</p>
            {grouped.map(([book, list]) => (
              <section key={book} className="space-y-2">
                <h2 className="text-xs text-neutral-500">
                  {BOOK_LABEL[book]} · {list.length} 条
                  {list.some((r) => !r.strict) ? '（宽口径取词：长短句/散文/道法，务必看原句）' : '（音步严格）'}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {list.map((r) => (
                    <NameCard key={r.id} r={r} fav={favIds.has(r.id)} blocked={block.includes(r.id)}
                      onFav={() => toggleFav(r)} onBlock={() => toggleBlock(r)} onShare={() => void doShare(r)} onCopy={() => void doCopy(r)} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {tab === 'fav' && (
          <div className="space-y-3">
            <p className="text-xs text-neutral-500 no-print">
              收藏存在本机浏览器，换设备不同步；分数会随姓氏读音选择重新计算。可加备注/分组，勾选 2–3 个做对比。导出可备份迁移。
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm no-print">
              <input value={favQuery} onChange={(e) => setFavQuery(e.target.value)} aria-label="搜索收藏" placeholder="名字 / 拼音 / 备注 / 分组"
                className="w-44 rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
              <select value={favSort} onChange={(e) => setFavSort(e.target.value as FavSort)} aria-label="收藏排序"
                className="rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                {FAV_SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
              <button onClick={() => void doExportList()} disabled={favView.length === 0}
                className="rounded px-3 py-1.5 ring-1 ring-neutral-200 hover:bg-neutral-50 disabled:opacity-40 dark:ring-neutral-700 dark:hover:bg-neutral-800">导出名单图</button>
              <button onClick={doPrint} disabled={favView.length === 0}
                className="rounded px-3 py-1.5 ring-1 ring-neutral-200 hover:bg-neutral-50 disabled:opacity-40 dark:ring-neutral-700 dark:hover:bg-neutral-800">打印名单</button>
            </div>
            {favGroups.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs no-print">
                <span className="text-neutral-500">分组</span>
                {['', ...favGroups].map((g) => (
                  <button key={g || '__all'} onClick={() => setFavGroup(g)}
                    className={`rounded-full px-3 py-1 ring-1 ${favGroup === g ? 'bg-neutral-900 text-white ring-neutral-900' : 'text-neutral-500 ring-neutral-200 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800'}`}>
                    {g || '全部'}
                  </button>
                ))}
              </div>
            )}
            {compare.length >= 2 && <Compare pairs={favPairs.filter((p) => compare.includes(p.rec.id))} />}
            {favView.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
                {favPairs.length === 0 ? '还没有条目。' : '没有符合搜索/分组的条目。'}
              </p>
            ) : favView.map(({ rec, r }) => (
              <div key={r.id} className="space-y-2">
                <NameCard r={r} fav blocked={false} onFav={() => toggleFav(r)} onBlock={() => toggleBlock(r)} onShare={() => void doShare(r)} onCopy={() => void doCopy(r)} />
                <div className="flex flex-wrap items-center gap-2 px-1 text-sm no-print">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={compare.includes(rec.id)} onChange={() => toggleCompare(rec.id)}
                      className="size-4 accent-neutral-800" />
                    <span className="text-xs text-neutral-500">对比</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-xs text-neutral-500">分组</span>
                    <input list="fav-groups" value={rec.group ?? ''} onChange={(e) => setFav(store.updateFavorite(rec.id, { group: e.target.value }))}
                      placeholder="如 女孩/备选" className="w-28 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                  </label>
                  <datalist id="fav-groups">{favGroups.map((g) => <option key={g} value={g} />)}</datalist>
                  <label className="flex flex-1 items-center gap-1.5">
                    <span className="text-xs text-neutral-500">备注</span>
                    <input value={rec.note ?? ''} onChange={(e) => setFav(store.updateFavorite(rec.id, { note: e.target.value }))}
                      placeholder="为什么喜欢它" className="min-w-40 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'block' && (
          <div className="space-y-3">
            <p className="text-xs text-neutral-500">拉黑后的名字不再出现在生成结果里，点卡片按钮可解除。</p>
            {blockList.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">还没有条目。</p>
            ) : blockList.map((r) => (
              <NameCard key={r.id} r={r} fav={favIds.has(r.id)} blocked onFav={() => toggleFav(r)} onBlock={() => toggleBlock(r)} />
            ))}
          </div>
        )}

        <footer className="pt-2 text-xs leading-5 text-neutral-500 no-print">
          候选池 Pool-B {META.pool_B} 条（L0 名用字 {META.L0_size} 字{META.L0_added > 0 ? `＝cnname 全表种子 ${META.L0_seed}＋人工过字保留 ${META.L0_added}` : '（种子版）'}；相邻音步对 {META.by_gap.gap1} · 跨一字 {META.by_gap.gap2} · 跨两字 {META.by_gap.gap3}）· 单字名有对齐出处 {META.singles} 字 ·
          数据 {Math.round(META.ship_gz_total / 1024)} KB gzip，运行时零网络请求。
          <br />
          卡片上的「部首」只是康熙字典五部（木{META.radical_dist.木}·火{META.radical_dist.火}·水{META.radical_dist.水}·金{META.radical_dist.金}·土{META.radical_dist.土} 共 {META.radical_chars} 字）的事实标注，覆盖 {META.radical_named}/{META.pool_B} 条双名；字义（本义）来自开放词典，用字常见度来自 114 万真实姓名用字频次（估算）。未标不代表该字无五行；本应用不做五行筛选、不做八字五格、不判吉凶。
          {sur && surnameReads(sur) > 1 && ' 你的姓首字是多音字，请在上方确认读音。'}
          <br />
          语料 chinese-poetry（MIT）＋ 道法 22 行手工录入 · 字表 general_standard_chinese（Apache-2.0）· 名用字种子 cnname（MIT）· 词频 jieba（MIT）· 字义/笔画/结构 chinese-dictionary（MIT）· 用字频次 Chinese-Names-Corpus（Apache-2.0）·
          部首 Unicode Unihan · 拼音仅构建期使用 pinyin-pro（MIT）。
        </footer>
      </main>
    </div>
  );
}

function Compare({ pairs }: { pairs: Pair[] }) {
  const rows: [string, (p: Pair) => string][] = [
    ['名字', (p) => p.r.full],
    ['读音', (p) => p.r.readings.join(' ')],
    ['分数', (p) => `${p.r.total}`],
    ['性别风格', (p) => (p.r.gender.side === 'n' ? '中性' : `${p.r.gender.strong ? '' : '疑似'}${p.r.gender.side === 'f' ? '偏女' : '偏男'}`)],
    ['字义', (p) => [...new Set([...p.r.name])].map((ch) => (glossOf(ch) ? `${ch}·${glossOf(ch)}` : '')).filter(Boolean).join('；')],
    ['字形', (p) => { const s = shapeTags(p.r.name); return `${s.strokes} 画 · ${s.chars.map((c) => c.sx ?? '?').join('')}`; }],
    ['用字常见度', (p) => popularity(p.r.name).band],
    ['出处', (p) => `《${BOOK_LABEL[p.r.book]}·${p.r.title}》`],
    ['原句', (p) => p.r.line],
    ['今译', (p) => lineGlossOf(p.r)],
    ['备注', (p) => p.rec.note ?? ''],
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 no-print">
      <table className="w-full text-sm">
        <caption className="sr-only">收藏对比</caption>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 text-left text-xs text-neutral-500 dark:text-neutral-400">对比</th>
            {pairs.map((p) => <th key={p.rec.id} scope="col" className="px-3 py-2 text-left font-serif text-lg">{p.r.full}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-t border-neutral-100 dark:border-neutral-800">
              <th scope="row" className="whitespace-nowrap px-3 py-2 text-left align-top text-xs text-neutral-500">{label}</th>
              {pairs.map((p) => <td key={p.rec.id} className="px-3 py-2 align-top">{f(p)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
