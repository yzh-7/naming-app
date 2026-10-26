export type Book = 'shijing' | 'chuci' | 'lunyu' | 'shuimo' | 'song300' | 'daofa' | 'yuefu';

export type CharInfo = {
  py: string[];
  pm: string[];
  t: number[];
  lvl: number;
  cf: number;
  l0: boolean;
  st?: number; // 笔画数（通用规范汉字表 8105 字内的字）
  sx?: string; // 结构：独体/品字/上下/上中下/左右/左中右/全包围/半包围
  gn?: number; // 真实姓名里该字的出现次数（用字流行度的证据）
};

export type PoolItem = {
  id: string;
  name: string;
  chars: string[];
  tier: 'B' | 'C';
  book: Book;
  title: string;
  author: string;
  line: string;
  seg: string;
  foot: number;
  gap: number;
  strict: boolean;
  redup: boolean;
  famous: boolean;
  risk: { word: string; freq: number } | null;
  score: number;
  lg: number; // 出处今译在 LINE_GLOSS 里的下标
};

export type SingleItem = Omit<PoolItem, 'name' | 'chars' | 'tier' | 'redup' | 'risk'> & {
  char: string;
  from: string;
};

export type Homophone = { py: string; w: string }[];

export type Gender = 'any' | 'f' | 'm';
export type GenderSide = 'f' | 'm' | 'n';
// strong＝名字每个字都指向同一侧；weak＝只有一个字命中、其余字在两表之外（旧实现就是靠这种一票定性的）
export type GenderTag = { side: GenderSide; strong: boolean; why: string };

export type SortKey = 'score' | 'strokes' | 'popular' | 'book';

export type Opts = {
  gender: Gender;
  genderWeak: boolean;
  length: 1 | 2;
  books: Record<Book, boolean>;
  redupOnly: boolean;
  exclude: string[];
  count: number;
  search: string;
  // 篇名筛选：只保留这一篇里的候选；''＝不限。篇名从候选卡片上的「同篇候选」进入
  title: string;
  sort: SortKey;
  // 字形/用字筛选（可核对的事实，不掺命理）：整名笔画上限、是否避开两字同结构、逐字用字频次下限
  strokeMax: number; // 0 = 不限
  noMonotone: boolean; // 排除「两字同结构」的名字
  popFloor: number; // 0 = 不限；每字用字频次须 ≥ 此值（排除冷僻）
  // 指定用字：结果必须含这个字（双名可按位置限定）；''＝不限
  mustChar: string;
  mustPos: MustPos;
};

export type MustPos = 'any' | 'first' | 'last';
export const MUST_POS_LABEL: Record<MustPos, string> = { any: '不限位置', first: '用作首字', last: '用作末字' };

// 用字常见度门槛的可选档（与 popBand 的分档对齐）
export const POP_FLOORS: { v: number; label: string }[] = [
  { v: 0, label: '不限' },
  { v: 100, label: '排除冷僻' },
  { v: 500, label: '至少一般' },
  { v: 2000, label: '至少常见' },
];

export const STROKE_MAXES: { v: number; label: string }[] = [
  { v: 0, label: '不限' },
  { v: 16, label: '≤16 画' },
  { v: 20, label: '≤20 画' },
  { v: 24, label: '≤24 画' },
  { v: 28, label: '≤28 画' },
];

export type Delta = { rule: string; delta: number };

export type Named = {
  id: string;
  name: string;
  book: Book;
  title: string;
  author: string;
  line: string;
  seg: string;
  foot: number;
  gap: number;
  strict: boolean;
  redup: boolean;
  lg: number; // 出处今译在 LINE_GLOSS 里的下标
};

export type Result = Named & {
  full: string;
  gender: GenderTag;
  readings: string[];
  toneless: string;
  initials: string;
  total: number;
  deltas: Delta[];
  flags: string[];
};

// 分享/复制只需要这些字段：有出处的 Result 满足它，自选组合也可以直接构造（无 book/line/total）
export type ShareName = {
  full: string;
  name: string;
  readings: string[];
  total?: number;
  book?: Book;
  title?: string;
  author?: string;
  line?: string;
  lg?: number;
};

export const BOOK_LABEL: Record<Book, string> = {
  shijing: '诗经',
  chuci: '楚辞',
  lunyu: '论语',
  shuimo: '唐诗',
  song300: '宋词',
  daofa: '道法',
  yuefu: '乐府',
};

export const BOOK_ORDER: Book[] = ['shijing', 'chuci', 'lunyu', 'shuimo', 'song300', 'daofa', 'yuefu'];
// 文案里凡是要报「几本典籍」的都用它，加书时不再漏改
export const BOOK_COUNT = BOOK_ORDER.length;
