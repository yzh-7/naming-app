// 导出下载、复制文本、分享卡片（Canvas 现画；二维码用零依赖的 uqr 在本地生成，无联网）
import { encode } from 'uqr';
import { glossOf, popularity, shapeTags } from '../engine/name';
import { BOOK_LABEL, type Result } from '../engine/types';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, mime = 'application/json') {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function resultSummary(r: Result) {
  const g = [...new Set([...r.name])].map((ch) => (glossOf(ch) ? `${ch}：${glossOf(ch)}` : null)).filter(Boolean).join('；');
  const pop = popularity(r.name);
  const sh = shapeTags(r.name);
  return [
    `${r.full}  ${r.readings.join(' ')}  ${r.total} 分`,
    g && `字义：${g}`,
    `出处：《${BOOK_LABEL[r.book]}·${r.title}${r.author ? `·${r.author}` : ''}》`,
    `原句：${r.line}`,
    sh.strokes > 0 && `字形：${sh.chars.map((c) => `${c.ch}${c.sx ?? ''}${c.st ? c.st + '画' : ''}`).join(' ')}（共 ${sh.strokes} 画）`,
    `用字常见度：${pop.band}（依据 114 万真实姓名用字频次估算）`,
    '—— 取名 · 典籍取词（完全离线）',
  ].filter(Boolean).join('\n');
}

const SERIF = '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", serif';
const SANS = '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

function paintParchment(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = '#f7f1e6';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1f3a5f';
  ctx.lineWidth = 3;
  ctx.strokeRect(48, 48, W - 96, H - 96);
  ctx.strokeStyle = 'rgba(31,58,95,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(64, 64, W - 128, H - 128);
}

// 把二维码画到以 (x0,y0) 为左上角、边长 qs 的方块里；文本过长导致 encode 抛错时静默跳过
function drawQr(ctx: CanvasRenderingContext2D, url: string, x0: number, y0: number, qs: number) {
  try {
    const { data, size } = encode(url, { ecc: 'M', border: 1 });
    const cell = qs / size;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0, y0, qs, qs);
    ctx.fillStyle = '#16233a';
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (data[row][col]) ctx.fillRect(x0 + col * cell, y0 + row * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    return true;
  } catch {
    return false;
  }
}

// 分享卡片：羊皮纸竖版，含名字、读音、出处、字义与合注；给了 url 就在底部附二维码（离线生成）
export function renderShareCard(r: Result, appName = '取名 · 典籍取词', url?: string): Promise<Blob> {
  const W = 1080;
  const H = url ? 1560 : 1440;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  paintParchment(ctx, W, H);
  const cx = W / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1f3a5f';
  ctx.font = `600 30px ${SANS}`;
  ctx.fillText(appName, cx, 150);

  // 主名
  const name = r.full;
  const nameSize = name.length >= 3 ? 190 : 230;
  ctx.fillStyle = '#16233a';
  ctx.font = `700 ${nameSize}px ${SERIF}`;
  ctx.fillText(name, cx, 460);

  ctx.font = `400 44px ${SANS}`;
  ctx.fillStyle = '#4a5a72';
  ctx.fillText(r.readings.join('  '), cx, 540);

  // 字义
  const gloss = [...new Set([...r.name])].map((ch) => (glossOf(ch) ? `${ch} · ${glossOf(ch)}` : null)).filter(Boolean).join('    ');
  if (gloss) {
    ctx.font = `400 30px ${SANS}`;
    ctx.fillStyle = '#5a6b83';
    ctx.fillText(gloss, cx, 616);
  }

  // 出处
  const src = `《${BOOK_LABEL[r.book]}·${r.title}${r.author ? `·${r.author}` : ''}》`;
  ctx.font = `500 34px ${SERIF}`;
  ctx.fillStyle = '#1f3a5f';
  ctx.fillText(src, cx, 716);

  // 原句（自动折行，最多 4 行）
  const lines = wrap(ctx, r.line, W - 260, 4);
  ctx.font = `400 36px ${SERIF}`;
  ctx.fillStyle = '#37465c';
  let y = 780;
  for (const ln of lines) { ctx.fillText(ln, cx, y); y += 56; }

  // 合注
  const sh = shapeTags(r.name);
  const pop = popularity(r.name);
  const note = [sh.strokes ? `共 ${sh.strokes} 画` : null, sh.chars.every((c) => c.sx) ? sh.chars.map((c) => c.sx).join('') : null, `用字常见度 ${pop.band}`].filter(Boolean).join(' · ');
  ctx.font = `400 28px ${SANS}`;
  ctx.fillStyle = '#7a8699';
  ctx.fillText(note, cx, H - 200);

  if (url) {
    const qs = 200;
    drawQr(ctx, url, cx - qs / 2, 1130, qs);
    ctx.font = `400 22px ${SANS}`;
    ctx.fillStyle = '#7a8699';
    ctx.fillText('扫码打开', cx, 1370);
  }

  ctx.font = `400 26px ${SANS}`;
  ctx.fillStyle = '#7a8699';
  ctx.fillText('典籍取词 · 起点落音步、出处可核对 · 完全离线', cx, H - 150);

  return new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
}

// 收藏名单图：竖版长图，一次导出多个名字（含读音/分数/出处/备注），方便整屏分享或打印
export function renderListCard(entries: { r: Result; note?: string }[], opt: { title?: string } = {}): Promise<Blob> {
  const W = 1080;
  const ROW = 168;
  const HEAD = 220;
  const list = entries.slice(0, 40);
  const H = HEAD + Math.max(list.length, 1) * ROW + 120;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  paintParchment(ctx, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1f3a5f';
  ctx.font = `700 46px ${SERIF}`;
  ctx.fillText(opt.title ?? '取名 · 备选名单', W / 2, 130);
  ctx.font = `400 26px ${SANS}`;
  ctx.fillStyle = '#7a8699';
  const more = entries.length > list.length ? `（共 ${entries.length} 条，图内前 ${list.length} 条）` : `共 ${list.length} 条`;
  ctx.fillText(`${more} · 典籍取词 · 完全离线`, W / 2, 172);

  let y = HEAD + 40;
  if (!list.length) {
    ctx.fillStyle = '#7a8699';
    ctx.font = `400 32px ${SANS}`;
    ctx.fillText('（还没有收藏）', W / 2, y);
  }
  list.forEach(({ r, note }, i) => {
    const top = y - 46;
    if (i > 0) {
      ctx.strokeStyle = 'rgba(31,58,95,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(96, top - 18);
      ctx.lineTo(W - 96, top - 18);
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#16233a';
    ctx.font = `700 60px ${SERIF}`;
    ctx.fillText(r.full, 110, y + 18);
    ctx.fillStyle = '#4a5a72';
    ctx.font = `400 30px ${SANS}`;
    ctx.fillText(`${r.readings.join(' ')}  ·  ${r.total} 分`, 110, y + 62);
    ctx.fillStyle = '#7a8699';
    ctx.font = `400 24px ${SANS}`;
    ctx.fillText(`《${BOOK_LABEL[r.book]}·${r.title}》  ${r.line}`, 110, y + 96);
    const gloss = [...new Set([...r.name])].map((ch) => (glossOf(ch) ? `${ch}·${glossOf(ch)}` : '')).filter(Boolean).join('；');
    if (gloss) { ctx.fillStyle = '#5a6b83'; ctx.font = `400 22px ${SANS}`; ctx.fillText(gloss, 110, y + 122); }
    if (note) { ctx.fillStyle = '#1f3a5f'; ctx.font = `400 24px ${SANS}`; ctx.fillText(`· ${note}`, W - 110 - ctx.measureText(note).width, y + 96); }
    y += ROW;
  });

  return new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      out.push(cur);
      cur = ch;
      if (out.length === maxLines) break;
    } else {
      cur += ch;
    }
  }
  if (out.length < maxLines && cur) out.push(cur);
  return out;
}
