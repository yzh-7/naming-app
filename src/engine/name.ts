import { CHARS, GENDER_FEMALE, GENDER_MALE, GLOSS, HOMO_FULL, HOMO_INIT, LINE_GLOSS, POOL, RADICAL, RISK_HIGH, SINGLES } from './data';
import type { Book, Delta, GenderSide, GenderTag, Named, Opts, Result, SortKey } from './types';
import { BOOK_ORDER } from './types';

const BILABIAL = new Set(['b', 'p', 'm']);

// 实时裁剪输入框的值会打断拼音输入法（yuan 还没上屏就被截成 yu），归一化只在引擎侧做
export const cleanSurname = (s: string) => s.replace(/[^一-鿿]/g, '').slice(0, 2);

export function readings(ch: string) {
  const info = CHARS[ch];
  if (!info) return [];
  return info.py.map((syl, i) => ({ syl, mark: info.pm[i] ?? syl, tone: info.t[i] ?? 0 }));
}

// 姓可指定读音序号（多音姓如 曾/单/解，默认读音常是错的）；名的风险判定遍历所有读音组合
function surnameReadings(surname: string, pick: number) {
  return [...surname].map((ch, i) => {
    const r = readings(ch);
    if (!r.length) return null;
    return i === 0 && r.length > pick ? r[pick] : r[0];
  });
}

// 读音选择器的可选条数按姓的首字算（引擎只把 pick 用在第 0 字上），复姓同样要能选
export const surnameReads = (surname: string) => readings([...surname][0] ?? '').length;

// phonetics 依赖每个姓字都查得到读音：查不到就整条音韵链静默空转（谐音、声调、生僻全不判，分数白涨）。
// 引擎不替界面兜这个错，但必须把「查不到」这件事露出来。
export const isKnownSurname = (surname: string) => [...surname].length > 0 && surnameReadings(surname, 0).every(Boolean);

const MAX_COMBOS = 4096;

function allCombos(charsArr: string[]) {
  let acc: { syl: string; tone: number }[][] = [[]];
  for (const ch of charsArr) {
    const rs = readings(ch);
    if (!rs.length) return [];
    const next: typeof acc = [];
    for (const p of acc) for (const r of rs) {
      if (next.length < MAX_COMBOS) next.push([...p, { syl: r.syl, tone: r.tone }]);
    }
    acc = next;
  }
  return acc;
}

function finalOf(syl: string) {
  // j/q/x/y 后的 u 实际是 ü（「 qu 」写 u 是拼写规则不是韵母差异），不归一就会漏判叠韵
  const m = syl.match(/^(ch|zh|sh|[bpmfdtnlgkhjqxrzcsyw])?(.*)$/);
  const ini = m?.[1] ?? '';
  const fin = m?.[2] ?? syl;
  return /^[jqxy]$/.test(ini) && fin.startsWith('u') ? `ü${fin.slice(1)}` : fin;
}

function staticDeltas(item: Named & { famous?: boolean; tier?: string }): Delta[] {
  const d: Delta[] = [];
  const gap = item.gap ?? 1;
  if (item.tier !== 'C') d.push({ rule: `${[...item.name].length === 1 ? '单字在' : '两字同在'}名用字表 L0`, delta: 20 });
  if (item.redup) d.push({ rule: '典籍叠字（依依 燕燕 昭昭）', delta: 3 });
  if (gap === 2) d.push({ rule: '跨一字取词（不成固定词）', delta: -4 });
  else if (gap >= 3) d.push({ rule: '跨两字取词（取自同句读相隔位置）', delta: -8 });
  if (item.famous) d.push({ rule: '原句为本书名句层', delta: 8 });
  if (item.book === 'chuci' || item.book === 'shijing') d.push({ rule: '出处为楚辞/诗经', delta: 3 });
  return d;
}

function phonetics(surname: string, name: string, surReading: number) {
  const deltas: Delta[] = [];
  const flags: string[] = [];
  const sur = surnameReadings(surname, surReading).filter(Boolean) as { syl: string; tone: number; mark: string }[];
  const nm = [...name].map((ch) => readings(ch)[0]).filter(Boolean) as { syl: string; tone: number; mark: string }[];
  if (sur.length !== [...surname].length || !nm.length) return { deltas, flags, readings: [], toneless: '', initials: '', total: 0 };

  const seq = [...sur, ...nm];
  const tones = seq.map((x) => x.tone);
  if (seq.length >= 3 && tones.every((t) => t === tones[0])) deltas.push({ rule: '三字同声调，读起来平', delta: -8 });
  else if (new Set(tones).size > 1) deltas.push({ rule: '声调有起伏', delta: 6 });

  const nameInitials = nm.map((x) => x.syl[0]);
  if (nm.length === 2 && name[0] !== name[1]) {
    if (nameInitials[0] === nameInitials[1]) deltas.push({ rule: '名字双声（声母相同）', delta: -4 });
    else if (finalOf(nm[0].syl) === finalOf(nm[1].syl)) deltas.push({ rule: '名字叠韵', delta: -4 });
    else deltas.push({ rule: '声母韵母错开，连读顺口', delta: 6 });
  }
  const adj = [...sur.map((x) => x.syl[0]), ...nameInitials];
  for (let i = 1; i < adj.length; i++) {
    if (BILABIAL.has(adj[i - 1]) && BILABIAL.has(adj[i])) {
      deltas.push({ rule: `双唇音相邻（${adj[i - 1]}·${adj[i]}）拗口`, delta: -6 });
      flags.push('拗口');
      break;
    }
  }

  const combos = allCombos([...surname, ...name]);
  const fullSet = new Set(combos.map((c) => c.map((x) => x.syl).join('')));
  const initSet = new Set(combos.map((c) => c.map((x) => x.syl[0]).join('')));
  const hitFull = HOMO_FULL.find((h) => fullSet.has(h.py));
  if (hitFull) {
    deltas.push({ rule: `连读谐音「${hitFull.w}」`, delta: -20 });
    flags.push(`谐音：${hitFull.w}`);
  } else {
    const hitInit = HOMO_INIT.find((h) => initSet.has(h.py));
    if (hitInit) {
      deltas.push({ rule: `简拼谐音「${hitInit.w}」`, delta: -12 });
      flags.push(`简拼似：${hitInit.w}`);
    }
  }

  if (name.length === 2 && RISK_HIGH.has(name)) deltas.push({ rule: `与高频现代词同形：${name}`, delta: -40 });
  else if (name.length === 2 && RISK_HIGH.has(surname + name)) deltas.push({ rule: `连读与高频词同形：${surname}${name}`, delta: -40 });

  for (const ch of name) {
    const info = CHARS[ch];
    if (info && info.cf < 50) {
      deltas.push({ rule: `单字现代频度低（${ch}）`, delta: -10 });
      flags.push('较生僻');
      break;
    }
  }
  return { deltas, flags, readings: seq.map((x) => x.mark), toneless: seq.map((x) => x.syl).join(' '), initials: seq.map((x) => x.syl[0]).join(''), total: 0 };
}

// 部首提示：只标康熙字典里落在 木/火/水/金/土 五部的字，其余留白。
// 这是「该字的部首是什么」的可核对事实，不是「该字五行属什么」的命理判断，故不参与筛选与打分。
export const radicalTags = (name: string) =>
  [...new Set([...name])].map((ch) => ({ ch, el: RADICAL[ch] })).filter((x): x is { ch: string; el: NonNullable<typeof RADICAL[string]> } => !!x.el);

// 字义：名用字逐字短释义（本义优先），查不到返回 null。只用于展示，不参与打分
export const glossOf = (ch: string): string | null => GLOSS[ch] ?? null;

// 多音字：名字里有多个读音的字（如 乐 lè/yuè、华 huá/huà）。名字读法不止一种，提示看原句与姓氏连读
export const polyphoneTags = (name: string) =>
  [...new Set([...name])]
    .map((ch) => ({ ch, reads: CHARS[ch]?.pm ?? [] }))
    .filter((x) => x.reads.length > 1);

// 字形/结构：逐字给出笔画与八类结构，并对「整名同结构」这条可核对的单调性给一句提示。
// 这是字形事实（该字是左右/上下…），不是吉凶判断，不参与筛选与打分。
export function shapeTags(name: string) {
  const uniq = [...new Set([...name])];
  const chars = uniq.map((ch) => ({ ch, st: CHARS[ch]?.st, sx: CHARS[ch]?.sx }));
  const strokes = [...name].reduce((a, ch) => a + (CHARS[ch]?.st ?? 0), 0);
  const sxs = uniq.map((ch) => CHARS[ch]?.sx).filter(Boolean) as string[];
  // 叠字（依依）天然同结构，不算单调；只对两个以上不同字判
  const sameStructure = uniq.length > 1 && sxs.length === uniq.length && new Set(sxs).size === 1;
  const note = sameStructure ? `${sxs[0]}结构连用，字形偏单调` : null;
  return { chars, strokes, sameStructure, note };
}

// 小名/乳名：把名字里的字叠用（沐→沐沐），并给末字加「小」前缀（小沐）
export function nicknames(name: string) {
  const chars = [...new Set([...name])];
  const out = chars.map((c) => c + c);
  if (chars.length) out.push('小' + chars[chars.length - 1]);
  return [...new Set(out)];
}

// 用字流行度（估算）：依据 114 万真实姓名的用字频次（去姓后统计），分五档。
// 这是「这个字在真实名字里有多常用」的估算证据，不是户籍重名率
const POP_BANDS: { min: number; label: string }[] = [
  { min: 8000, label: '很常见' },
  { min: 2000, label: '常见' },
  { min: 500, label: '一般' },
  { min: 100, label: '少见' },
  { min: 0, label: '冷僻' },
];
export const popBand = (gn: number) => POP_BANDS.find((b) => gn >= b.min)!.label;
export const popScore = (name: string) => Math.max(0, ...[...name].map((ch) => CHARS[ch]?.gn ?? 0));
export function popularity(name: string) {
  const chars = [...new Set([...name])].map((ch) => { const gn = CHARS[ch]?.gn ?? 0; return { ch, gn, band: popBand(gn) }; });
  const lead = chars.reduce((a, c) => (c.gn > a.gn ? c : a), chars[0]);
  return { chars, band: lead ? lead.band : '冷僻', lead: lead ?? null };
}

// 逐字用字频次的最小值：筛「不含冷僻字」要用最小值；展示流行度用的是最大值（lead）
export const minGnOf = (name: string) => Math.min(...[...name].map((ch) => CHARS[ch]?.gn ?? 0));

// 字形/用字筛选：整名笔画上限、避开两字同结构、逐字用字频次下限。
// 全部是可核对的事实（笔画/结构/真实用字频次），不掺五行命理；缺数据的字不过度判罚（结构未知时不算单调）
function passesShape(name: string, opts: Opts) {
  if (opts.strokeMax > 0 && strokesOf(name) > opts.strokeMax) return false;
  if (opts.popFloor > 0 && minGnOf(name) < opts.popFloor) return false;
  if (opts.noMonotone && name.length > 1 && shapeTags(name).sameStructure) return false;
  return true;
}

// 检索：命中名字、名字拼音（无声调）、出处篇名/作者，方便按音找字或按篇找名
export const namePinyin = (name: string) => [...name].map((ch) => readings(ch)[0]?.syl ?? '').join('');
export const searchText = (it: Named) => `${it.name}|${namePinyin(it.name)}|${it.title}|${it.author}`.toLowerCase();

// 旧实现「一个字命中就定性」，于是 尧圣/雪松/清洁 全被判偏女（183 条里 113 条只靠一票）。
// 现在：两侧都命中或都不命中＝中性；单侧命中时，只有每个字都指向同侧才算强命中，其余字在两表之外的标「疑似」。
export function genderOf(name: string): GenderTag {
  const chars = [...new Set([...name])];
  const fem = chars.filter((c) => GENDER_FEMALE.has(c));
  const male = chars.filter((c) => GENDER_MALE.has(c));
  const none = chars.filter((c) => !GENDER_FEMALE.has(c) && !GENDER_MALE.has(c));
  const label: Record<Exclude<GenderSide, 'n'>, string> = { f: '偏女', m: '偏男' };
  if (fem.length && male.length) {
    return { side: 'n', strong: false, why: `两表都有字（女：${fem.join('')}／男：${male.join('')}），不定性` };
  }
  const side: GenderSide = fem.length ? 'f' : male.length ? 'm' : 'n';
  if (side === 'n') return { side: 'n', strong: false, why: '用字不在性别风格字表内' };
  const hit = side === 'f' ? fem : male;
  const strong = none.length === 0;
  const basis = `${label[side]}：${hit.join('')}（${side === 'f' ? '女' : '男'}表字）`;
  return { side, strong, why: strong ? basis : `${basis} · 其余 ${none.join('')} 无性别信号` };
}

const SINGLE_ITEMS: (Named & { famous?: boolean; tier?: string })[] = SINGLES.map((s) => ({ ...s, name: s.char, chars: [s.char] } as unknown as Named & { famous?: boolean; tier?: string }));
const ALL_ITEMS: (Named & { famous?: boolean; tier?: string })[] = [...POOL, ...SINGLE_ITEMS];

export function scoreItem(surname: string, it: Named & { famous?: boolean; tier?: string }, opts: Opts, surReading: number): Result {
  const st = staticDeltas(it);
  const ph = phonetics(surname, it.name, surReading);
  const gender = genderOf(it.name);
  const genderDelta: Delta[] = opts.gender !== 'any' && gender.side === opts.gender
    ? [{ rule: `${gender.strong ? '性别风格强匹配' : '性别风格疑似匹配'} · ${gender.why}`, delta: gender.strong ? 4 : 2 }]
    : [];
  const itemRisk = (it as unknown as { risk?: { word: string; freq: number } | null }).risk;
  const riskDelta: Delta[] = itemRisk && itemRisk.freq < 5000
    ? [{ rule: `与现代词同形：${itemRisk.word}（freq ${itemRisk.freq}）`, delta: -12 }]
    : [];
  if (itemRisk && itemRisk.freq < 5000) ph.flags.push(`同形：${itemRisk.word}`);
  const deltas = [...st, ...ph.deltas, ...genderDelta, ...riskDelta];
  return {
    ...it,
    full: surname + it.name,
    gender,
    readings: ph.readings,
    toneless: ph.toneless,
    initials: ph.initials,
    deltas,
    total: deltas.reduce((a, d) => a + d.delta, 0),
    flags: ph.flags,
  };
}

export const findItem = (id: string) => ALL_ITEMS.find((it) => it.id === id);

// 出处今译：构建期按原句首次出现顺序编号，运行时按下标取；查不到返回空串，由界面决定是否留白
export const lineGlossOf = (it: { lg: number }) => LINE_GLOSS[it.lg] ?? '';

// 名用字表（293 字）：自选页的「仅名用字表」筛选与随机自由组合都基于它
export const L0_CHARS = Object.keys(CHARS).filter((ch) => CHARS[ch].l0).sort();

// 逐字可核对事实：字义/笔画/结构/用字频次/读音/是否在名用字表。查不到的字 known=false，界面留白
export function charFacts(ch: string) {
  const info = CHARS[ch];
  return {
    ch,
    known: !!info,
    l0: !!info?.l0,
    gloss: GLOSS[ch] ?? null,
    st: info?.st ?? null,
    sx: info?.sx ?? null,
    gn: info?.gn ?? 0,
    band: popBand(info?.gn ?? 0),
    reads: info?.pm ?? [],
  };
}

// 自选组合：只做事实核对，不套 Pool-B 的分数（那套分数只对池内候选有校准意义）
export type Composed = {
  full: string;
  name: string;
  chars: string[];
  readings: string[];
  toneless: string;
  initials: string;
  flags: string[];
  known: boolean;
  allL0: boolean;
};
export function composeName(surname: string, name: string, surReading = 0): Composed {
  const chars = [...name];
  const ph = phonetics(surname, name, surReading);
  return {
    full: surname + name,
    name,
    chars,
    readings: ph.readings,
    toneless: ph.toneless,
    initials: ph.initials,
    flags: ph.flags,
    known: chars.every((c) => !!CHARS[c]) && [...surname].every((c) => !!CHARS[c]),
    allL0: chars.every((c) => !!CHARS[c]?.l0),
  };
}

// 精确查出处：双名查 Pool-B，单名查 singles；查到就是「六本典籍里确有此搭配」，查不到不拿别的句子凑
let comboIndex: Map<string, (typeof POOL)[number] | (typeof SINGLES)[number]> | null = null;
export function findCombo(name: string) {
  if (!comboIndex) {
    comboIndex = new Map();
    for (const p of POOL) if (!comboIndex.has(p.name)) comboIndex.set(p.name, p);
    for (const s of SINGLES) if (!comboIndex.has(s.char)) comboIndex.set(s.char, s);
  }
  return comboIndex.get(name) ?? null;
}

export type PairHint = {
  ch: string;
  name: string;
  book: Book;
  title: string;
  author: string;
  line: string;
  seg: string;
  foot: number;
  gap: number;
  lg: number;
  id: string;
  score: number;
};

// 顺藤摸瓜：与某字在 Pool-B 同一个双名里出现过的搭配字（同一搭配字只留分数最高的一条出处）
let pairIndex: Map<string, PairHint[]> | null = null;
export function pairCandidates(ch: string): PairHint[] {
  if (!pairIndex) {
    const m = new Map<string, Map<string, PairHint>>();
    for (const c of POOL) {
      const [a, b] = c.chars;
      if (a === b) continue;
      for (const [self, other] of [[a, b], [b, a]] as const) {
        const inner = m.get(self) ?? new Map<string, PairHint>();
        const prev = inner.get(other);
        if (!prev || c.score > prev.score) {
          inner.set(other, {
            ch: other, name: c.name, book: c.book, title: c.title, author: c.author,
            line: c.line, seg: c.seg, foot: c.foot, gap: c.gap, lg: c.lg, id: c.id, score: c.score,
          });
        }
        m.set(self, inner);
      }
    }
    pairIndex = new Map([...m].map(([k, v]) => [k, [...v.values()].sort((x, y) => y.score - x.score)]));
  }
  return pairIndex.get(ch) ?? [];
}

function bookUniverse(opts: Opts): (Named & { famous?: boolean; tier?: string })[] {
  const src = opts.length === 2 ? POOL.filter((p) => p.tier === 'B') : SINGLE_ITEMS;
  return src.filter((it) => opts.books[it.book] && (!opts.redupOnly || it.redup));
}

// 控件写「偏女」却只加 4 分是错的：那样偏男名照样进结果。改成真筛选。
// 中性名保留（它不构成反证）；反向名一律排除；同侧但只是「疑似」（靠一个字）默认也排除，勾「含疑似」才放进来。
export function genderPass(name: string, opts: Opts): boolean {
  if (opts.gender === 'any') return true;
  const g = genderOf(name);
  if (g.side === 'n') return true;
  if (g.side !== opts.gender) return false;
  return g.strong || opts.genderWeak;
}

function universe(opts: Opts): (Named & { famous?: boolean; tier?: string })[] {
  const q = (opts.search ?? '').trim().toLowerCase();
  return bookUniverse(opts)
    .filter((it) => genderPass(it.name, opts))
    .filter((it) => passesShape(it.name, opts))
    .filter((it) => !q || searchText(it).includes(q));
}

export function genderStats(opts: Opts) {
  const kept = universe(opts);
  return {
    kept: kept.length,
    same: opts.gender === 'any' ? 0 : kept.filter((it) => genderOf(it.name).side === opts.gender).length,
  };
}

const PER_BOOK_CAP = 4;

// 换一批＝往后翻一页。发牌按分数序，同书每页最多 4 条，本页放不下的顺延到下页，
// 所以池内每条名字都出现在且只出现在一页——翻满 pages 页不重不漏。
// 旧做法是「取分数前 band 条再批内随机」：同书上限会把窗口外的名字永久挤掉，
// 实测每批 12 条连换 60 批只出现过 174/463，换 200 批仍漏 6 条。
function paginate(ranked: Result[], count: number): Result[][] {
  const pages: Result[][] = [];
  let rest = ranked;
  while (rest.length) {
    const per = new Map<string, number>();
    const page: Result[] = [];
    const next: Result[] = [];
    for (const r of rest) {
      const n = per.get(r.book) ?? 0;
      if (page.length >= count || n >= PER_BOOK_CAP) next.push(r);
      else {
        per.set(r.book, n + 1);
        page.push(r);
      }
    }
    // 第一轮受同书上限牵制可能装不满（只剩一本书时每页最多 4 条），按分数序从顺延队头补足，补走的同时移出顺延队
    if (page.length < count) page.push(...next.splice(0, count - page.length));
    pages.push(page);
    rest = next;
  }
  return pages;
}

const byBookThenScore = (a: Result, b: Result) =>
  BOOK_ORDER.indexOf(a.book) - BOOK_ORDER.indexOf(b.book) || b.total - a.total;

const strokesOf = (name: string) => [...name].reduce((a, ch) => a + (CHARS[ch]?.st ?? 0), 0);
const idCmp = (a: Result, b: Result) => (a.id < b.id ? -1 : 1);
// 排序键都把「分数」当稳定次级键，保证同分/同笔画的条目顺序可复现
const SORTERS: Record<SortKey, (a: Result, b: Result) => number> = {
  score: (a, b) => (b.total - a.total) || idCmp(a, b),
  strokes: (a, b) => (strokesOf(a.name) - strokesOf(b.name)) || (b.total - a.total) || idCmp(a, b),
  popular: (a, b) => (popScore(b.name) - popScore(a.name)) || (b.total - a.total) || idCmp(a, b),
  book: (a, b) => (BOOK_ORDER.indexOf(a.book) - BOOK_ORDER.indexOf(b.book)) || (b.total - a.total) || idCmp(a, b),
};

export type Plan = { page: Result[]; pageNo: number; pages: number; pool: number };

export function plan(surname: string, opts: Opts, batch: number, surReading = 0): Plan {
  const excluded = new Set(opts.exclude);
  const items = universe(opts).filter((it) => !excluded.has(it.id));
  const scored = items.map((it) => scoreItem(surname, it, opts, surReading));
  const byScore = [...scored].sort(SORTERS[opts.sort ?? 'score'] ?? SORTERS.score);
  const perPage = opts.count > 0 ? opts.count : byScore.length || 1;
  const pages = paginate(byScore, perPage);
  if (!pages.length) return { page: [], pageNo: 0, pages: 0, pool: 0 };
  const pageNo = ((batch % pages.length) + pages.length) % pages.length;
  const raw = pages[pageNo];
  // 默认（按分数/按出处）按书分组展示，一屏内不至于被单一本书占满；选了笔画/常见度就尊重所选顺序
  const page = opts.sort === 'strokes' || opts.sort === 'popular' ? raw : [...raw].sort(byBookThenScore);
  return { page, pageNo, pages: pages.length, pool: byScore.length };
}

export const poolSize = (opts: Opts) => universe(opts).filter((it) => !opts.exclude.includes(it.id)).length;
