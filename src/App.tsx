import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  plan,
  poolSize,
  scoreItem,
  findItem,
  cleanSurname,
  isKnownSurname,
  surnameReads,
  shapeTags,
  popularity,
  glossOf,
  lineGlossOf,
  namePinyin,
  popScore,
  resolveSaved,
  titleKey,
} from './engine/name';
import { APP_VERSION, META } from './engine/data';
import { traditionalRewrites, toSimplified } from './engine/simplified';
import { BOOK_LABEL, BOOK_ORDER, type Book, type Opts, type Result, type ShareName } from './engine/types';
import Controls, { useNarrowPane } from './ui/Controls';
import NameCard from './ui/NameCard';
import TopNav from './ui/TopNav';
import { type Tab } from './ui/TopNav';
import ThemeControl from './ui/ThemeControl';
import Compose from './ui/Compose';
import * as store from './store/local';
import { buildState, serialize, parseState, toQuery, fromQuery, type SavedState } from './store/transfer';
import { copyText, downloadText, downloadBlob, renderShareCard, renderListCard, resultSummary } from './lib/share';
import { candidatesCsv, candidatesJson, favoritesCsv, FAV_GENDER_LABEL } from './lib/candidates';
import { usePwa } from './lib/pwa';

type Pair = { rec: store.FavRecord; r: Result; stale: boolean };
// 收藏里的 id 查不到时按卡片记下的名字＋出处回退找；两条路都走不通就是「找不回来」的旧条目
// from 记的是「这条是从哪一页存进收藏的」，收藏页按它分「生成页／自选页／未记录」三档。
// 不确定的场合（从收藏页或拉黑页重新收藏）就不写这一项——落到「未记录」比编一个来源诚实。
const favSnap = (r: Result, from?: 'gen' | 'compose') => ({
  name: r.name,
  book: r.book,
  title: r.title,
  line: r.line,
  from,
});
const FAV_SOURCE_LABEL: Record<FavFilterSource, string> = {
  '': '全部',
  gen: '生成页',
  compose: '自选页',
  none: '未记录',
};
const FAV_GENDER_FILTERS: { v: FavFilterGender; label: string }[] = [
  { v: '', label: '性别不限' },
  { v: 'm', label: '偏男' },
  { v: 'n', label: '中性' },
  { v: 'f', label: '偏女' },
];
const num = (n: number) => n.toLocaleString('en-US');
type FavSort = 'recent' | 'score' | 'strokes' | 'popular';

// 导入的体积上限：8 MiB。实测本应用最大的一份导出（全量候选 JSON，1,525 条）是 618,163 B（0.59 MiB），
// 收藏/拉黑/设置那份更小；上限只用来在 JSON.parse 之前把几十兆的文件挡住，不去解析它。
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

type FavFilterSource = '' | 'gen' | 'compose' | 'none';
type FavFilterGender = '' | 'f' | 'm' | 'n';

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
// 页签写回地址栏：刷新停在同页、浏览器后退能退回上一页页签、复制的链接也带上当前页签
function hashFor(tab: Tab): string {
  return tab === 'gen' ? '#/' : `#/${tab}`;
}
const goTab = (t: Tab) => {
  if (window.location.hash !== hashFor(t)) window.location.hash = hashFor(t);
};

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
  // 撤销：收藏／拉黑／分组／导入这几步改的是本机存着的东西，点错一下没法自己复原。
  // 记的是「这一步之前的两份名单」；点撤销时先确认这一步之后没再动过它们——
  // 动过就明说失效，绝不拿旧快照覆盖用户后来的改动。
  type Step = {
    label: string;
    fav: store.FavRecord[];
    block: string[];
    afterFav: store.FavRecord[];
    afterBlock: string[];
  };
  const [undo, setUndo] = useState<Step | null>(null);
  const notify = (msg: string, step?: Step) => {
    setNotice(msg);
    setUndo(step ?? null);
  };
  const runUndo = () => {
    const u = undo;
    if (!u) return;
    const stale =
      JSON.stringify(fav) !== JSON.stringify(u.afterFav) || JSON.stringify(block) !== JSON.stringify(u.afterBlock);
    if (stale) {
      setUndo(null);
      notify('撤销失效：这一步之后又改过收藏或名单，不能拿旧状态覆盖它');
      return;
    }
    store.saveFavorites(u.fav);
    store.saveBlocklist(u.block);
    setFav(store.loadFavorites());
    setBlock(store.loadBlocklist());
    setUndo(null);
    notify(`已撤销：${u.label}`);
  };
  const [storageBroken, setStorageBroken] = useState(() => !store.storageUsable());
  const [pendingImport, setPendingImport] = useState<SavedState | null>(null);
  const [favQuery, setFavQuery] = useState('');
  const [favSort, setFavSort] = useState<FavSort>('recent');
  const [favGroup, setFavGroup] = useState('');
  // 收藏的两个快速筛选：按下的入口（生成页／自选页）与当时所属的性别档
  const [favFrom, setFavFrom] = useState<FavFilterSource>('');
  const [favGender, setFavGender] = useState<FavFilterGender>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const narrow = useNarrowPane();
  const { offline, updateReady, applyUpdate } = usePwa();

  const sur = cleanSurname(surname);
  const knownSur = !sur || isKnownSurname(sur);

  const changeSurname = (s: string) => {
    if (cleanSurname(s) !== sur) setReading(0);
    setSurname(s);
  };

  // 本机存储不可用（隐私模式、配额写满、站点策略禁用）时写入不再抛出，但必须让人看见「这次没保存」。
  // 只有这一条路：存储层在第一次写失败时通知，界面上不再每个动作各自查一遍（那是同一件事的第六份实现）
  useEffect(() => store.subscribeStorageFailure(() => setStorageBroken(true)), []);

  // 换页时回到顶部：粘性页头常驻，若沿上一页的滚动位置落下，第一张卡片会被页头压在下面
  useEffect(() => {
    if (window.scrollY > 0) window.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    store.saveSurname(sur);
  }, [sur]);
  useEffect(() => {
    store.saveReading(reading);
  }, [reading]);
  useEffect(() => {
    store.saveOpts(opts);
  }, [opts]);
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
    () =>
      sur
        ? plan(sur, effective, batch, reading)
        : { page: [], pageNo: 0, pages: 0, pool: 0, titleCounts: new Map<string, number>() },
    [sur, effective, batch, reading],
  );
  const results = paged.page;
  // plan() 已经数过一遍就不再数第二遍；没填姓时 plan 不跑，池子规模仍然要写进摘要——
  // 否则首屏只剩一片空白，用户看不出这套语料到底有多少名字可挑（0.11.0 一度把这一行丢了）
  const poolCount = sur ? paged.pool : poolSize(effective);

  const scored = useCallback(
    (id: string) => {
      const it = findItem(id);
      return it ? scoreItem(sur, it, effective, reading) : null;
    },
    [sur, effective, reading],
  );
  const favPairs: Pair[] = useMemo(() => {
    const out: Pair[] = [];
    for (const rec of fav) {
      const m = resolveSaved(rec);
      if (m.item) out.push({ rec, r: scoreItem(sur, m.item, effective, reading), stale: m.by === 'name' });
    }
    return out;
  }, [fav, sur, effective, reading]);
  // 禁用字只筛生成页，收藏不跟着筛：那是用户自己存下来的名字，悄悄藏起来比说明更糟。
  // 这里只数出「含禁用字的收藏有几条」并在收藏页写明白。
  const favAvoidHits = useMemo(() => {
    const ac = opts.avoidChars;
    if (!ac) return 0;
    return favPairs.filter((p) => [...p.r.name].some((c) => ac.includes(c))).length;
  }, [favPairs, opts.avoidChars]);
  const favLost = useMemo(() => {
    const ids = new Set(favPairs.map((p) => p.rec.id));
    return fav.filter((rec) => !ids.has(rec.id));
  }, [fav, favPairs]);
  const blockList = useMemo(() => block.map((id) => scored(id)).filter((x): x is Result => !!x), [block, scored]);
  const favGroups = useMemo(() => [...new Set(fav.map((f) => f.group).filter(Boolean))] as string[], [fav]);
  const favView = useMemo(() => {
    // 收藏页的搜索也归一：备注里写的是简体，输入繁体也应当搜得到（表外的字符原样留着）
    const q = toSimplified(favQuery.trim()).toLowerCase();
    let list = favPairs;
    if (favGroup) list = list.filter((p) => p.rec.group === favGroup);
    if (favFrom) list = list.filter((p) => (p.rec.from ?? 'none') === favFrom);
    // 老记录没存性别档时按当前条目重算：性别档只由用字决定，与筛选无关，重算不会变来变去
    if (favGender) list = list.filter((p) => p.r.gender.side === favGender);
    if (q)
      list = list.filter(({ rec, r }) =>
        `${r.full} ${namePinyin(r.name)} ${r.title} ${rec.note ?? ''} ${rec.group ?? ''}`.toLowerCase().includes(q),
      );
    const out = [...list];
    if (favSort === 'recent')
      out.sort((a, b) => (b.rec.ts ?? 0) - (a.rec.ts ?? 0)); // 「最近收藏」按收藏时间，不靠数组顺序碰运气
    else if (favSort === 'score') out.sort((a, b) => b.r.total - a.r.total);
    else if (favSort === 'strokes') out.sort((a, b) => shapeTags(a.r.name).strokes - shapeTags(b.r.name).strokes);
    else if (favSort === 'popular') out.sort((a, b) => popScore(b.r.name) - popScore(a.r.name));
    return out;
  }, [favPairs, favQuery, favGroup, favSort, favFrom, favGender]);

  const grouped = useMemo(() => {
    const m = new Map<string, Result[]>();
    for (const r of results) m.set(r.book, [...(m.get(r.book) ?? []), r]);
    // 真实人名档排在这七本之后：它不是一本书，混在典籍中间会让人以为它也有出处
    const groups: [Book, Result[]][] = BOOK_ORDER.filter((b) => m.has(b)).map((b) => [b, m.get(b)!]);
    if (m.has('real')) groups.push(['real', m.get('real')!]);
    return groups;
  }, [results]);

  const favIds = useMemo(() => new Set(fav.map((f) => f.id)), [fav]);
  const blockIds = useMemo(() => new Set(block), [block]);
  // from 只在「从哪一页存的」确实知道的时候写：生成页写 gen，自选页自己另有一条路；
  // 收藏页与拉黑页上的按钮此时多半是取消收藏，真要重新收藏就留空（进「未记录」）
  const toggleFav = (r: Result, from?: 'gen' | 'compose') => {
    const removing = favIds.has(r.id);
    const afterFav = removing ? store.removeFavorite(r.id) : store.addFavorite(r.id, favSnap(r, from));
    setFav(afterFav);
    notify(removing ? `已取消收藏 ${r.full}` : `已收藏 ${r.full}`, {
      label: removing ? `取消收藏 ${r.full}` : `收藏 ${r.full}`,
      fav,
      block,
      afterFav,
      afterBlock: block,
    });
  };
  const toggleBlock = (r: Result) => {
    const removing = block.includes(r.id);
    const afterBlock = removing ? store.removeBlock(r.id) : store.addBlock(r.id);
    setBlock(afterBlock);
    notify(removing ? `已取消拉黑 ${r.full}` : `已拉黑 ${r.full}`, {
      label: removing ? `取消拉黑 ${r.full}` : `拉黑 ${r.full}`,
      fav,
      block,
      afterFav: fav,
      afterBlock,
    });
  };
  // 分组改名 / 删组（连同条目一起删）。改名后当前视图跟到新名字上
  const doRenameGroup = (from: string, to: string) => {
    if (!to || to === from) return;
    const afterFav = store.renameGroup(from, to);
    setFav(afterFav);
    setFavGroup(to);
    notify(`分组「${from}」已改名为「${to}」`, {
      label: `把分组「${from}」改名为「${to}」`,
      fav,
      block,
      afterFav,
      afterBlock: block,
    });
  };
  const doDeleteGroup = (g: string) => {
    const before = fav.filter((f) => f.group === g).length;
    const afterFav = store.clearGroup(g);
    setFav(afterFav);
    setFavGroup('');
    notify(`分组「${g}」已解散，${before} 条收藏回到未分组（收藏本身没删）`, {
      label: `解散分组「${g}」`,
      fav,
      block,
      afterFav,
      afterBlock: block,
    });
  };
  // 对比最多 3 个：到上限时说明白，不要静默不勾（原来点了第四个什么都不发生）
  const toggleCompare = (id: string) => {
    if (compare.includes(id)) setCompare(compare.filter((x) => x !== id));
    else if (compare.length >= 3) notify('对比最多 3 个：先取消一个再勾新的');
    else setCompare([...compare, id]);
  };

  const doExportFavCsv = () => {
    // 收藏的分组与备注存在 rec 上，不在候选条目里：导出时要显式带上，否则这两列会是空的
    const rows = favView.map((p) => ({
      r: p.r,
      group: p.rec.group,
      note: p.rec.note,
      from: p.rec.from,
    }));
    if (!rows.length) {
      notify('当前视图里没有条目可导出');
      return;
    }
    downloadText(
      favoritesCsv(rows),
      `收藏${favGroup ? `-${favGroup}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    notify(`已导出 CSV：${rows.length} 条${favGroup ? `（分组「${favGroup}」）` : '（全部）'}`);
  };
  const doExport = () => {
    const st = buildState({ surname: sur, reading, opts, favorites: fav, blocklist: block, theme });
    downloadText(serialize(st), `naming-${new Date().toISOString().slice(0, 10)}.json`);
    notify(`已导出：收藏 ${fav.length} · 拉黑 ${block.length}`);
  };
  // 候选全量导出：count:0＝一屏全展，paginate 会把整个筛选结果放进同一页，导出的就是「翻不完的池」本身
  const doExportCandidates = (fmt: 'csv' | 'json') => {
    const all = plan(sur, { ...effective, count: 0 }, 0, reading).page;
    if (!all.length) {
      notify('当前筛选没有候选可导出');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'csv') downloadText(candidatesCsv(all), `候选-${sur || '无姓'}-${stamp}.csv`, 'text/csv');
    else downloadText(candidatesJson(all), `候选-${sur || '无姓'}-${stamp}.json`);
    notify(`已导出候选 ${all.length} 条（当前筛选全量，不只这一屏）`);
  };
  const doImportFile = async (file: File) => {
    // 先看体积再读内容：不先挡住的话，一个几十兆的文件会先进内存再交给 JSON.parse
    if (file.size > MAX_IMPORT_BYTES) {
      notify(
        `导入失败：这个文件 ${(file.size / 1048576).toFixed(1)} MiB，超过 ${MAX_IMPORT_BYTES / 1048576} MiB 的上限。本应用自己导出的一份最大的（全量候选）是 0.6 MiB。`,
      );
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      notify('导入失败：这个文件读不出来（可能被浏览器拦下，或选完就被移走了）。请重新选一次。');
      return;
    }
    // File.size 只是选文件那一刻的报告值（选完被改过、或特殊文件系统报 0 都会漏过上面那道闸），
    // 读出来之后按实际字节再判一次
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_IMPORT_BYTES) {
      notify(
        `导入失败：这个文件实际 ${(bytes / 1048576).toFixed(1)} MiB，超过 ${MAX_IMPORT_BYTES / 1048576} MiB 的上限。`,
      );
      return;
    }
    const res = parseState(text);
    if (!res.ok) {
      notify(
        res.error === 'json'
          ? '导入失败：这个文件不是 JSON，读不出内容。'
          : res.error === 'foreign'
            ? '导入失败：这个文件里没有本应用的记录，认不出它是哪里导出的。'
            : '导入失败：这个文件里没有可导入的东西（收藏、拉黑、筛选设置都是空的）。',
      );
      return;
    }
    setPendingImport(res.state);
  };
  // 确认导入：先在内存里算出最终的两份名单，再一次性写盘与落 state，避免半途失败留下半套状态
  const confirmImport = (mode: 'merge' | 'replace') => {
    if (!pendingImport) return;
    const st = pendingImport;
    const beforeFav = store.loadFavorites();
    const beforeBlock = store.loadBlocklist();
    const nextFav =
      mode === 'merge'
        ? [...new Map([...store.loadFavorites(), ...st.favorites].map((r) => [r.id, r])).values()]
        : st.favorites;
    const nextBlock = mode === 'merge' ? [...new Set([...store.loadBlocklist(), ...st.blocklist])] : st.blocklist;
    store.saveFavorites(nextFav);
    store.saveBlocklist(nextBlock);
    setFav(store.loadFavorites());
    setBlock(store.loadBlocklist());
    setSurname(st.surname);
    setReading(st.reading);
    setOpts(st.opts);
    if (st.theme) setTheme(st.theme); // 老导出文件没有 theme 这一项：那就保持本机现在的主题
    setBatch(0);
    setPendingImport(null);
    const parts = [`收藏 ${st.favorites.length}`, `拉黑 ${st.blocklist.length}`];
    if (!st.favorites.length && !st.blocklist.length) parts.push('只有姓氏与筛选设置');
    notify(`已导入（${mode === 'merge' ? '合并' : '覆盖'}）：${parts.join(' · ')}`, {
      label: `导入（${mode === 'merge' ? '合并' : '覆盖'}）`,
      fav: beforeFav,
      block: beforeBlock,
      afterFav: store.loadFavorites(),
      afterBlock: store.loadBlocklist(),
    });
  };
  // 导入确认框：Escape 取消，打开即把焦点交给第一个按钮，关掉后还回原处
  const importBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pendingImport) return;
    const prev = document.activeElement as HTMLElement | null;
    importBoxRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingImport(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [pendingImport]);
  const doCopyLink = async () => {
    const q = toQuery({ surname: sur, reading, opts });
    const url = `${location.origin}${location.pathname}${q ? `?${q}` : ''}${hashFor(tab)}`;
    notify((await copyText(url)) ? '链接已复制（只含当前筛选与页签，不含收藏）' : '复制失败，请手动复制地址栏');
  };
  const doShare = async (r: Result | ShareName) => {
    const { blob, qr } = await renderShareCard(r, undefined, `${location.origin}${location.pathname}`);
    downloadBlob(blob, `${r.full}-${r.book}.png`);
    notify(qr ? '分享卡片已生成（含扫码二维码）' : '分享卡片已生成，但二维码没画出来（链接过长）');
  };
  const doCopy = async (r: Result | ShareName) => {
    notify((await copyText(resultSummary(r))) ? '名字信息已复制' : '复制失败');
  };
  const doExportList = async () => {
    const entries = favView.filter((p) => p.r).map((p) => ({ r: p.r!, note: p.rec.note }));
    if (!entries.length) {
      notify('当前视图里没有可画进名单图的条目。');
      return;
    }
    const { blob, qr } = await renderListCard(entries, {
      title: sur ? `${sur} · 备选名单` : '取名 · 备选名单',
      url: `${location.origin}${location.pathname}`,
    });
    downloadBlob(blob, `名单-${new Date().toISOString().slice(0, 10)}.png`);
    notify(`名单图已生成（${entries.length} 条）${qr ? '，含扫码二维码' : '，二维码没画出来（链接过长）'}`);
  };
  const doPrint = () => {
    setTimeout(() => window.print?.(), 60);
  };

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-ctl focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-btn-ink"
      >
        跳到内容
      </a>
      {/* 页头常驻且粘在顶部：四个页都在同一位置看到导航与昼夜切换 */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md no-print">
        {/* 手机两行：第一行 徽标+站名+昼夜切换，第二行整宽页签；≥640px 收回一行 */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5 sm:gap-y-2 sm:py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-ctl bg-accent font-serif text-body text-accent-btn-ink"
            >
              名
            </span>
            <div className="min-w-0">
              <h1 className="font-serif text-title leading-tight">
                取名<span className="hidden xs:inline"> · 典籍取词</span>
              </h1>
              <p className="mt-0.5 hidden truncate text-meta text-ink-3 xl:block">
                {BOOK_ORDER.map((b) => BOOK_LABEL[b]).join(' / ')} · 起点落音步、同句读内取两字 + 名用字表 · 完全离线
              </p>
            </div>
          </div>
          <div className="ml-auto shrink-0 sm:order-3">
            <ThemeControl theme={theme} setTheme={setTheme} />
          </div>
          <TopNav
            current={tab}
            favCount={fav.length}
            blockCount={block.length}
            onNavigate={(t) => {
              goTab(t);
              setTab(t);
            }}
            className="order-last w-full sm:order-2 sm:ml-auto sm:w-auto"
          />
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="anchor-offset mx-auto max-w-6xl space-y-4 px-4 py-4 sm:py-6 outline-none"
      >
        {offline && (
          <p className="rounded-card border border-warn-line bg-warn-soft px-3 py-2 text-meta text-warn no-print">
            离线模式：数据都来自本机缓存，功能正常。
          </p>
        )}
        {storageBroken && (
          <p className="rounded-card border border-warn-line bg-warn-soft px-3 py-2 text-meta text-warn no-print">
            本机存储不可用（隐私模式或已写满）。这一页照常能用，但收藏、拉黑与筛选不会保存，关掉页面就没了。
          </p>
        )}
        {updateReady && (
          <p className="flex flex-wrap items-center gap-2 rounded-card border border-cool-line bg-cool-soft px-3 py-2 text-meta text-cool no-print">
            有新版本可用。
            <button onClick={applyUpdate} className="btn">
              刷新
            </button>
          </p>
        )}

        {pendingImport && (
          <div
            ref={importBoxRef}
            role="dialog"
            aria-modal="true"
            aria-label="导入方式"
            className="space-y-3 rounded-card border border-accent-line bg-accent-soft p-4 text-body text-accent-ink no-print"
          >
            <p>
              这份文件含收藏 {pendingImport.favorites.length} 条 · 拉黑 {pendingImport.blocklist.length} 条
              {!pendingImport.favorites.length && !pendingImport.blocklist.length && '（只有姓氏与筛选设置）'}
              。与现有数据怎么合？按 Esc 取消。
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => confirmImport('merge')} className="btn-primary">
                合并（保留两边）
              </button>
              <button onClick={() => confirmImport('replace')} className="btn btn-quiet">
                覆盖
              </button>
              <button onClick={() => setPendingImport(null)} className="btn btn-quiet">
                取消
              </button>
            </div>
          </div>
        )}

        {/* 操作反馈放在屏幕底部，手机上不挤动正文；aria-live 保持不变 */}
        <div
          aria-live="polite"
          className={
            notice ? 'fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pt-3 pb-safe no-print' : 'sr-only'
          }
        >
          {notice && (
            <span className="flex max-w-[min(40rem,100%)] flex-wrap items-center gap-2 rounded-card border border-line-strong bg-surface px-3 py-2 text-meta text-ink">
              <span>{notice}</span>
              {undo && (
                <button type="button" onClick={runUndo} className="btn btn-outlined text-meta">
                  撤销「{undo.label}」
                </button>
              )}
            </span>
          )}
        </div>

        {tab === 'gen' && (
          /* 宽屏两栏：左边筛选常驻（粘顶），右边结果栅格；窄屏退回单列，筛选在上 */
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(19rem,21.5rem)_minmax(0,1fr)] xl:gap-6">
            <div className="min-w-0 space-y-3 no-print xl:sticky xl:top-[5.25rem] xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
              {/* 手机上引导语排在筛选之前：筛选收成四行之后它才终于落在首屏里，
                  排在筛选之后它就被推到 1000px 开外，没人看得见 */}
              {narrow && !sur && <FirstVisitNote />}
              <Controls
                surname={surname}
                setSurname={changeSurname}
                reading={reading}
                setReading={setReading}
                opts={opts}
                setOpts={setOpts}
                poolCount={poolCount}
                pageNo={paged.pageNo}
                pages={paged.pages}
                onBatch={() => setBatch(batch + 1)}
              />
              <div className="flex flex-wrap gap-2">
                <button onClick={doExport} className="btn btn-outlined">
                  导出
                </button>
                <button
                  onClick={() => doExportCandidates('csv')}
                  disabled={poolCount === 0}
                  title="把当前筛选命中的全部候选（不只这一屏）存成表格，Excel/WPS 可直接打开"
                  className="btn btn-outlined"
                >
                  候选CSV
                </button>
                <button
                  onClick={() => doExportCandidates('json')}
                  disabled={poolCount === 0}
                  title="同一份候选全量清单的 JSON 版，适合程序处理"
                  className="btn btn-outlined"
                >
                  候选JSON
                </button>
                <button onClick={() => fileRef.current?.click()} className="btn btn-outlined">
                  导入
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  aria-hidden="true"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void doImportFile(f);
                    e.target.value = '';
                  }}
                />
                <button onClick={doCopyLink} className="btn btn-outlined">
                  复制链接
                </button>
              </div>
            </div>

            <div className="min-w-0 space-y-4">
              {!narrow && !sur && <FirstVisitNote />}
              {sur && !knownSur && (
                <p className="rounded-card border border-warn-line bg-warn-soft p-4 text-body leading-7 text-warn">
                  「{sur}」有字不在读音表（通用规范汉字表 8105
                  字）内，声调、谐音、生僻这些音韵检查这次没有跑，卡片上的读音与分数只反映了典籍那一侧。
                </p>
              )}
              {sur && results.length === 0 && (
                <p className="rounded-card border border-dashed border-line-strong bg-surface-2 p-6 text-center text-meta leading-6 text-ink-3">
                  这个条件下没有剩余候选。{opts.search ? '试试清空搜索；' : ''}
                  {opts.title ? '当前只在看《' + opts.title + '》，点「不限篇」回到全部；' : ''}
                  {opts.avoidChars ? '禁用字「' + opts.avoidChars + '」也在滤，先点「不限」；' : ''}
                  {opts.strokeMax || opts.popFloor || opts.noMonotone ? '试试放宽笔画/常见度/结构筛选；' : ''}
                  {opts.redupOnly ? '当前开着「只看叠字」，先取消它；' : ''}其余可能是典籍全选关或都已拉黑。
                </p>
              )}
              <p aria-live="polite" className="sr-only">
                共 {poolCount} 条候选，第 {paged.pageNo + 1} 页，共 {paged.pages} 页
              </p>
              {grouped.map(([book, list]) => (
                <section key={book} className="space-y-2.5">
                  <h2 className="text-meta text-ink-3">
                    <span className="font-medium text-ink-2">{BOOK_LABEL[book]}</span> · {list.length} 条
                    {book === 'real'
                      ? '（真实姓名语料里的名字，非典籍出处）'
                      : list.some((r) => !r.strict)
                        ? '（宽口径取词：长短句/散文/道法，务必看原句）'
                        : '（音步严格）'}
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {list.map((r) => (
                      <NameCard
                        key={r.id}
                        r={r}
                        fav={favIds.has(r.id)}
                        blocked={block.includes(r.id)}
                        onFav={() => toggleFav(r, 'gen')}
                        onBlock={() => toggleBlock(r)}
                        onShare={() => void doShare(r)}
                        onCopy={() => void doCopy(r)}
                        onTitle={() => {
                          setOpts((o) => ({ ...o, title: r.title, search: '' }));
                          setBatch(0);
                          notify(`只看《${r.title}》里的候选`);
                        }}
                        onSameSound={() => {
                          setOpts((o) => ({ ...o, search: namePinyin(r.name), title: '' }));
                          setBatch(0);
                          notify(`按拼音「${namePinyin(r.name)}」搜索同音写法`);
                        }}
                        sameTitle={paged.titleCounts.get(titleKey(r))}
                      />
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
              const removing = favIds.has(r.id);
              const afterFav = removing ? store.removeFavorite(r.id) : store.addFavorite(r.id, favSnap(r, 'compose'));
              setFav(afterFav);
              notify(removing ? `已取消收藏 ${r.full}` : `已收藏 ${r.full}`, {
                label: removing ? `取消收藏 ${r.full}` : `收藏 ${r.full}`,
                fav,
                block,
                afterFav,
                afterBlock: block,
              });
            }}
            onShare={(r) => void doShare(r)}
            onCopy={(r) => void doCopy(r)}
          />
        )}

        {tab === 'fav' && (
          <div className="max-w-4xl space-y-3">
            <p className="measure text-meta leading-6 text-ink-3 no-print">
              收藏存在本机浏览器，换设备不同步；分数会随姓氏读音选择重新计算。可加备注/分组，勾选 2–3
              个做对比。导出可备份迁移。
            </p>
            <div className="flex flex-wrap items-center gap-2 no-print">
              <input
                value={favQuery}
                onChange={(e) => setFavQuery(e.target.value)}
                aria-label="搜索收藏"
                placeholder="名字 / 拼音 / 备注 / 分组"
                className="field w-full sm:w-56"
              />
              {traditionalRewrites(favQuery).length > 0 && (
                <p role="status" className="w-full text-meta text-ink-3">
                  按简体匹配：{traditionalRewrites(favQuery).join('、')}
                </p>
              )}
              <select
                value={favSort}
                onChange={(e) => setFavSort(e.target.value as FavSort)}
                aria-label="收藏排序"
                className="field"
              >
                {FAV_SORTS.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button onClick={() => void doExportList()} disabled={favView.length === 0} className="btn btn-outlined">
                导出名单图
              </button>
              <button
                onClick={doExportFavCsv}
                disabled={favView.length === 0}
                className="btn btn-outlined"
                title="按当前搜索、来源、性别档与分组视图导出 CSV，含备注、分组、收藏来源、性别档四列"
              >
                导出 CSV
              </button>
              <button onClick={doPrint} disabled={favView.length === 0} className="btn btn-outlined">
                打印名单
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 no-print">
              <span className="lab">收藏来源</span>
              {(['', 'gen', 'compose', 'none'] as FavFilterSource[]).map((v) => (
                <button
                  key={v || '__all'}
                  onClick={() => setFavFrom(v)}
                  aria-pressed={favFrom === v}
                  className={`chip ${favFrom === v ? 'chip-accent' : 'text-ink-3'}`}
                >
                  {FAV_SOURCE_LABEL[v]}
                </button>
              ))}
              <span className="lab ml-2">性别档</span>
              {FAV_GENDER_FILTERS.map(({ v, label }) => (
                <button
                  key={v || '__any'}
                  onClick={() => setFavGender(v)}
                  aria-pressed={favGender === v}
                  className={`chip ${favGender === v ? 'chip-accent' : 'text-ink-3'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {favGroups.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 no-print">
                <span className="lab">分组</span>
                {['', ...favGroups].map((g) => (
                  <button
                    key={g || '__all'}
                    onClick={() => setFavGroup(g)}
                    aria-pressed={favGroup === g}
                    className={`chip ${favGroup === g ? 'chip-accent' : 'text-ink-3'}`}
                  >
                    {g || '全部'}
                  </button>
                ))}
              </div>
            )}
            {/* 组名的候选只写一份：原来每张卡各带一个同 id 的 datalist，那是重复 id */}
            <datalist id="fav-groups">
              {favGroups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            {favGroup && (
              <GroupTools
                key={favGroup}
                group={favGroup}
                onRename={(to) => doRenameGroup(favGroup, to)}
                onDelete={() => doDeleteGroup(favGroup)}
              />
            )}
            {favAvoidHits > 0 && (
              <p className="text-meta leading-6 text-ink-3 no-print" role="status">
                禁用字「{opts.avoidChars}」只筛生成页；收藏里含这些字的 {favAvoidHits}{' '}
                条照旧留在下面，要清掉就逐条取消收藏。
              </p>
            )}
            {compare.length >= 2 && <Compare pairs={favPairs.filter((p) => compare.includes(p.rec.id))} />}
            {favView.length === 0 ? (
              <p className="rounded-card border border-dashed border-line-strong bg-surface-2 p-6 text-center text-meta text-ink-3">
                {favPairs.length === 0 ? '还没有条目。' : '没有符合搜索／来源／性别档／分组的条目。'}
              </p>
            ) : (
              favView.map(({ rec, r, stale }) => (
                <div key={rec.id} className="space-y-2">
                  {stale && (
                    <p className="text-meta leading-6 text-warn no-print">
                      这条收藏记的编号在当前候选池里找不到了，下面这张卡是按名字与出处对上的；分数可能与当初收藏时不同。
                    </p>
                  )}
                  <p className="text-meta text-ink-3 no-print">
                    来自{FAV_SOURCE_LABEL[rec.from ?? 'none']} · {FAV_GENDER_LABEL[r.gender.side]}档
                  </p>
                  <NameCard
                    r={r}
                    fav
                    blocked={blockIds.has(rec.id)}
                    onFav={() => toggleFav(r)}
                    onBlock={() => toggleBlock(r)}
                    onShare={() => void doShare(r)}
                    onCopy={() => void doCopy(r)}
                  />
                  <FavCardTools
                    rec={rec}
                    full={r.full}
                    compareOn={compare.includes(rec.id)}
                    narrow={narrow}
                    onPatch={(p) => setFav(store.updateFavorite(rec.id, p))}
                    onToggleCompare={() => toggleCompare(rec.id)}
                  />
                </div>
              ))
            )}
            {favLost.length > 0 && (
              <div className="space-y-2">
                <p className="text-meta leading-6 text-ink-3 no-print">
                  下面 {favLost.length}{' '}
                  条收藏在当前候选池里已经对不上任何条目（旧版本收录过、或数据换过）。这里只留当时记下的名字与出处，不能重新打分。
                </p>
                {favLost.map((rec) => (
                  <div
                    key={rec.id}
                    className="rounded-card border border-dashed border-line-strong bg-surface-2 p-3 space-y-1.5"
                  >
                    <p className="text-body text-ink-2">
                      {rec.name ? `${sur}${rec.name}` : '一条旧收藏'}
                      {rec.book ? ` · 《${BOOK_LABEL[rec.book]}·${rec.title}》` : ''}
                      {rec.group ? ` · 分组「${rec.group}」` : ''}
                    </p>
                    {rec.line && <p className="text-meta leading-6 text-ink-3">{rec.line}</p>}
                    {rec.note && <p className="text-meta leading-6 text-ink-3">备注：{rec.note}</p>}
                    <div className="no-print">
                      <button
                        onClick={() => {
                          setFav(store.removeFavorite(rec.id));
                        }}
                        className="btn btn-quiet"
                      >
                        删除这条
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'block' && (
          <div className="max-w-4xl space-y-3">
            <p className="text-meta leading-6 text-ink-3">拉黑后的名字不再出现在生成结果里，点卡片按钮可解除。</p>
            {blockList.length === 0 ? (
              <p className="rounded-card border border-dashed border-line-strong bg-surface-2 p-6 text-center text-meta text-ink-3">
                还没有条目。
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {blockList.map((r) => (
                  <NameCard
                    key={r.id}
                    r={r}
                    fav={favIds.has(r.id)}
                    blocked
                    onFav={() => toggleFav(r)}
                    onBlock={() => toggleBlock(r)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <footer className="max-w-4xl space-y-1.5 border-t border-line pt-4 text-meta leading-6 text-ink-3 no-print">
          <p className="measure">
            候选池 {num(META.pool_B)} 条（名用字表 {num(META.L0_size)} 字
            {META.L0_added > 0
              ? `＝种子表 ${num(META.L0_seed)} 字＋人工过字保留 ${num(META.L0_added)} 字`
              : '（种子版）'}
            ；取词段：同句读相邻 {num(META.by_gap.gap1)} 对 · 跨一字 {num(META.by_gap.gap2)} 对 · 跨两字{' '}
            {num(META.by_gap.gap3)} 对）· 单字名有对齐出处 {num(META.singles)} 字 · 另有真实人名 {num(META.real_tier)}{' '}
            个（非典籍出处） · 数据 "{Math.round(META.ship_bytes_total / 1024)}{' '}
            KiB（未压缩，全部打进应用包），运行时零网络请求。
            {sur && surnameReads(sur) > 1 && ' 你的姓首字是多音字，请在上方确认读音。'}
          </p>
          <p className="measure">本应用只给可核对的出处与用字事实，不做五行、八字、五格、吉凶判断。</p>
          <p className="measure">
            应用版本 {APP_VERSION} · 语料指纹 {META.corpus_sha}（语料清单变化即变）。
          </p>
          <details>
            <summary className="flex min-h-11 cursor-pointer select-none items-center text-ink-2 hover:text-ink lg:min-h-8">
              标注口径与数据来源（点开看）
            </summary>
            <p className="measure mt-1.5">
              卡片上的「部首」只是康熙字典五部（木{num(META.radical_dist.木)}·火{num(META.radical_dist.火)}·水
              {num(META.radical_dist.水)}·金{num(META.radical_dist.金)}·土{num(META.radical_dist.土)} 共{' '}
              {num(META.radical_chars)} 字）的事实标注，覆盖 {num(META.radical_named)}/{num(META.pool_B)}{' '}
              条双名；字义（本义）来自开放词典，用字常见度来自 114
              万真实姓名用字频次（估算）。没标部首不代表这个字在康熙字典里不属于这五部之外，也不代表它没有五行；本应用不做五行筛选、不做八字五格、不判吉凶。
            </p>
            <p className="measure mt-1.5">
              语料 chinese-poetry（MIT）＋ 乐府诗集（公共领域，维基文库整理本）＋ 道法 22 行手工录入 · 字表
              general_standard_chinese（Apache-2.0）· 名用字种子 cnname（MIT）· 词频 jieba（MIT）· 字义/笔画/结构
              chinese-dictionary（MIT）· 用字频次 Chinese-Names-Corpus（Apache-2.0）· 部首 Unicode Unihan ·
              拼音仅构建期使用 pinyin-pro（MIT）。
            </p>
          </details>
        </footer>
      </main>
    </div>
  );
}

// 首访引导语：手机上排在筛选之前（这才落在首屏里），宽屏仍排在结果之上
function FirstVisitNote() {
  return (
    <p className="measure mx-auto rounded-card border border-dashed border-line-strong bg-surface-2 p-3 text-meta leading-6 text-ink-3 sm:p-6 sm:text-center">
      先填姓氏。名字的起点落在典籍原句的音步边界上，第二个字取同句读内隔 0–2 字的位置，两字都须在名用字表内。
    </p>
  );
}

// 卡底那一行原来同时摆着「对比」「分组」「备注」三样，备注输入被挤到 90px 宽。
// 现在只留整行的备注 ＋ 一个「分组／对比」入口：分组输入与对比勾选都收在入口后面，
// 一条功能不少——分组、按组筛、整组改名／解散、对比最多三条都在。
function FavCardTools({
  rec,
  full,
  compareOn,
  narrow,
  onPatch,
  onToggleCompare,
}: {
  rec: store.FavRecord;
  full: string;
  compareOn: boolean;
  narrow: boolean;
  onPatch: (p: { note?: string; group?: string }) => void;
  onToggleCompare: () => void;
}) {
  // 宽屏默认展开、手机默认收起；用户手动开合过就以他的为准（不写 effect：同步 setState 会引发级联渲染）
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? !narrow;
  const panel = `fav-tools-${rec.id}`;
  return (
    <div className="space-y-2 px-1 no-print">
      <label className="block">
        <span className="sr-only">{full} 的备注</span>
        <input
          value={rec.note ?? ''}
          onChange={(e) => onPatch({ note: e.target.value })}
          placeholder="为什么喜欢它"
          className="field w-full"
        />
      </label>
      <button
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        aria-controls={panel}
        title="分组与对比都收在这里：给这条起个组名，或勾它进对比表（最多三条）"
        className="btn btn-quiet"
      >
        <svg
          className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4.5 2l5 4-5 4z" />
        </svg>
        分组／对比
      </button>
      {/* 当前组名写在这里而不是塞进按钮名里：按钮名带上组名会和分组筛选那一排的 chip 撞名 */}
      {rec.group && <span className="text-meta text-ink-3">当前分组：{rec.group}</span>}
      {open && (
        <div id={panel} className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="lab shrink-0">分组</span>
            <input
              list="fav-groups"
              value={rec.group ?? ''}
              onChange={(e) => onPatch({ group: e.target.value })}
              placeholder="如 女孩/备选"
              className="field w-full min-w-0 sm:w-40"
            />
          </label>
          <label className="flex min-h-11 items-center gap-1.5">
            <input type="checkbox" checked={compareOn} onChange={onToggleCompare} className="size-6 accent-accent" />
            <span className="text-meta text-ink-3">对比</span>
          </label>
          <span className="text-meta text-ink-3">勾 2–3 条出对比表，最多 3 条</span>
        </div>
      )}
    </div>
  );
}

// 分组改名 / 删组：只在选中某个分组时出现
function GroupTools({
  group,
  onRename,
  onDelete,
}: {
  group: string;
  onRename: (to: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(group);
  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-2 no-print"
        onSubmit={(e) => {
          e.preventDefault();
          onRename(val.trim());
          setEditing(false);
        }}
      >
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          aria-label={`分组「${group}」的新名字`}
          maxLength={24}
          placeholder="新组名"
          className="field w-full min-w-0 sm:w-40"
          autoFocus
        />
        <button type="submit" className="btn btn-outlined">
          改名
        </button>
        <button
          type="button"
          onClick={() => {
            setVal(group);
            setEditing(false);
          }}
          className="btn btn-quiet"
        >
          取消
        </button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <button onClick={() => setEditing(true)} className="btn btn-quiet">
        改组名
      </button>
      <button onClick={onDelete} className="btn btn-quiet" title="解散这个分组；组里的收藏不删，回到未分组">
        解散组
      </button>
      <span className="text-meta text-ink-3">组名最长 24 字；解散组只删组名，不删收藏</span>
    </div>
  );
}

function Compare({ pairs }: { pairs: Pair[] }) {
  const rows: [string, (p: Pair) => string][] = [
    ['名字', (p) => p.r.full],
    ['读音', (p) => p.r.readings.join(' ')],
    ['分数', (p) => `${p.r.total}`],
    [
      '性别风格',
      (p) =>
        p.r.gender.side === 'n'
          ? '中性'
          : `${p.r.gender.strong ? '' : '疑似'}${p.r.gender.side === 'f' ? '偏女' : '偏男'}`,
    ],
    [
      '字义',
      (p) =>
        [...new Set([...p.r.name])]
          .map((ch) => (glossOf(ch) ? `${ch}·${glossOf(ch)}` : ''))
          .filter(Boolean)
          .join('；'),
    ],
    [
      '字形',
      (p) => {
        const s = shapeTags(p.r.name);
        return `${s.strokesTotal != null ? `共 ${s.strokesTotal} 画` : '笔画未收录全'} · ${s.chars.map((c) => `${c.ch}${c.sx ?? '结构未收录'}`).join(' ')}`;
      },
    ],
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
            <th scope="col" className="px-3 py-2 text-left text-meta text-ink-3">
              对比
            </th>
            {pairs.map((p) => (
              <th key={p.rec.id} scope="col" className="px-3 py-2 text-left font-serif text-title">
                {p.r.full}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-t border-line">
              <th scope="row" className="whitespace-nowrap px-3 py-2 text-left align-top text-meta text-ink-3">
                {label}
              </th>
              {pairs.map((p) => (
                <td key={p.rec.id} className="px-3 py-2 align-top text-ink-2">
                  {f(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
