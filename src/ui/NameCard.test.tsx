import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NameCard from './NameCard';
import { scoreItem, findItem, glossOf, lineGlossOf } from '../engine/name';
import { POOL } from '../engine/data';
import { BOOK_LABEL, BOOK_ORDER, type Opts } from '../engine/types';

const opts: Opts = {
  gender: 'any', genderWeak: false, length: 2,
  books: Object.fromEntries(BOOK_ORDER.map((b) => [b, true])) as Opts['books'],
  redupOnly: false, exclude: [], count: 12, search: '', sort: 'score',
  strokeMax: 0, noMonotone: false, popFloor: 0, mustChar: '', mustPos: 'any',
};

// 挑一个两个字都有字义的名，稳定断言字义出现在卡片上
const item = POOL.find((p) => [...p.name].every((c) => glossOf(c)))!;
const r = scoreItem('苏', item, opts, 0);

describe('NameCard 组件', () => {
  it('渲染名字、读音、出处与字义', () => {
    render(<NameCard r={r} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    expect(screen.getByRole('heading')).toHaveTextContent(r.full);
    expect(screen.getByText(r.readings.join(' '))).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(BOOK_LABEL[r.book])).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(glossOf([...r.name][0])!)).length).toBeGreaterThan(0);
  });
  it('原句下方给出今译，且今译与出处同一句', () => {
    render(<NameCard r={r} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    expect(screen.getByText('今译')).toBeInTheDocument();
    expect(screen.getByText(lineGlossOf(r))).toBeInTheDocument();
    expect(lineGlossOf(r).length).toBeGreaterThan(0);
  });
  it('收藏/拉黑/分享/复制按钮回调到父级', () => {
    const onFav = vi.fn(); const onBlock = vi.fn(); const onShare = vi.fn(); const onCopy = vi.fn();
    render(<NameCard r={r} fav={false} blocked={false} onFav={onFav} onBlock={onBlock} onShare={onShare} onCopy={onCopy} />);
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));
    fireEvent.click(screen.getByRole('button', { name: '不再看它' }));
    fireEvent.click(screen.getByRole('button', { name: '分享卡' }));
    fireEvent.click(screen.getByRole('button', { name: '复制信息' }));
    expect(onFav).toHaveBeenCalledOnce();
    expect(onBlock).toHaveBeenCalledOnce();
    expect(onShare).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledOnce();
  });
  it('已收藏时按钮文案变化，且不伪装成未收藏', () => {
    render(<NameCard r={r} fav blocked onFav={() => {}} onBlock={() => {}} />);
    expect(screen.getByRole('button', { name: '取消收藏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消拉黑' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收藏' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '不再看它' })).not.toBeInTheDocument();
  });
  it('findItem 能按 id 取回同一节点（收藏持久化的前提）', () => {
    expect(findItem(r.id)?.name).toBe(item.name);
  });
});
