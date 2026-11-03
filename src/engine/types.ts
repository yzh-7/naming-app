// 七本典籍是真出处；`real` 不是典籍，是「来源」维度上的另一档（真实姓名语料里真有人用过的名字），
// 它进 `Book` 只为了让出处标签、CSV、排序这些按 book 走的地方不用各写一套分支。
export type CorpusBook = 'shijing' | 'chuci' | 'lunyu' | 'shuimo' | 'song300' | 'daofa' | 'yuefu';
export type Book = CorpusBook | 'real';

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
  a?: number; // 成词证据：这两个字在七部典籍正文里作为相邻两字出现的次数（构建期算好，缺＝0）
  w?: number; // 成词证据：jieba 现代汉语词表里该双字的词频（缺＝未收录）
  rn?: number; // 真实用名证据：120 万真实姓名语料里出现过多少次（构建期从 data/raw/cnname_given.json 取，缺＝没记录）
  rs?: 'm' | 'f' | 'n'; // 该语料对这个名字的性别标注（≥5 次且 80% 单侧才算有向，缺＝未知）
  spl?: string; // 跨字取词时被剪开的那个原词（只在 gap≥2 且那一处本来成词时才有）
};

export type SingleItem = Omit<PoolItem, 'name' | 'chars' | 'tier' | 'redup' | 'risk'> & {
  char: string;
  from: string;
};

export type Homophone = { py: string; w: string }[];

export type Gender = 'any' | 'f' | 'm' | 'n';
export type GenderSide = 'f' | 'm' | 'n';
// strong＝名字每个字都指向同一侧；weak＝只有一个字命中、其余字在两表之外（旧实现就是靠这种一票定性的）
export type GenderTag = {
  side: GenderSide;
  strong: boolean;
  why: string;
  // 两条证据打架时写在这里（性别风格字表说的与真实姓名语料标的不同）：不改变归属，只如实说明
  conflict?: string;
};

export type SortKey = 'score' | 'strokes' | 'popular' | 'book';

// 汉字判定：用 Unicode 的 Script=Han，不只 U+4E00–9FFF 那一段。
// 只写 [一-鿿] 的话，扩展 A 区（U+3400–4DBF）、兼容表意区（U+F900–FAFF）与扩展 B 以上的字
// 会被静默丢掉——用户打进输入框看不见、筛选也不生效，看着像「设了但没用」。
// 语料侧 1,525 条双名与 217 个单名的用字全在 U+4E00–9FFF 内，所以这一步只影响用户输入侧。
export const isHan = (c: string) => /\p{Script=Han}/u.test(c);

// 姓氏只保留汉字、最多两字。界面输入、本机存储、导入文件、分享链接四条路径共用这一条规则；
// 实时裁剪输入框的值会打断拼音输入法（yuan 还没上屏就被截成 yu），所以归一化只在这些边界上做。
export const cleanSurname = (s: string) => [...s].filter(isHan).slice(0, 2).join('');

// 禁用字（避讳字）：只保留汉字、去重、最多 8 个。与姓氏同一条思路——归一化只在边界上做
// （输入框、本机存储、导入文件、分享链接），实时裁剪会打断拼音输入法。
export const AVOID_MAX = 8;
export const cleanAvoid = (s: string) => {
  const out: string[] = [];
  for (const c of [...s]) {
    if (isHan(c) && !out.includes(c) && out.length < AVOID_MAX) out.push(c);
  }
  return out.join('');
};

export type Opts = {
  gender: Gender;
  // 只看成词：默认开。成词＝这两个字在语料里相邻出现过至少两次，或现代汉语词表收录，或是典籍叠字
  wordOnly: boolean;
  length: 1 | 2;
  books: Record<CorpusBook, boolean>;
  // 来源：默认两者都看。真实人名档不是典籍出处，卡片与导出都单独标注，筛来源不等于换标准
  source: Source;
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
  // 禁用字（避讳字）：名里出现其中任何一个字就被排除，只查名不查姓；''＝不限。上限 AVOID_MAX 个字
  avoidChars: string;
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
  a?: number; // 成词证据，见 PoolItem
  w?: number;
  rn?: number; // 真实用名证据：120 万真实姓名语料里这个名字出现过多少次（缺＝没记录）
  rs?: 'm' | 'f' | 'n'; // 上游对这个名字的性别标注（≥5 次且 80% 单侧才算有向；缺＝未知）
  spl?: string;
};

// 真实人名档的一条：不存出处（它没有典籍出处），条目形状在 src/engine/data.ts 里补全
export type RealItem = Named & { rn: number };

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
  real: '真实人名', // 不是典籍：见 Book 的注释
};

export const BOOK_LABEL_REAL = '真实人名';
// 典籍的展示顺序：`real` 不在这里，它是来源不是典籍；按典籍排序时它排在七本之后（见 bookOrdinal）
export const BOOK_ORDER: CorpusBook[] = ['shijing', 'chuci', 'lunyu', 'shuimo', 'song300', 'daofa', 'yuefu'];
// 文案里凡是要报「几本典籍」的都用它，加书时不再漏改
export const BOOK_COUNT = BOOK_ORDER.length;
export const bookOrdinal = (b: Book) => (b === 'real' ? BOOK_ORDER.length : BOOK_ORDER.indexOf(b));

/** 来源：典籍出处、真实姓名语料，或两者都看 */
export type Source = 'all' | 'book' | 'real';
export const SOURCE_ORDER: Source[] = ['all', 'book', 'real'];
export const SOURCE_LABEL: Record<Source, string> = { all: '全部来源', book: '只看典籍', real: '只看真实人名' };
