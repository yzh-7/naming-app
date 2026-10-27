import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText, downloadBlob, downloadText, renderListCard, renderShareCard, resultSummary } from './share';
import { glossOf, lineGlossOf, scoreItem } from '../engine/name';
import { POOL } from '../engine/data';
import { BOOK_LABEL, BOOK_ORDER, type Opts } from '../engine/types';

const opts: Opts = {
  gender: 'any',
  genderWeak: false,
  length: 2,
  books: Object.fromEntries(BOOK_ORDER.map((b) => [b, true])) as Opts['books'],
  redupOnly: false,
  exclude: [],
  count: 12,
  search: '',
  title: '',
  sort: 'score',
  strokeMax: 0,
  noMonotone: false,
  popFloor: 0,
  mustChar: '',
  mustPos: 'any',
  avoidChars: '',
};
const item = POOL.find((p) => [...p.name].every((c) => glossOf(c)))!;
const r = scoreItem('苏', item, opts, 0);

beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('复制文本', () => {
  it('成功返回 true，被拒绝时返回 false（不抛异常）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    expect(await copyText('hello')).toBe(false);
  });
});

describe('下载', () => {
  it('downloadText 触发一次带文件名的下载，blob 类型带 charset', () => {
    downloadText('{}', 'out.json');
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('application/json;charset=utf-8');
  });
  it('downloadBlob 用传入的文件名', () => {
    downloadBlob(new Blob(['x'], { type: 'image/png' }), 'a.png');
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });
});

describe('结果摘要', () => {
  it('含全名、读音、分数、字义、出处、原句、常见度与落款', () => {
    const s = resultSummary(r);
    expect(s).toContain(r.full);
    expect(s).toContain(r.readings[0]);
    expect(s).toContain(`${r.total} 分`);
    expect(s).toContain(`《${BOOK_LABEL[r.book]}·${r.title}`);
    expect(s).toContain(r.line);
    expect(s).toContain('用字常见度');
    expect(s).toContain('完全离线');
    expect(s).toContain('字义：');
    expect(s).toContain(`今译：${lineGlossOf(r)}`);
  });
});

describe('分享卡', () => {
  it('用 Canvas 现画并 resolve 出 PNG Blob（无第三方库、不联网）', async () => {
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: '',
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (t: string) => ({ width: [...t].length * 30 }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) =>
      cb(new Blob(['x'], { type: 'image/png' })),
    );
    const { blob, qr } = await renderShareCard(r);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(qr).toBe(false);
    expect(ctx.fillText).toHaveBeenCalled();
    // 主名必被画到卡片上
    expect(ctx.fillText.mock.calls.some((c) => c[0] === r.full)).toBe(true);
    // 今译也要画上去（带「今译」前缀，折行后可能截断）
    expect(ctx.fillText.mock.calls.some((c) => String(c[0]).startsWith('今译'))).toBe(true);
  });

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
  function mockCanvas(ctx: ReturnType<typeof ctxStub>) {
    const getCtx = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) =>
      cb(new Blob(['x'], { type: 'image/png' })),
    );
    // getContext 被调用的那个 canvas 实例：toBlob 也挂在它上面，用实例反查高度
    return () => getCtx.mock.instances[0] as HTMLCanvasElement;
  }

  it('给了 url 时卡片加高并在底部画二维码（uqr 本地生成）', async () => {
    const ctx = ctxStub();
    const getCanvas = mockCanvas(ctx);
    const res = await renderShareCard(r, undefined, 'https://example.com/?s=苏');
    expect(res.qr).toBe(true);
    expect(getCanvas().height).toBe(1560);
    expect(ctx.fillText.mock.calls.some((c) => c[0] === '扫码打开')).toBe(true);
    // 二维码模块会被逐格 fillRect
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(50);
  });

  it('不给 url 时是较矮的竖版，不画二维码', async () => {
    const ctx = ctxStub();
    const getCanvas = mockCanvas(ctx);
    await renderShareCard(r);
    expect(getCanvas().height).toBe(1440);
    expect(ctx.fillText.mock.calls.some((c) => c[0] === '扫码打开')).toBe(false);
  });

  it('链接长到画不出二维码时返回 qr:false 并画出说明', async () => {
    const ctx = ctxStub();
    mockCanvas(ctx);
    const huge = 'https://example.com/?s=' + 'x'.repeat(4000);
    const { blob, qr } = await renderShareCard(r, undefined, huge);
    expect(blob).toBeInstanceOf(Blob);
    expect(qr).toBe(false);
    expect(ctx.fillText.mock.calls.some((c) => String(c[0]).includes('二维码没画出来'))).toBe(true);
    expect(ctx.fillText.mock.calls.some((c) => c[0] === '扫码打开')).toBe(false);
  });

  it('长原句/长今译时卡片自动加高，不会压到合注与二维码', async () => {
    const ctx = ctxStub();
    const getCanvas = mockCanvas(ctx);
    const longItem = POOL.find((p) => p.name === '思君')!;
    await renderShareCard(scoreItem('苏', longItem, opts, 0), undefined, 'https://example.com/?s=苏');
    expect(getCanvas().height).toBeGreaterThan(1560);
  });

  it('无出处组合：摘要写「未见此搭配」，分享卡不画原句/今译也不崩', async () => {
    const ctx = ctxStub();
    mockCanvas(ctx);
    const composed = { full: '苏龙凤', name: '龙凤', readings: ['sū', 'lóng', 'fèng'] };
    const s = resultSummary(composed);
    expect(s).toContain('苏龙凤');
    expect(s).toContain('未见此搭配');
    expect(s).not.toContain('出处：《');
    const { blob } = await renderShareCard(composed, undefined, 'https://example.com/');
    expect(blob).toBeInstanceOf(Blob);
    expect(ctx.fillText.mock.calls.some((c) => String(c[0]).includes('未见这个搭配'))).toBe(true);
    expect(ctx.fillText.mock.calls.some((c) => String(c[0]).startsWith('今译'))).toBe(false);
  });

  it('名单图：高度随条数增长，画出每个名字与备注', async () => {
    const ctx = ctxStub();
    const getCanvas = mockCanvas(ctx);
    await renderListCard([{ r, note: '喜欢' }, { r }], { title: '苏 · 备选名单' });
    expect(getCanvas().height).toBe(220 + 2 * 168 + 120);
    expect(ctx.fillText.mock.calls.filter((c) => c[0] === r.full).length).toBeGreaterThanOrEqual(2);
    expect(ctx.fillText.mock.calls.some((c) => c[0] === '苏 · 备选名单')).toBe(true);
    expect(ctx.fillText.mock.calls.some((c) => String(c[0]).includes('喜欢'))).toBe(true);
  });

  it('名单图带链接时在底部留二维码区并标注', async () => {
    const ctx = ctxStub();
    const getCanvas = mockCanvas(ctx);
    const res = await renderListCard([{ r }], { title: '苏 · 备选名单', url: 'https://example.com/?s=苏' });
    expect(res.qr).toBe(true);
    expect(getCanvas().height).toBe(220 + 1 * 168 + 120 + 300);
    expect(ctx.fillText.mock.calls.some((c) => String(c[0]).includes('扫码打开本站'))).toBe(true);
  });

  it('名单图最多画 40 条，超出时标题注明', async () => {
    const ctx = ctxStub();
    const getCanvas = mockCanvas(ctx);
    await renderListCard(Array.from({ length: 45 }, () => ({ r })));
    expect(getCanvas().height).toBe(220 + 40 * 168 + 120);
    expect(ctx.fillText.mock.calls.some((c) => String(c[0]).includes('图内前 40 条'))).toBe(true);
  });
});
