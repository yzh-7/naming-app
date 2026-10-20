import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import Controls from './Controls';
import { BOOK_ORDER, type Opts } from '../engine/types';

const base: Opts = {
  gender: 'any', genderWeak: false, length: 2,
  books: Object.fromEntries(BOOK_ORDER.map((b) => [b, true])) as Opts['books'],
  redupOnly: false, exclude: [], count: 12, search: '', sort: 'score',
  strokeMax: 0, noMonotone: false, popFloor: 0,
};

function Harness({ initialSurname = '苏', pages = 1, onBatch = () => {} }: { initialSurname?: string; pages?: number; onBatch?: () => void }) {
  const [surname, setSurname] = useState(initialSurname);
  const [opts, setOpts] = useState<Opts>({ ...base });
  return (
    <Controls surname={surname} setSurname={setSurname} reading={0} setReading={() => {}}
      opts={opts} setOpts={setOpts} poolCount={1505} pageNo={0} pages={pages} onBatch={onBatch} />
  );
}

// 笔画/常见度/典籍/叠字都在「高级筛选」折叠面板里，用到就先展开
function openAdvanced() {
  fireEvent.click(screen.getByRole('button', { name: /高级筛选/ }));
}

describe('Controls：输入与条件渲染', () => {
  it('姓氏输入双向绑定，池内条数可见', () => {
    render(<Harness />);
    const input = screen.getByLabelText('姓氏') as HTMLInputElement;
    expect(input.value).toBe('苏');
    fireEvent.change(input, { target: { value: '欧阳' } });
    expect(input.value).toBe('欧阳');
    expect(screen.getByText(/池内 1505 条/)).toBeInTheDocument();
  });

  it('多音姓才显示读音选择，单音姓不显示', () => {
    // 展开高级筛选后常驻 4 个 combobox（每批条数、排序、整名笔画、用字常见度）；多音姓（曾 céng/zēng）再多一个读音下拉
    const { unmount } = render(<Harness initialSurname="曾" />);
    openAdvanced();
    expect(screen.getAllByRole('combobox')).toHaveLength(5);
    expect(screen.getByText('姓的读音（多音姓请选）')).toBeInTheDocument();
    unmount();
    // 单音姓（欧 ōu）不显示
    render(<Harness initialSurname="欧" />);
    openAdvanced();
    expect(screen.getAllByRole('combobox')).toHaveLength(4);
    expect(screen.queryByText('姓的读音（多音姓请选）')).not.toBeInTheDocument();
  });

  it('切到单名时藏起「只看典籍叠字」（否则开关不可见却清空池子）', () => {
    render(<Harness />);
    openAdvanced();
    expect(screen.getByRole('button', { name: '只看典籍叠字' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '单名' }));
    expect(screen.queryByRole('button', { name: '只看典籍叠字' })).not.toBeInTheDocument();
  });

  it('只在选了性别风格后才出现「含疑似」开关', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: /疑似/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '偏女' }));
    expect(screen.getByRole('button', { name: /含「疑似偏女」/ })).toBeInTheDocument();
  });

  it('典籍标签点击即切换选中态', () => {
    render(<Harness />);
    openAdvanced();
    const shijing = screen.getByRole('button', { name: '诗经' });
    expect(shijing.className).toContain('bg-amber-50');
    fireEvent.click(shijing);
    expect(shijing.className).not.toContain('bg-amber-50');
  });

  it('搜索输入出现清除按钮，点清除后清空', () => {
    render(<Harness />);
    const box = screen.getByLabelText('搜索名字、拼音或篇名') as HTMLInputElement;
    expect(screen.queryByRole('button', { name: '清除搜索' })).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: '云' } });
    expect(box.value).toBe('云');
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(box.value).toBe('');
  });

  it('排序下拉可切换', () => {
    render(<Harness />);
    const sel = screen.getByLabelText('结果排序') as HTMLSelectElement;
    expect(sel.value).toBe('score');
    fireEvent.change(sel, { target: { value: 'popular' } });
    expect(sel.value).toBe('popular');
  });

  it('换一批回调父级；多页时显示页码', () => {
    const onBatch = vi.fn();
    render(<Harness pages={2} onBatch={onBatch} />);
    fireEvent.click(screen.getByRole('button', { name: /换一批/ }));
    expect(onBatch).toHaveBeenCalledOnce();
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
  });

  it('字形筛选：笔画上限与常见度下限可切换', () => {
    render(<Harness />);
    openAdvanced();
    const stroke = screen.getByLabelText('整名笔画上限') as HTMLSelectElement;
    expect(stroke.value).toBe('0');
    fireEvent.change(stroke, { target: { value: '20' } });
    expect(stroke.value).toBe('20');
    const pop = screen.getByLabelText('用字常见度下限') as HTMLSelectElement;
    fireEvent.change(pop, { target: { value: '500' } });
    expect(pop.value).toBe('500');
  });

  it('「避开同结构」只在双名下出现，切换 aria-pressed', () => {
    render(<Harness />);
    openAdvanced();
    const btn = screen.getByRole('button', { name: '避开同结构' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '单名' }));
    expect(screen.queryByRole('button', { name: '避开同结构' })).not.toBeInTheDocument();
  });
});
