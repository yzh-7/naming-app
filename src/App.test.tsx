import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from './App';
import { POOL } from './engine/data';
import { BOOK_LABEL } from './engine/types';
import { lineGlossOf, namePinyin, shapeTags } from './engine/name';
import { at, one } from './testing';
import { FAV_KEY } from './store/local';

const ctxStub = () => ({
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  font: '',
  textAlign: '',
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  measureText: (t: string) => ({ width: [...t].length * 30 }),
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxStub() as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) =>
    cb(new Blob(['x'], { type: 'image/png' })),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  // defineProperty 钉在 navigator 上的 clipboard 不归 restoreAllMocks 管；
  // 不摘掉的话，后面那些「没有剪贴板所以走退路」的分支会被静默跳过。
  if (Object.prototype.hasOwnProperty.call(navigator, 'clipboard'))
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
});
afterEach(() => {
  window.location.hash = '';
});

describe('App 集成冒烟', () => {
  it('未填姓时给出引导，填姓后生成结果', () => {
    render(<App />);
    expect(screen.getByText(/先填姓氏/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    expect(screen.queryByText(/先填姓氏/)).not.toBeInTheDocument();
    // 至少渲染出一张名字卡片（卡片标题是 h3）
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
  });

  it('收藏后计数更新，切到收藏页可见并可写备注', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const favBtn = one(screen.getAllByRole('button', { name: '收藏' }), '「收藏」按钮列表');
    fireEvent.click(favBtn);
    expect(screen.getByRole('button', { name: '已收藏' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /收藏 1/ }));
    const note = screen.getByPlaceholderText('为什么喜欢它') as HTMLInputElement;
    fireEvent.change(note, { target: { value: '喜欢它的意思' } });
    expect(note.value).toBe('喜欢它的意思');
  });

  it('hash 路由：#/compose 进自选页，#fav 进收藏页，清空回生成页', () => {
    window.location.hash = '#/compose';
    render(<App />);
    expect(screen.getByLabelText('姓（可复姓）')).toBeInTheDocument();
    window.location.hash = '#fav';
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(screen.getByLabelText('搜索收藏')).toBeInTheDocument();
    window.location.hash = '';
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(screen.getByText(/先填姓氏/)).toBeInTheDocument();
  });

  it('对比表每一列自洽：名字、出处、今译说的是同一个候选条目', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const favs = screen.getAllByRole('button', { name: '收藏' });
    fireEvent.click(one(favs, '「收藏」按钮列表'));
    fireEvent.click(at(favs, 1, '「收藏」按钮列表'));
    fireEvent.click(screen.getByRole('link', { name: /收藏 2/ }));
    const boxes = screen.getAllByLabelText('对比') as HTMLInputElement[];
    // 后面逐列比对要有两行，两个「对比」框取不到就没法自洽
    fireEvent.click(one(boxes, '「对比」复选框列表'));
    fireEvent.click(at(boxes, 1, '「对比」复选框列表'));
    const cellsOf = (label: string) =>
      within(screen.getByRole('rowheader', { name: label }).closest('tr')!).getAllByRole('cell');
    const names = cellsOf('名字').map((c) => c.textContent!);
    const sources = cellsOf('出处').map((c) => c.textContent!);
    const glosses = cellsOf('今译').map((c) => c.textContent!);
    expect(names).toHaveLength(2);
    expect(new Set(names).size, '两列应该是不同的名字').toBe(2);
    names.forEach((full, i) => {
      // 姓固定一个字：去掉首字是候选名；再用同一列的出处把同名条目钉死，
      // 最后比的是「这一列的今译 ＝ 这个条目的今译」，而不是拿今译反查今译
      const it = POOL.find((p) => `苏${p.name}` === full && `《${BOOK_LABEL[p.book]}·${p.title}》` === sources[i]);
      expect(it, `${full}／${sources[i]} 在候选池里对不上条目`).toBeTruthy();
      expect(glosses[i], full).toBe(lineGlossOf(it!));
    });
  });

  it('导出触发一次下载并给出提示', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    fireEvent.click(one(screen.getAllByRole('button', { name: '收藏' }), '「收藏」按钮列表'));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(screen.getByText(/已导出：收藏 1/)).toBeInTheDocument();
  });

  it('复制链接把当前筛选写进 URL 并提示只含筛选', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));
    expect(await screen.findByText(/链接已复制/)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(location.origin));
  });

  it('昼夜三档：深色给 documentElement 打上 dark，浅色撤掉，默认跟随系统', () => {
    render(<App />);
    const group = () => within(screen.getByRole('group', { name: '昼夜主题' }));
    const pick = (label: string) => group().getByRole('button', { name: `${label}主题` });
    expect(pick('跟随系统')).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(pick('深色'));
    expect(pick('深色')).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(pick('浅色'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('naming.theme.v1')).toBe('light');
    fireEvent.click(pick('跟随系统'));
    expect(localStorage.getItem('naming.theme.v1')).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('拉黑后卡片移出生成页、进入拉黑页', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const firstName = one(screen.getAllByRole('heading', { level: 3 }), '生成页的候选卡片标题').textContent!;
    fireEvent.click(one(screen.getAllByRole('button', { name: '拉黑' }), '「拉黑」按钮列表'));
    fireEvent.click(screen.getByRole('link', { name: /拉黑 1/ }));
    expect(
      within(screen.getByRole('main'))
        .getAllByRole('heading', { level: 3 })
        .some((h) => h.textContent === firstName),
    ).toBe(true);
  });

  it('收藏页：搜索无命中时给出空态提示', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    fireEvent.click(one(screen.getAllByRole('button', { name: '收藏' }), '「收藏」按钮列表'));
    fireEvent.click(screen.getByRole('link', { name: /收藏 1/ }));
    fireEvent.change(screen.getByLabelText('搜索收藏'), { target: { value: 'zzz不存在' } });
    expect(screen.getByText(/没有符合搜索/)).toBeInTheDocument();
  });

  it('禁用字不筛收藏，但收藏页明说有几条含它', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const card = one(screen.getAllByRole('article'), '生成页的候选卡片列表');
    const full = within(card).getByRole('heading', { level: 3 }).textContent!;
    const ch = [...full].slice(1)[0]; // 名的第一个字：禁用字只查名不查姓
    fireEvent.click(within(card).getByRole('button', { name: '收藏' }));
    fireEvent.click(screen.getByRole('button', { name: '高级筛选' }));
    fireEvent.change(screen.getByLabelText('禁用字（名里出现这些字的候选不出现）'), { target: { value: ch } });
    // 换到收藏页：这条收藏照旧在，页上写明它含禁用字
    fireEvent.click(screen.getByRole('link', { name: /收藏 1/ }));
    expect(screen.getAllByRole('article'), '收藏不被禁用字筛掉，也不悄悄藏起来').toHaveLength(1);
    expect(
      screen.getByText(`禁用字「${ch}」只筛生成页；收藏里含这些字的 1 条照旧留在下面，要清掉就逐条取消收藏。`),
    ).toBeInTheDocument();
  });

  it('导入时弹出合并/覆盖选择，选合并后提示并更新计数', async () => {
    const { container } = render(<App />);
    const st = {
      app: 'naming-app',
      version: 1,
      exportedAt: '',
      surname: '欧',
      reading: 0,
      opts: {},
      favorites: [{ id: one(POOL, '候选池 POOL').id, ts: 1 }],
      blocklist: ['zzz'],
    };
    const file = new File([JSON.stringify(st)], 'x.json', { type: 'application/json' });
    (file as unknown as { text: () => Promise<string> }).text = () => Promise.resolve(JSON.stringify(st));
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog', { name: '导入方式' });
    expect(within(dialog).getByRole('button', { name: /覆盖/ })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /合并/ }));
    expect(await screen.findByText(/已导入（合并）/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /收藏 1/ })).toBeInTheDocument();
  });

  it('导入文件超过 8 MiB：直接拒绝并说明上限，不把文件读进内存', async () => {
    const { container } = render(<App />);
    const file = new File(['{}'], 'huge.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: 9 * 1024 * 1024 }); // 内容很小，只把 size 报成 9 MiB
    let readCalled = false;
    (file as unknown as { text: () => Promise<string> }).text = () => {
      readCalled = true;
      return Promise.resolve('{}');
    };
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/超过 8 MiB 的上限/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '导入方式' })).not.toBeInTheDocument();
    await Promise.resolve();
    expect(readCalled).toBe(false);
  });

  it('篇名筛选：空态告诉你怎么退出，「不限篇」回到全部', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('篇名（只看这一篇）'), { target: { value: '不存在的一篇' } });
    expect(screen.getByText(/这个条件下没有剩余候选/)).toBeInTheDocument();
    expect(screen.getByText(/当前只在看《不存在的一篇》，点「不限篇」回到全部/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '不限篇名' }));
    expect((screen.getByLabelText('篇名（只看这一篇）') as HTMLInputElement).value).toBe('');
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
  });

  it('卡片上的「同篇还有 N 条」把筛选收到这一篇', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const jump = one(screen.getAllByRole('button', { name: /^同篇还有 \d+ 条$/ }), '「同篇还有 N 条」按钮列表');
    // 按钮的 title 里写着本篇名，拿它对照输入框，不去猜卡片文本
    const want = jump.getAttribute('title')!.match(/《(.+?)》/)![1];
    fireEvent.click(jump);
    const title = (screen.getByLabelText('篇名（只看这一篇）') as HTMLInputElement).value;
    expect(title).toBe(want);
    expect(screen.getByRole('button', { name: '不限篇名' })).toBeInTheDocument();
    const cards = screen.getAllByRole('article');
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.textContent, '篇名筛选后不该留下别的篇').toContain(`·${want}》`);
  });

  it('卡片上的「按拼音看」把这张卡的拼音写进搜索框并清掉篇名', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    fireEvent.change(screen.getByLabelText('篇名（只看这一篇）'), { target: { value: '' } });
    const btn = one(screen.getAllByRole('button', { name: '按拼音看' }), '「按拼音看」按钮列表');
    const card = btn.closest('article')!;
    const full = within(card).getByRole('heading', { level: 3 }).textContent!;
    fireEvent.click(btn);
    const search = screen.getByLabelText('搜索名字、拼音或篇名') as HTMLInputElement;
    expect(search.value).toBe(namePinyin([...full].slice(1).join('')));
    expect((screen.getByLabelText('篇名（只看这一篇）') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/按拼音「.+」搜索同音写法/)).toBeInTheDocument();
  });

  it('收藏页导出 CSV：一次下载，提示里带条数与当前分组', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    fireEvent.click(one(screen.getAllByRole('button', { name: '收藏' }), '「收藏」按钮列表'));
    fireEvent.click(screen.getByRole('link', { name: /收藏 1/ }));
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(screen.getByText('已导出 CSV：1 条（全部）')).toBeInTheDocument();
  });

  it('分组可改名也可删除，删除时说清连带几条收藏', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const favs = screen.getAllByRole('button', { name: '收藏' });
    fireEvent.click(one(favs, '「收藏」按钮列表'));
    fireEvent.click(at(favs, 1, '「收藏」按钮列表'));
    fireEvent.click(screen.getByRole('link', { name: /收藏 2/ }));
    fireEvent.change(one(screen.getAllByLabelText('分组'), '「分组」控件列表'), { target: { value: '备选' } });
    expect(screen.getByRole('button', { name: '备选' })).toBeInTheDocument();
    // 组工具只在「当前看某一个分组」时出现：先点组名 chip
    fireEvent.click(screen.getByRole('button', { name: '备选' }));
    fireEvent.click(screen.getByRole('button', { name: '改组名' }));
    const input = screen.getByLabelText('分组「备选」的新名字') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '终选' } });
    fireEvent.click(screen.getByRole('button', { name: '改名' }));
    expect(screen.getByText('分组「备选」已改名为「终选」')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '终选' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '备选' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '解散组' }));
    expect(screen.getByText('分组「终选」已解散，1 条收藏回到未分组（收藏本身没删）')).toBeInTheDocument();
    // 解散组只撤组名：两条收藏都还在（当前页签是 <span aria-current>，不是 link），组名 chip 消失
    expect(screen.getByText('收藏 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '终选' })).not.toBeInTheDocument();
  });

  it('对不上条目的旧收藏单独列出，只留当时的名字与出处，可删除', () => {
    localStorage.setItem(
      'naming.favorites.v1',
      JSON.stringify([
        {
          id: 'zzz-gone',
          ts: 1,
          name: '无此名',
          book: 'shijing',
          title: '某篇',
          line: '某句',
          note: '旧版本里收的',
          group: '老组',
        },
      ]),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    fireEvent.click(screen.getByRole('link', { name: /收藏 1/ }));
    expect(screen.getByText(/下面 1 条收藏在当前候选池里已经对不上任何条目/)).toBeInTheDocument();
    expect(screen.getByText('苏无此名 · 《诗经·某篇》 · 分组「老组」')).toBeInTheDocument();
    expect(screen.getByText('某句')).toBeInTheDocument();
    expect(screen.getByText('备注：旧版本里收的')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除这条' }));
    expect(screen.getByText('还没有条目。')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('naming.favorites.v1') || '[]')).toEqual([]);
  });
  it('本机存储不可用（隐私模式或写满）时页面照常能用，但明说这一页不会保存', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<App />);
    expect(screen.getByText(/本机存储不可用/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
    expect(screen.getByText(/收藏、拉黑与筛选不会保存/)).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('App 的分组、排序、对比上限、导出与主题联动', () => {
  // 文件名里的日期：App 是在点击那一刻各取一次 UTC 日，用例若只在模块作用域取一次，
  // 跨 UTC 日界（北京时间早上八点左右）跑就会假红。这里认「今天或前一天」，
  // 并显式断言同一批文件的日期是同一个。
  const dateOf = (name: string) => /(\d{4}-\d{2}-\d{2})/.exec(name)?.[1] ?? '';
  const dated = (prefix: string, ext: string) =>
    expect.stringMatching(new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.${ext}$`)) as unknown as string;
  const recentStamps = () => [0, 1].map((i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const groupInputs = () => screen.getAllByPlaceholderText('如 女孩/备选').map((el) => el as HTMLInputElement);
  const compareCells = (label: string) =>
    within(screen.getByRole('rowheader', { name: label }).closest('tr')!).getAllByRole('cell');

  // 渲染 App、生成、收藏前 n 条，再切到收藏页
  function favPageWith(n: number) {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const favBtns = screen.getAllByRole('button', { name: '收藏' });
    for (let i = 0; i < n; i++) fireEvent.click(at(favBtns, i, '「收藏」按钮列表'));
    fireEvent.click(screen.getByRole('link', { name: new RegExp(`收藏 ${n}`) }));
  }

  it('收藏排序的笔画档与常见度档各用各的尺子：默认档不按笔画排，两档都真的重排', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    fireEvent.click(one(screen.getAllByRole('button', { name: '收藏' }), '「收藏」按钮列表'));
    fireEvent.click(screen.getByRole('button', { name: /^换一批/ }));
    const second = screen.getAllByRole('button', { name: '收藏' });
    fireEvent.click(at(second, 0, '「收藏」按钮列表'));
    fireEvent.click(at(second, 1, '「收藏」按钮列表'));
    fireEvent.click(screen.getByRole('link', { name: /收藏 3/ }));

    const select = screen.getByLabelText('收藏排序') as HTMLSelectElement;
    const order = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent!);
    const strokes = () => order().map((full) => shapeTags(full.slice(1)).strokes); // 卡片标题是全名；这一用例的姓固定一个字，所以 slice(1) 取的就是双名
    const recent = order();
    const recentStrokes = strokes();
    expect(
      [...recentStrokes].sort((a, b) => a - b),
      '默认这一档不按笔画排，笔画序列本身应当是乱序的，否则下面的比对没有意义',
    ).not.toEqual(recentStrokes);

    fireEvent.change(select, { target: { value: 'strokes' } });
    const byStroke = strokes();
    expect(
      [...byStroke].sort((a, b) => a - b),
      '「笔画少→多」这一档应按笔画递增',
    ).toEqual(byStroke);
    const strokeOrder = order();
    expect(strokeOrder, '换了档就得真的重排').not.toEqual(recent);

    fireEvent.change(select, { target: { value: 'popular' } });
    const popularOrder = order();
    expect(popularOrder, '「用字常见度」用的是另一把尺子').not.toEqual(recent);
    expect(popularOrder).not.toEqual(strokeOrder);
  });

  it('分数档真的按分数排：先收藏的那条低分的被挪到后面，同分的两条保持收藏时的先后', () => {
    // 这三条要满足：分数不全都相同、其中有两条同分、而且收藏时的先后本身不是按分数排好的。
    // 不满足的话「按分数递减」这条断言就咬不住东西（把 sort 换成什么都不做也能过），
    // 所以这三条前提都写成显式断言，语料一变就以「前提不成立」红，而不是悄悄放行。
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const batch = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent!);
    // 按卡片认领「收藏」按钮（按钮列表会因为已经收藏的那条换名而缩，按下标取会漂）
    const favOf = (full: string) =>
      within(screen.getByRole('heading', { level: 3, name: full }).closest('article')!).getByRole('button', {
        name: '收藏',
      });
    // 当前语料里这三条：batch[5] 分数低于另外两条，batch[3] 与 batch[4] 同分（下面全部显式断言）。
    // 收藏的先后顺序很要紧：默认档就是收藏记录的顺序（新的在前），低分的那条最后收藏、
    // 才会正好落在队首，被分数档挪到队尾。
    fireEvent.click(favOf(at(batch, 3, '这一屏的卡片标题列表')));
    fireEvent.click(favOf(at(batch, 4, '这一屏的卡片标题列表')));
    fireEvent.click(favOf(at(batch, 5, '这一屏的卡片标题列表')));
    fireEvent.click(screen.getByRole('link', { name: /收藏 3/ }));

    const order = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent!);
    // 分数从对比表里读，不在用例里另算一份（列的顺序就是勾对比的顺序，也就是卡片顺序）
    for (const box of screen.getAllByLabelText('对比') as HTMLInputElement[]) fireEvent.click(box);
    const names = compareCells('名字').map((c) => c.textContent!);
    const scores = compareCells('分数').map((c) => Number(c.textContent));
    expect(names, '对比表应当三条，与卡片一一对应').toHaveLength(3);
    expect(scores).toHaveLength(3);
    const scoreOf = new Map(names.map((n, i) => [n, scores[i]]));
    expect(new Set(scores).size, '这三条不能全都同分，否则「按分数排」没有可排的东西').toBeGreaterThan(1);
    const dup = scores.find((s, i) => scores.indexOf(s) !== i);
    expect(dup, '这三条里应当有两条同分，否则「同分不换位」没有可断言的对象').toBeDefined();

    const recent = order(); // 默认这一档不换顺序，就是收藏记录本身的先后（新的在前）
    const asCollected = recent.map((n) => scoreOf.get(n)!);
    expect(asCollected, '默认档的顺序本身不该已经按分数排好，否则下面的断言分不出「排过」与「没排」').not.toEqual(
      [...asCollected].sort((a, b) => b - a),
    );

    const select = screen.getByLabelText('收藏排序') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'score' } });
    const byScore = order();
    const got = byScore.map((n) => scoreOf.get(n)!);
    expect(got, '「分数高→低」这一档应按分数递减').toEqual([...got].sort((a, b) => b - a));
    expect(byScore, '换了档就得真的重排').not.toEqual(recent);
    const tied = recent.filter((n) => scoreOf.get(n) === dup);
    expect(
      byScore.filter((n) => tied.includes(n)),
      '同分的两条应保持收藏时的先后',
    ).toEqual(tied);
  });

  it('分组改名：组名改掉后当前视图跟着走，卡上的组名也换成新的', () => {
    favPageWith(2);
    fireEvent.change(at(groupInputs(), 0, '收藏卡的分组输入框列表'), { target: { value: '备选' } });
    fireEvent.click(screen.getByRole('button', { name: '备选' })); // 选中这个分组，组工具才出现
    fireEvent.click(screen.getByRole('button', { name: '改组名' }));
    const rename = screen.getByLabelText('分组「备选」的新名字') as HTMLInputElement;
    fireEvent.change(rename, { target: { value: '备选池' } });
    fireEvent.click(screen.getByRole('button', { name: '改名' }));
    expect(screen.getByText('分组「备选」已改名为「备选池」')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '备选' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '备选池' })).toHaveAttribute('aria-pressed', 'true');
    expect(groupInputs().map((i) => i.value)).toContain('备选池');
  });

  it('解散组只删组名不删收藏：条目回到未分组，条数写在反馈里', () => {
    favPageWith(2);
    fireEvent.change(at(groupInputs(), 0, '收藏卡的分组输入框列表'), { target: { value: '备选' } });
    fireEvent.click(screen.getByRole('button', { name: '备选' }));
    fireEvent.click(screen.getByRole('button', { name: '解散组' }));
    expect(screen.getByText('分组「备选」已解散，1 条收藏回到未分组（收藏本身没删）')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '备选' })).not.toBeInTheDocument();
    expect(groupInputs().map((i) => i.value)).toEqual(['', '']);
  });

  it('对比最多三条：第四条勾不上，对比表也只有三列', () => {
    favPageWith(4);
    const boxes = screen.getAllByLabelText('对比') as HTMLInputElement[];
    expect(boxes).toHaveLength(4);
    for (const box of boxes) fireEvent.click(box);
    expect(
      boxes.map((b) => b.checked),
      '第四勾不进去，前三条还在对比里',
    ).toEqual([true, true, true, false]);
    expect(compareCells('名字')).toHaveLength(3);
  });

  it('换页时回到顶部：粘性页头不会把这一页的第一张卡片压在下面', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const desc = Object.getOwnPropertyDescriptor(window, 'scrollY');
    try {
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
      render(<App />);
      expect(scrollTo).not.toHaveBeenCalled(); // 本来就在顶部，不该动
      Object.defineProperty(window, 'scrollY', { value: 420, configurable: true, writable: true });
      window.location.hash = '#fav';
      fireEvent(window, new HashChangeEvent('hashchange'));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
      window.location.hash = '#/compose';
      fireEvent(window, new HashChangeEvent('hashchange'));
      expect(scrollTo).toHaveBeenCalledTimes(1); // 已经在顶部了，再换页也不调
    } finally {
      // 中途断失败也要还原：否则本文件后面的用例带着一个被钉住的 scrollY 跑
      if (desc) Object.defineProperty(window, 'scrollY', desc);
    }
  });

  it('跟随系统主题时系统的深色偏好一变就套用，卸载时把监听摘掉', () => {
    const handlers = new Map<string, EventListener[]>();
    const mq = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (t: string, cb: EventListener) => {
        handlers.set(t, [...(handlers.get(t) ?? []), cb]);
      },
      removeEventListener: (t: string, cb: EventListener) => {
        handlers.set(
          t,
          (handlers.get(t) ?? []).filter((x) => x !== cb),
        );
      },
    };
    const prevMatchMedia = window.matchMedia;
    window.matchMedia = (() => mq) as unknown as typeof window.matchMedia;
    try {
      const { unmount } = render(<App />);
      expect(handlers.get('change') ?? [], '「跟随系统」应当挂上系统偏好变化的监听').toHaveLength(1);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      mq.matches = true;
      for (const cb of handlers.get('change') ?? []) cb(new Event('change'));
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      unmount();
      expect(handlers.get('change') ?? [], '卸载时应当摘掉监听').toHaveLength(0);
    } finally {
      mq.matches = false;
      document.documentElement.classList.remove('dark');
      window.matchMedia = prevMatchMedia;
    }
  });

  it('候选全量导出不止这一屏，收藏 CSV 按当前视图导出，文件名都带日期', async () => {
    const downloads: string[] = [];
    const bodies: Blob[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    // 把真正交给下载的那份 Blob 收下来：只断言条数与文件名的话，导出内容被截掉一半也查不出来
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn((blob: Blob) => {
      bodies.push(blob);
      return 'blob:mock';
    });
    const csvLines = async (i: number) => (await at(bodies, i, '导出时抓到的文件内容列表').text()).split('\r\n');

    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const shown = screen.getAllByRole('button', { name: '收藏' }).length;
    fireEvent.click(screen.getByRole('button', { name: '候选CSV' }));
    const notice = screen.getByText(/已导出候选 \d+ 条（当前筛选全量，不只这一屏）/).textContent!;
    const total = Number(notice.match(/已导出候选 (\d+) 条/)?.[1]);
    expect(total, '导出的条数应当大于这一屏画出来的卡片数').toBeGreaterThan(shown);
    const candidateLines = await csvLines(0);
    expect(candidateLines[0], 'CSV 第一行是表头（带 BOM）').toContain('全名');
    expect(candidateLines.length - 1, 'CSV 正文的行数应当等于提示里说的那个数，不能只报一个数').toBe(total);
    expect(downloads).toEqual([dated('候选-苏', 'csv')]);
    fireEvent.click(screen.getByRole('button', { name: '候选JSON' }));
    expect(downloads).toEqual([dated('候选-苏', 'csv'), dated('候选-苏', 'json')]);

    const favBtn = one(screen.getAllByRole('button', { name: '收藏' }), '「收藏」按钮列表');
    fireEvent.click(favBtn);
    fireEvent.click(screen.getByRole('link', { name: /收藏 1/ }));
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    expect(screen.getByText('已导出 CSV：1 条（全部）')).toBeInTheDocument();
    const favLines = await csvLines(2);
    expect(favLines.length - 1, '收藏 CSV 正文一行一条收藏').toBe(1);
    expect(favLines[0], '收藏的 CSV 比候选多「分组」「备注」两列').toContain('备注');
    expect(downloads).toEqual([dated('候选-苏', 'csv'), dated('候选-苏', 'json'), dated('收藏', 'csv')]);
    expect(new Set(downloads.map(dateOf)), '同一次测试里三个文件的日期应当是同一个').toHaveLength(1);
    expect(recentStamps(), '文件名里的日期是今天或前一天（UTC）').toContain(
      dateOf(one(downloads, '这一轮导出抓到的文件名列表')),
    );
  });
  it('导入弹窗里「取消」什么都不改，「覆盖」把原有收藏换掉', async () => {
    const { container } = render(<App />);
    const input = () => container.querySelector('input[type=file]') as HTMLInputElement;
    const imported = at(POOL, 5, '候选池 POOL');
    const st = {
      app: 'naming-app',
      version: 1,
      exportedAt: '',
      surname: '',
      reading: 0,
      opts: {},
      favorites: [{ id: imported.id, ts: 1 }],
      blocklist: [],
    };
    const feed = () => {
      const file = new File([JSON.stringify(st)], 'x.json', { type: 'application/json' });
      (file as unknown as { text: () => Promise<string> }).text = () => Promise.resolve(JSON.stringify(st));
      fireEvent.change(input(), { target: { files: [file] } });
    };

    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    fireEvent.click(one(screen.getAllByRole('button', { name: '收藏' }), '「收藏」按钮列表'));
    const mine = one(screen.getAllByRole('heading', { level: 3 }), '这一屏的卡片标题列表').textContent!.trim();
    // 下面两条的前提：这一屏的第一条与要导入的那条不是同一个名字，而且标题取得到真文本
    expect(mine, '标题取到空文本的话，「覆盖以后原来的那条不见了」这条断言就空过').not.toBe('');
    expect(mine, '用例前提：导入的那条与这一屏的第一条不该是同一个名字').not.toBe(imported.name);

    feed();
    const dialog = await screen.findByRole('dialog', { name: '导入方式' });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '导入方式' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')).toHaveLength(1);

    feed();
    const again = await screen.findByRole('dialog', { name: '导入方式' });
    fireEvent.click(within(again).getByRole('button', { name: '覆盖' }));
    expect(await screen.findByText(/已导入（覆盖）/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')).toEqual([expect.objectContaining({ id: imported.id })]);
    fireEvent.click(screen.getByRole('link', { name: /收藏 1/ }));
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(imported.name);
    expect(mine).not.toBe(imported.name);
    expect(screen.queryByText(mine)).not.toBeInTheDocument();
  });

  it('导入一个「什么都没有」的文件与导入一个读不出来的文件：两条失败文案各自说清原因，都不动已有收藏', async () => {
    // 先往库里放一条真收藏。原来这一条断言的是「库里是空的」，而用例开始时库里本来就空——
    // 那种断言怎么改都不会红；换成「已有的那条不许被动」，失败路径顺手清库或覆盖就会被咬住。
    const keep = at(POOL, 7, '候选池 POOL');
    localStorage.setItem(FAV_KEY, JSON.stringify([{ id: keep.id, ts: 1 }]));
    const idsStored = () => (JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as { id: string }[]).map((f) => f.id);
    const { container } = render(<App />);
    const input = () => container.querySelector('input[type=file]') as HTMLInputElement;
    expect(idsStored(), '用例前提：库里先放好了那一条收藏').toEqual([keep.id]);

    // 只有 favorites/blocklist 两个空数组、没有 surname/reading/opts 这三个键，才落到「没有可导入的东西」这一支
    const empty = { app: 'naming-app', version: 1, exportedAt: '', favorites: [], blocklist: [] };
    const fileEmpty = new File([JSON.stringify(empty)], 'empty.json', { type: 'application/json' });
    (fileEmpty as unknown as { text: () => Promise<string> }).text = () => Promise.resolve(JSON.stringify(empty));
    fireEvent.change(input(), { target: { files: [fileEmpty] } });
    expect(await screen.findByText(/没有可导入的东西/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '导入方式' })).not.toBeInTheDocument();
    expect(idsStored(), '这一支只该给文案，不该顺手清掉或覆盖已有收藏').toEqual([keep.id]);

    const fileBroken = new File(['{}'], 'broken.json', { type: 'application/json' });
    (fileBroken as unknown as { text: () => Promise<string> }).text = () => Promise.reject(new Error('blocked'));
    fireEvent.change(input(), { target: { files: [fileBroken] } });
    expect(await screen.findByText(/这个文件读不出来/)).toBeInTheDocument();
    expect(idsStored(), '文件读不出来时也不该动库').toEqual([keep.id]);
  });

  it('卡片上的「分享卡」与「复制信息」各自给出说得清的反馈', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    fireEvent.click(one(screen.getAllByRole('button', { name: '分享卡' }), '「分享卡」按钮列表'));
    const shareNotice = await screen.findByText(/分享卡片已生成/);
    // 这一条走的是「链接短、二维码画得出来」那一支，就断这一支的原话；
    // 另一支（链接过长）在下面那条里断，两条都不写「或」，否则任一支改坏都查不出来。
    expect(shareNotice.textContent).toBe('分享卡片已生成（含扫码二维码）');
    fireEvent.click(one(screen.getAllByRole('button', { name: '复制信息' }), '「复制信息」按钮列表'));
    expect(await screen.findByText('名字信息已复制')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('苏'));
  });

  it('链接长到画不出二维码时，提示改口说清「二维码没画出来」', async () => {
    // 只有传给分享卡的那份 URL 走桩（App 里页签与筛选读的是 window.location，不动它）
    vi.stubGlobal('location', {
      origin: 'https://example.com',
      pathname: `/${'x'.repeat(4000)}`,
      search: '',
      hash: '',
    });
    try {
      render(<App />);
      fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
      fireEvent.click(one(screen.getAllByRole('button', { name: '分享卡' }), '「分享卡」按钮列表'));
      const notice = await screen.findByText(/分享卡片已生成/);
      expect(notice.textContent).toBe('分享卡片已生成，但二维码没画出来（链接过长）');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('拉黑页上「已拉黑」就是解除入口，这一页上也能直接收藏', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const blockBtns = screen.getAllByRole('button', { name: '拉黑' });
    fireEvent.click(at(blockBtns, 0, '「拉黑」按钮列表'));
    fireEvent.click(at(blockBtns, 1, '「拉黑」按钮列表'));
    fireEvent.click(screen.getByRole('link', { name: /拉黑 2/ }));
    expect(screen.getAllByRole('button', { name: '已拉黑' })).toHaveLength(2);
    fireEvent.click(one(screen.getAllByRole('button', { name: '已拉黑' }), '「已拉黑」按钮列表'));
    expect(screen.getAllByRole('button', { name: '已拉黑' })).toHaveLength(1);
    fireEvent.click(one(screen.getAllByRole('button', { name: '收藏' }), '「收藏」按钮列表'));
    expect(screen.getByRole('link', { name: /收藏 1/ })).toBeInTheDocument();
  });
});
