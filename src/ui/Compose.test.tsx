import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import Compose from './Compose';
import { DEFAULT_OPTS } from '../store/local';
import { composeName, findCombo } from '../engine/name';
import { at, one } from '../testing';

const baseProps = () => ({
  surname: '',
  setSurname: vi.fn(),
  reading: 0,
  setReading: vi.fn(),
  opts: { ...DEFAULT_OPTS, exclude: [] },
  fav: new Set<string>(),
  onFav: vi.fn(),
  onShare: vi.fn(),
  onCopy: vi.fn(),
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const pickChar = (slot: 1 | 2, ch: string) => {
  fireEvent.click(screen.getByLabelText(`选择第 ${slot} 字`));
  fireEvent.change(screen.getByLabelText(`第 ${slot} 字搜索`), { target: { value: ch } });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^使用「${ch}」`) }));
};

describe('自选页', () => {
  it('没填姓时给引导，填姓并选满两字后出结果', () => {
    const p = baseProps();
    const { rerender } = render(<Compose {...p} />);
    expect(screen.getByText(/先填姓氏/)).toBeInTheDocument();
    const withSur = { ...p, surname: '苏' };
    rerender(<Compose {...withSur} />);
    pickChar(1, '子');
    rerender(<Compose {...withSur} />);
    expect(screen.getByText(/还差一个字/)).toBeInTheDocument();
    pickChar(2, '归');
    expect(screen.getByRole('heading', { name: '苏子归' })).toBeInTheDocument();
    expect(screen.getByText(/今译/)).toBeInTheDocument();
  });

  it('有出处的组合可收藏，且只回调一次', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    pickChar(1, '子');
    pickChar(2, '归');
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));
    expect(p.onFav).toHaveBeenCalledOnce();
    // 只回调一次，那唯一一次调用必须存在
    expect(at(p.onFav.mock.calls, 0, 'onFav 的调用记录')[0].full).toBe('苏子归');
  });

  it('无出处的组合明说没有出处，且不给收藏入口', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    pickChar(1, '龙');
    pickChar(2, '凤');
    expect(screen.getByText(/没有「龙凤」这个搭配的出处/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收藏' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分享卡' })).toBeInTheDocument();
  });

  it('非名用字表的字仍可使用，但标注出来', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    pickChar(1, '龘');
    expect(screen.getByText(/不在名用字表/)).toBeInTheDocument();
  });

  it('单名切换只保留第 1 字', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    pickChar(1, '子');
    pickChar(2, '归');
    fireEvent.click(screen.getByRole('button', { name: '单名' }));
    expect(screen.queryByLabelText('选择第 2 字')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '苏子' })).toBeInTheDocument();
  });

  it('选了第 1 字后给出同句读搭配字，点一下填第 2 字', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    pickChar(1, '子');
    expect(screen.getByText(/搭配过的字/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/子归 · 《诗经/));
    expect(screen.getByRole('heading', { name: '苏子归' })).toBeInTheDocument();
  });

  it('随机一批都有出处，点选可填入', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '换一批随机' }));
    expect(screen.getByText(/都有典籍出处/)).toBeInTheDocument();
    const chips = screen
      .getAllByRole('button')
      .filter((b) => /· (诗经|楚辞|论语|唐诗|宋词|道法)/.test(b.textContent ?? ''));
    expect(chips.length).toBeGreaterThan(0);
    fireEvent.click(one(chips, '随机搭配字按钮列表'));
    expect(screen.getByRole('heading', { name: /苏./ })).toBeInTheDocument();
  });

  it('草稿写进 localStorage，重挂载后仍在', () => {
    const p = { ...baseProps(), surname: '苏' };
    const { unmount } = render(<Compose {...p} />);
    pickChar(1, '子');
    pickChar(2, '归');
    unmount();
    render(<Compose {...p} />);
    expect(screen.getByRole('heading', { name: '苏子归' })).toBeInTheDocument();
  });

  it('拉黑的条目不出现在随机与搭配字里', () => {
    localStorage.clear();
    const blocked = findCombo('子归');
    expect(blocked).not.toBeNull();
    const p2 = { ...baseProps(), surname: '苏', opts: { ...DEFAULT_OPTS, exclude: [blocked!.id] } };
    render(<Compose {...p2} />);
    pickChar(1, '子');
    const hints = screen.getAllByTitle(/· 《/);
    for (const h of hints) {
      expect(h.getAttribute('title')).not.toContain('子归');
    }
  });

  it('清除某个字位后回到「还差一个字」，不留下半条名字', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    pickChar(1, '子');
    pickChar(2, '归');
    expect(screen.getByRole('heading', { name: '苏子归' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('清除第 1 字'));
    expect(screen.queryByRole('heading', { name: '苏子归' })).not.toBeInTheDocument();
    expect(screen.getByText(/还差一个字/)).toBeInTheDocument();
    // 字位本身还在，可以直接重选
    expect(screen.getByLabelText('选择第 1 字')).toBeInTheDocument();
  });

  it('选字面板：Escape 收起并把焦点送回原来那个字位', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    fireEvent.click(screen.getByLabelText('选择第 1 字'));
    // 面板里的输入框是自动聚焦的
    expect(document.activeElement).toBe(screen.getByLabelText('第 1 字搜索'));
    fireEvent.keyDown(screen.getByLabelText('第 1 字搜索'), { key: 'Escape' });
    expect(screen.queryByLabelText('第 1 字搜索')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText('选择第 1 字'));
  });

  it('选字面板：「关闭」按钮与 Escape 等价', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    fireEvent.click(screen.getByLabelText('选择第 2 字'));
    expect(screen.getByLabelText('第 2 字搜索')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByLabelText('第 2 字搜索')).not.toBeInTheDocument();
  });

  it('姓输入框：改动时原样交回（不打断拼音输入法），失焦时按清洗规则交回', () => {
    const p = baseProps();
    const { rerender } = render(<Compose {...p} />);
    const input = screen.getByLabelText('姓（可复姓）');
    fireEvent.change(input, { target: { value: ' 苏 abc明' } });
    expect(p.setSurname).toHaveBeenLastCalledWith(' 苏 abc明');
    rerender(<Compose {...p} surname=" 苏 abc明" />);
    fireEvent.blur(screen.getByLabelText('姓（可复姓）'));
    expect(p.setSurname).toHaveBeenLastCalledWith('苏明');
  });

  it('姓里有查不到读音的字时明说算不出，不含糊过去', () => {
    const p = { ...baseProps(), surname: '龘' };
    render(<Compose {...p} />);
    pickChar(1, '子');
    pickChar(2, '归');
    expect(screen.getByText(/「龘」有字不在读音表/)).toBeInTheDocument();
  });

  it('多音姓给出读音选择器，选定后把序号交回上层', () => {
    const p = { ...baseProps(), surname: '单' };
    render(<Compose {...p} />);
    const select = screen.getByLabelText('姓的读音（多音姓请选）');
    expect(within(select).getAllByRole('option')).toHaveLength(3);
    fireEvent.change(select, { target: { value: '1' } });
    expect(p.setReading).toHaveBeenLastCalledWith(1);
  });

  it('随机自由组合一次给 8 个互不重复的名字（不看有无出处）', () => {
    // 随机钉成定数，不然「互不重复」这条只是碰运气：抽样序列按对给出（每一对是两个字），
    // 里面故意安排了一对重复——第 2 轮抽到与第 1 轮完全相同的两个字。
    // 于是必须靠 Compose.tsx 里的 used 去重才能凑满 8 个不同名字；去重一旦被删，
    // 这一批 8 个名字里就露出一对重复，下面的 Set 断言立刻变红。
    const pair = (k: number) => [0.01 + k * 0.05, 0.02 + k * 0.05];
    const draws = [pair(0), pair(0), ...Array.from({ length: 9 }, (_, i) => pair(i + 1))].flat();
    let drawn = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => draws[drawn++ % draws.length] ?? 0.5);
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    fireEvent.click(screen.getByLabelText('随机自由组合（不看有无出处）'));
    fireEvent.click(screen.getByRole('button', { name: '换一批随机' }));
    expect(screen.getByText(/随机 8 个（自由组合，可能有出处也可能没有）/)).toBeInTheDocument();
    const box = screen.getByText(/随机 8 个/).closest('section');
    expect(box).not.toBeNull();
    const chips = within(box as HTMLElement).getAllByRole('button');
    expect(chips).toHaveLength(8);
    const names = chips.map((c) => (c.textContent ?? '').split('·')[0] ?? '');
    expect(new Set(names).size).toBe(8);
    expect(names.every((n) => n.length > 0)).toBe(true);
  });

  it('搜索框里直接写满两个字：一次填满两格并收起面板', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    fireEvent.click(screen.getByLabelText('选择第 1 字'));
    fireEvent.change(screen.getByLabelText('第 1 字搜索'), { target: { value: '子归' } });
    fireEvent.click(screen.getByRole('button', { name: '直接使用「子归」' }));
    expect(screen.queryByLabelText('第 1 字搜索')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '苏子归' })).toBeInTheDocument();
  });

  it('拼音搜索列出候选字，点一下填进正在选的那个字位', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    fireEvent.click(screen.getByLabelText('选择第 2 字'));
    fireEvent.change(screen.getByLabelText('第 2 字搜索'), { target: { value: 'zi' } });
    const grid = screen.getByRole('group', { name: '候选字' });
    const chars = within(grid)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(chars).toContain('子');
    fireEvent.click(within(grid).getByRole('button', { name: '子' }));
    expect(screen.getByLabelText('选择第 2 字：子')).toBeInTheDocument();
  });

  it('搜不到字时说明为什么搜不到；「仅名用字表」开关换了，说法也跟着换', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    fireEvent.click(screen.getByLabelText('选择第 1 字'));
    fireEvent.change(screen.getByLabelText('第 1 字搜索'), { target: { value: '龘' } });
    expect(screen.getByText(/没有匹配的字：「龘」/)).toBeInTheDocument();
    expect(screen.getByText(/当前只列名用字表内的字/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '仅名用字表' }));
    expect(screen.getByText(/这个字表里没有这样的字/)).toBeInTheDocument();
  });

  it('无出处的组合也能分享与复制，交回的是自选页算出来的读音', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    pickChar(1, '龙');
    pickChar(2, '凤');
    // 期望值用的是与 Compose.tsx 分享/复制那一步同一条 composeName('苏','龙凤',0)：
    // 这一条钉的是「交回父级的是自选页算出来的那一份（含读音）」这个契约，
    // 读音数值本身对不对由 engine 的用例钉。
    const c = composeName('苏', '龙凤', 0);
    fireEvent.click(screen.getByRole('button', { name: '分享卡' }));
    fireEvent.click(screen.getByRole('button', { name: '复制信息' }));
    expect(p.onShare).toHaveBeenCalledWith({ full: c.full, name: c.name, readings: c.readings });
    expect(p.onCopy).toHaveBeenCalledWith({ full: c.full, name: c.name, readings: c.readings });
  });

  it('自选字正好是生成页的禁用字时说明清楚：这里照旧能组合，生成页不出现它', () => {
    const p = { ...baseProps(), surname: '苏', opts: { ...DEFAULT_OPTS, exclude: [], avoidChars: '子' } };
    render(<Compose {...p} />);
    pickChar(1, '子');
    pickChar(2, '归');
    expect(screen.getByText(/在生成页的禁用字里/)).toBeInTheDocument();
  });

  it('拗口、生僻与字形单调这类判定在自选结果里露出来', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    pickChar(1, '明');
    pickChar(2, '铄');
    expect(screen.getByText('较生僻')).toBeInTheDocument();
    expect(screen.getByText(/左右结构连用，字形偏单调/)).toBeInTheDocument();
  });

  it('单名且还没选字时给单名的提示，不写「还差一个字」', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '单名' }));
    expect(screen.getByText('还没选字。')).toBeInTheDocument();
  });

  it('两格都填满且含非名用字时，说明仍做读音与谐音核对', () => {
    const p = { ...baseProps(), surname: '苏' };
    render(<Compose {...p} />);
    pickChar(1, '龘');
    pickChar(2, '归');
    expect(screen.getByText(/有字不在名用字表：仍做读音与谐音核对/)).toBeInTheDocument();
  });

  it('已收藏的组合按钮写成「已收藏」，不伪装成还能收藏', () => {
    const combo = findCombo('子归');
    expect(combo).not.toBeNull();
    const p = { ...baseProps(), surname: '苏', fav: new Set<string>([combo!.id]) };
    render(<Compose {...p} />);
    pickChar(1, '子');
    pickChar(2, '归');
    const btn = screen.getByRole('button', { name: '已收藏' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '收藏' })).not.toBeInTheDocument();
  });
});
