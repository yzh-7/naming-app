import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { plan, scoreItem, findItem, poolSize, cleanSurname, isKnownSurname, surnameReads, shapeTags, popularity, glossOf, lineGlossOf, namePinyin, popScore } from './engine/name';
import { META } from './engine/data';
import { BOOK_LABEL, BOOK_ORDER, type Opts, type Result, type ShareName } from './engine/types';
import Controls from './ui/Controls';
import NameCard from './ui/NameCard';
import TopNav from './ui/TopNav';
import { type Tab } from './ui/TopNav';
import ThemeControl from './ui/ThemeControl';
import Compose from './ui/Compose';
import * as store from './store/local';
import { buildState, serialize, parseState, toQuery, fromQuery, type SavedState } from './store/transfer';
import { copyText, downloadText, downloadBlob, renderShareCard, renderListCard, resultSummary } from './lib/share';
import { candidatesCsv, candidatesJson } from './lib/candidates';
import { usePwa } from './lib/pwa';

type Pair = { rec: store.FavRecord; r: Result };
type FavSort = 'recent' | 'score' | 'strokes' | 'popular';

const FAV_SORTS: { v: FavSort; label: string }[] = [
  { v: 'recent', label: '最近收藏' },
  { v: 'score', label: '分数高→低' },
  { v: 'strokes', label: '笔画少→多' },
  { v: 'popular', label: '用字常见度' },
];

// 导航链接写成 #/compose，也兼容手写的 #compose；未知/空一律回生成页
function tabFromHash(hash: string): Tab {
  const h = hash.replace(/^#\/?/, '');
  return h === 'compose' || h === 'fav' || h === 'block' ? h : 'gen';
}

export default function App() {
  const initialUrl = useMemo(() => fromQuery(window.location.search), []);
  const [tab, setTab] = useState<Tab>(() => tabFromHash(window.location.hash));
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
    const onHash = () => setTab(tabFromHash(window.location.hash));
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
  // 候选全量导出：count:0＝一屏全展，paginate 会把整个筛选结果放进同一页，导出的就是「翻不完的池」本身
  const doExportCandidates = (fmt: 'csv' | 'json') => {
    const all = plan(sur, { ...effective, count: 0 }, 0, reading).page;
    if (!all.length) { setNotice('当前筛选没有候选可导出'); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'csv') downloadText(candidatesCsv(all), `候选-${sur || '无姓'}-${stamp}.csv`, 'text/csv');
    else downloadText(candidatesJson(all), `候选-${sur || '无姓'}-${stamp}.json`);
    setNotice(`已导出候选 ${all.length} 条（当前筛选全量，不只这一屏）`);
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
    <div className="min-h-dvh bg-canvas text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-ctl focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-btn-ink">跳到内容</a>
      {/* 页头常驻且粘在顶部：四个页都在同一位置看到导航与昼夜切换 */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md no-print">
        {/* 手机两行：第一行 徽标+站名+昼夜切换，第二行整宽页签；≥640px 收回一行 */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5 sm:gap-y-2 sm:py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-ctl bg-accent font-serif text-body text-accent-btn-ink">名</span>
            <div className="min-w-0">
              <h1 className="font-serif text-title leading-tight">取名<span className="hidden xs:inline"> · 典籍取词</span></h1>
              <p className="mt-0.5 hidden truncate text-meta text-ink-3 xl:block">{BOOK_ORDER.map((b) => BOOK_LABEL[b]).join(' / ')} · 起点落音步、同句读内取两字 + 名用字白名单 · 完全离线</p>
            </div>
          </div>
          <div className="ml-auto shrink-0 sm:order-3">
            <ThemeControl theme={theme} setTheme={setTheme} />
          </div>
          <TopNav current={tab} favCount={fav.length} blockCount={block.length} onNavigate={(t) => setTab(t)}
            className="order-last w-full sm:order-2 sm:ml-auto sm:w-auto" />
        </div>
      </header>

      <main id="main" className="anchor-offset mx-auto max-w-6xl space-y-4 px-4 py-4 sm:py-6">
        {offline && (
          <p className="rounded-card border border-warn-line bg-warn-soft px-3 py-2 text-meta text-warn no-print">离线模式：数据都来自本机缓存，功能正常。</p>
        )}
        {updateReady && (
          <p className="flex flex-wrap items-center gap-2 rounded-card border border-cool-line bg-cool-soft px-3 py-2 text-meta text-cool no-print">
            有新版本可用。
            <button onClick={applyUpdate} className="btn">刷新</button>
          </p>
        )}

        {pendingImport && (
          <div role="dialog" aria-label="导入方式" className="space-y-3 rounded-card border border-accent-line bg-accent-soft p-4 text-body text-accent-ink no-print">
            <p>这份文件含收藏 {pendingImport.favorites.length} 条 · 拉黑 {pendingImport.blocklist.length} 条。与现有数据怎么合？</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => confirmImport('merge')} className="btn-primary">合并（保留两边）</button>
              <button onClick={() => confirmImport('replace')} className="btn btn-quiet">覆盖</button>
              <button onClick={() => setPendingImport(null)} className="btn btn-quiet">取消</button>
            </div>
          </div>
        )}

        {/* 操作反馈放在屏幕底部，手机上不挤动正文；aria-live 保持不变 */}
        <div aria-live="polite" className={notice ? 'fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pt-3 pb-safe no-print' : 'sr-only'}>
          {notice && <span className="max-w-[min(36rem,100%)] rounded-card border border-line-strong bg-surface px-3 py-2 text-meta text-ink">{notice}</span>}
        </div>

        {tab === 'gen' && (
          /* 宽屏两栏：左边筛选常驻（粘顶），右边结果栅格；窄屏退回单列，筛选在上 */
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(19rem,21.5rem)_minmax(0,1fr)] xl:gap-6">
            <div className="min-w-0 space-y-3 no-print xl:sticky xl:top-[5.25rem] xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
              <Controls surname={surname} setSurname={changeSurname} reading={reading} setReading={setReading}
                opts={opts} setOpts={setOpts}
                poolCount={poolCount} pageNo={paged.pageNo} pages={paged.pages}
                onBatch={() => setBatch(batch + 1)} />
              <div className="flex flex-wrap gap-2">
                <button onClick={doExport} className="btn btn-quiet">导出</button>
                <button onClick={() => doExportCandidates('csv')} disabled={poolCount === 0} title="把当前筛选命中的全部候选（不只这一屏）存成表格，Excel/WPS 可直接打开"
                  className="btn btn-quiet">候选CSV</button>
                <button onClick={() => doExportCandidates('json')} disabled={poolCount === 0} title="同一份候选全量清单的 JSON 版，适合程序处理"
                  className="btn btn-quiet">候选JSON</button>
                <button onClick={() => fileRef.current?.click()} className="btn btn-quiet">导入</button>
                <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-hidden="true"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImportFile(f); e.target.value = ''; }} />
                <button onClick={doCopyLink} className="btn btn-quiet">复制链接</button>
              </div>
            </div>

            <div className="min-w-0 space-y-4">
              {!sur && (
                <p className="measure mx-auto rounded-card border border-dashed border-line-strong bg-surface-2 p-6 text-center text-meta leading-6 text-ink-3">
                  先填姓氏。名字的起点落在典籍原句的音步边界上，第二个字取同句读内隔 0–2 字的位置，两字都须在名用字表内。
                </p>
              )}
              {sur && !knownSur && (
                <p className="rounded-card border border-warn-line bg-warn-soft p-4 text-body leading-7 text-warn">
                  「{sur}」有字不在读音表（通用规范汉字表 8105 字）内，声调、谐音、生僻这些音韵检查这次没有跑，卡片上的读音与分数只反映了典籍那一侧。
                </p>
              )}
              {sur && results.length === 0 && (
                <p className="rounded-card border border-dashed border-line-strong bg-surface-2 p-6 text-center text-meta leading-6 text-ink-3">
                  这个条件下没有剩余候选。{opts.search ? '试试清空搜索；' : ''}{opts.strokeMax || opts.popFloor || opts.noMonotone ? '试试放宽笔画/常见度/结构筛选；' : ''}{opts.redupOnly ? '当前开着「只看典籍叠字」，先取消它；' : ''}其余可能是典籍全选关或都已拉黑。
                </p>
              )}
              <p aria-live="polite" className="sr-only">共 {poolCount} 条候选，第 {paged.pageNo + 1} 页，共 {paged.pages} 页</p>
              {grouped.map(([book, list]) => (
                <section key={book} className="space-y-2.5">
                  <h2 className="text-meta text-ink-3">
                    <span className="font-medium text-ink-2">{BOOK_LABEL[book]}</span> · {list.length} 条
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
            </div>
          </div>
        )}

        {tab === 'compose' && (
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
        )}

        {tab === 'fav' && (
          <div className="max-w-4xl space-y-3">
            <p className="measure text-meta leading-6 text-ink-3 no-print">
              收藏存在本机浏览器，换设备不同步；分数会随姓氏读音选择重新计算。可加备注/分组，勾选 2–3 个做对比。导出可备份迁移。
            </p>
            <div className="flex flex-wrap items-center gap-2 no-print">
              <input value={favQuery} onChange={(e) => setFavQuery(e.target.value)} aria-label="搜索收藏" placeholder="名字 / 拼音 / 备注 / 分组"
                className="field w-full sm:w-56" />
              <select value={favSort} onChange={(e) => setFavSort(e.target.value as FavSort)} aria-label="收藏排序" className="field">
                {FAV_SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
              <button onClick={() => void doExportList()} disabled={favView.length === 0} className="btn btn-quiet">导出名单图</button>
              <button onClick={doPrint} disabled={favView.length === 0} className="btn btn-quiet">打印名单</button>
            </div>
            {favGroups.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 no-print">
                <span className="lab">分组</span>
                {['', ...favGroups].map((g) => (
                  <button key={g || '__all'} onClick={() => setFavGroup(g)} aria-pressed={favGroup === g}
                    className={`chip ${favGroup === g ? 'chip-accent' : 'text-ink-3'}`}>
                    {g || '全部'}
                  </button>
                ))}
              </div>
            )}
            {compare.length >= 2 && <Compare pairs={favPairs.filter((p) => compare.includes(p.rec.id))} />}
            {favView.length === 0 ? (
              <p className="rounded-card border border-dashed border-line-strong bg-surface-2 p-6 text-center text-meta text-ink-3">
                {favPairs.length === 0 ? '还没有条目。' : '没有符合搜索/分组的条目。'}
              </p>
            ) : favView.map(({ rec, r }) => (
              <div key={r.id} className="space-y-2">
                <NameCard r={r} fav blocked={false} onFav={() => toggleFav(r)} onBlock={() => toggleBlock(r)} onShare={() => void doShare(r)} onCopy={() => void doCopy(r)} />
                <div className="flex flex-wrap items-center gap-2 px-1 no-print">
                  <label className="flex min-h-11 items-center gap-1.5">
                    <input type="checkbox" checked={compare.includes(rec.id)} onChange={() => toggleCompare(rec.id)}
                      className="size-6 accent-accent" />
                    <span className="text-meta text-ink-3">对比</span>
                  </label>
                  <label className="flex min-h-11 items-center gap-1.5">
                    <span className="text-meta text-ink-3">分组</span>
                    <input list="fav-groups" value={rec.group ?? ''} onChange={(e) => setFav(store.updateFavorite(rec.id, { group: e.target.value }))}
                      placeholder="如 女孩/备选" className="field w-full min-w-0 basis-32 sm:w-32" />
                  </label>
                  <datalist id="fav-groups">{favGroups.map((g) => <option key={g} value={g} />)}</datalist>
                  <label className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="text-meta text-ink-3">备注</span>
                    <input value={rec.note ?? ''} onChange={(e) => setFav(store.updateFavorite(rec.id, { note: e.target.value }))}
                      placeholder="为什么喜欢它" className="field min-w-0 basis-32 flex-1" />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'block' && (
          <div className="max-w-4xl space-y-3">
            <p className="text-meta leading-6 text-ink-3">拉黑后的名字不再出现在生成结果里，点卡片按钮可解除。</p>
            {blockList.length === 0 ? (
              <p className="rounded-card border border-dashed border-line-strong bg-surface-2 p-6 text-center text-meta text-ink-3">还没有条目。</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {blockList.map((r) => (
                  <NameCard key={r.id} r={r} fav={favIds.has(r.id)} blocked onFav={() => toggleFav(r)} onBlock={() => toggleBlock(r)} />
                ))}
              </div>
            )}
          </div>
        )}

        <footer className="max-w-4xl space-y-1.5 border-t border-line pt-4 text-meta leading-6 text-ink-3 no-print">
          <p className="measure">候选池 Pool-B {META.pool_B} 条（L0 名用字 {META.L0_size} 字{META.L0_added > 0 ? `＝cnname 全表种子 ${META.L0_seed}＋人工过字保留 ${META.L0_added}` : '（种子版）'}；相邻音步对 {META.by_gap.gap1} · 跨一字 {META.by_gap.gap2} · 跨两字 {META.by_gap.gap3}）· 单字名有对齐出处 {META.singles} 字 ·
            数据 {Math.round(META.ship_bytes_total / 1024)} KB（未压缩，全部打进应用包），运行时零网络请求。
            {sur && surnameReads(sur) > 1 && ' 你的姓首字是多音字，请在上方确认读音。'}</p>
          <details>
            <summary className="flex min-h-11 cursor-pointer select-none items-center text-ink-2 hover:text-ink lg:min-h-8">标注口径与数据来源（点开看）</summary>
            <p className="measure mt-1.5">卡片上的「部首」只是康熙字典五部（木{META.radical_dist.木}·火{META.radical_dist.火}·水{META.radical_dist.水}·金{META.radical_dist.金}·土{META.radical_dist.土} 共 {META.radical_chars} 字）的事实标注，覆盖 {META.radical_named}/{META.pool_B} 条双名；字义（本义）来自开放词典，用字常见度来自 114 万真实姓名用字频次（估算）。未标不代表该字无五行；本应用不做五行筛选、不做八字五格、不判吉凶。</p>
            <p className="measure mt-1.5">语料 chinese-poetry（MIT）＋ 乐府诗集（公共领域，维基文库整理本）＋ 道法 22 行手工录入 · 字表 general_standard_chinese（Apache-2.0）· 名用字种子 cnname（MIT）· 词频 jieba（MIT）· 字义/笔画/结构 chinese-dictionary（MIT）· 用字频次 Chinese-Names-Corpus（Apache-2.0）·
              部首 Unicode Unihan · 拼音仅构建期使用 pinyin-pro（MIT）。</p>
          </details>
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
    <div className="overflow-x-auto rounded-card border border-line bg-surface no-print">
      <table className="w-full min-w-[30rem] text-body">
        <caption className="sr-only">收藏对比</caption>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 text-left text-meta text-ink-3">对比</th>
            {pairs.map((p) => <th key={p.rec.id} scope="col" className="px-3 py-2 text-left font-serif text-title">{p.r.full}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-t border-line">
              <th scope="row" className="whitespace-nowrap px-3 py-2 text-left align-top text-meta text-ink-3">{label}</th>
              {pairs.map((p) => (<td key={p.rec.id} className="px-3 py-2 align-top text-ink-2">{f(p)}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
