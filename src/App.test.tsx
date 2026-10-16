import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from './App';
import { POOL } from './engine/data';

const ctxStub = () => ({
  fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '',
  fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
  beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  measureText: (t: string) => ({ width: [...t].length * 30 }),
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxStub() as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(new Blob(['x'], { type: 'image/png' })));
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('App 集成冒烟', () => {
  it('未填姓时给出引导，填姓后生成结果', () => {
    render(<App />);
    expect(screen.getByText(/先填姓氏/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('姓氏'), { target: { value: '苏' } });
    expect(screen.queryByText(/先填姓氏/)).not.toBeInTheDocument();
    // 至少渲染出一张名字卡片（卡片标题是 h3）
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
  });

  it('收藏后计数更新，切到收藏页可见并可写备注', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓氏'), { target: { value: '苏' } });
    const favBtn = screen.getAllByRole('button', { name: '收藏' })[0];
    fireEvent.click(favBtn);
    expect(screen.getByRole('button', { name: '已收藏' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /收藏 1/ }));
    const note = screen.getByPlaceholderText('为什么喜欢它') as HTMLInputElement;
    fireEvent.change(note, { target: { value: '喜欢它的意思' } });
    expect(note.value).toBe('喜欢它的意思');
  });

  it('导出触发一次下载并给出提示', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓氏'), { target: { value: '苏' } });
    fireEvent.click(screen.getAllByRole('button', { name: '收藏' })[0]);
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

  it('主题按 浅色→深色→跟随系统 循环，深色落到 documentElement 上', () => {
    render(<App />);
    const btn = () => screen.getByRole('button', { name: /主题/ });
    expect(btn()).toHaveTextContent('跟随系统');
    fireEvent.click(btn()); // → 浅色
    expect(btn()).toHaveTextContent('浅色');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(btn()); // → 深色
    expect(btn()).toHaveTextContent('深色');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(btn()); // → 跟随系统（无 matchMedia 偏好，浅色）
    expect(btn()).toHaveTextContent('跟随系统');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('拉黑后卡片移出生成页、进入拉黑页', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓氏'), { target: { value: '苏' } });
    const firstName = screen.getAllByRole('heading', { level: 3 })[0].textContent!;
    fireEvent.click(screen.getAllByRole('button', { name: '不再看它' })[0]);
    fireEvent.click(screen.getByRole('tab', { name: /拉黑 1/ }));
    expect(within(screen.getByRole('main')).getAllByRole('heading', { level: 3 }).some((h) => h.textContent === firstName)).toBe(true);
  });

  it('收藏页：搜索无命中时给出空态提示', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓氏'), { target: { value: '苏' } });
    fireEvent.click(screen.getAllByRole('button', { name: '收藏' })[0]);
    fireEvent.click(screen.getByRole('tab', { name: /收藏 1/ }));
    fireEvent.change(screen.getByLabelText('搜索收藏'), { target: { value: 'zzz不存在' } });
    expect(screen.getByText(/没有符合搜索/)).toBeInTheDocument();
  });

  it('导入时弹出合并/覆盖选择，选合并后提示并更新计数', async () => {
    const { container } = render(<App />);
    const st = {
      app: 'naming-app', version: 1, exportedAt: '', surname: '欧', reading: 0, opts: {},
      favorites: [{ id: POOL[0].id, ts: 1 }], blocklist: ['zzz'],
    };
    const file = new File([JSON.stringify(st)], 'x.json', { type: 'application/json' });
    (file as unknown as { text: () => Promise<string> }).text = () => Promise.resolve(JSON.stringify(st));
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog', { name: '导入方式' });
    expect(within(dialog).getByRole('button', { name: /覆盖/ })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /合并/ }));
    expect(await screen.findByText(/已导入（合并）/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /收藏 1/ })).toBeInTheDocument();
  });
});
