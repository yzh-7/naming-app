import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Compose from './Compose';
import { DEFAULT_OPTS } from '../store/local';
import { findCombo } from '../engine/name';

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
    expect(p.onFav.mock.calls[0][0].full).toBe('苏子归');
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
    fireEvent.click(chips[0]);
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
});
