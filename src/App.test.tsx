import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from './App';
import { POOL } from './engine/data';
import { lineGlossOf } from './engine/name';

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
afterEach(() => { window.location.hash = ''; });

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
    const favBtn = screen.getAllByRole('button', { name: '收藏' })[0];
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

  it('对比表里带出处今译，两列都非空', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    const favs = screen.getAllByRole('button', { name: '收藏' });
    fireEvent.click(favs[0]);
    fireEvent.click(favs[1]);
    fireEvent.click(screen.getByRole('link', { name: /收藏 2/ }));
    const boxes = screen.getAllByLabelText('对比') as HTMLInputElement[];
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    const row = screen.getByRole('rowheader', { name: '今译' }).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells).toHaveLength(2);
    for (const c of cells) {
      expect(c.textContent?.length).toBeGreaterThan(0);
      expect(lineGlossOf(POOL.find((p) => lineGlossOf(p) === c.textContent)!)).toBe(c.textContent);
    }
  });

  it('导出触发一次下载并给出提示', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
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
    const firstName = screen.getAllByRole('heading', { level: 3 })[0].textContent!;
    fireEvent.click(screen.getAllByRole('button', { name: '不再看它' })[0]);
    fireEvent.click(screen.getByRole('link', { name: /拉黑 1/ }));
    expect(within(screen.getByRole('main')).getAllByRole('heading', { level: 3 }).some((h) => h.textContent === firstName)).toBe(true);
  });

  it('收藏页：搜索无命中时给出空态提示', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('姓（可复姓）'), { target: { value: '苏' } });
    fireEvent.click(screen.getAllByRole('button', { name: '收藏' })[0]);
    fireEvent.click(screen.getByRole('link', { name: /收藏 1/ }));
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
    expect(screen.getByRole('link', { name: /收藏 1/ })).toBeInTheDocument();
  });
});
