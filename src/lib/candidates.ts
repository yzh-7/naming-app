// 候选全量导出：纯函数，把当前筛选命中的全部候选（不只是当前一页）转成 JSON / CSV 文本，下载由调用方做。
import { BOOK_LABEL, type Result } from '../engine/types';
import { lineGlossOf, popularity, shapeTags } from '../engine/name';

export type CandidateRow = {
  full: string;
  name: string;
  readings: string;
  score: number;
  book: string;
  title: string;
  author: string;
  line: string;
  gloss: string;
  strokes: number;
  popularity: string;
  gender: string;
};

export function candidateRows(results: Result[]): CandidateRow[] {
  return results.map((r) => ({
    full: r.full,
    name: r.name,
    readings: r.readings.join(' '),
    score: r.total,
    book: BOOK_LABEL[r.book],
    title: r.title,
    author: r.author,
    line: r.line,
    gloss: lineGlossOf(r),
    strokes: shapeTags(r.name).strokes,
    popularity: popularity(r.name).band,
    gender:
      r.gender.side === 'n' ? '中性' : `${r.gender.strong ? '' : '疑似'}${r.gender.side === 'f' ? '偏女' : '偏男'}`,
  }));
}

export const candidatesJson = (results: Result[]) =>
  JSON.stringify(
    {
      app: 'naming-app',
      kind: 'candidates',
      exportedAt: new Date().toISOString(),
      count: results.length,
      rows: candidateRows(results),
    },
    null,
    2,
  );

export const CSV_HEADER = [
  '全名',
  '名字',
  '读音',
  '分数',
  '典籍',
  '篇名',
  '作者',
  '原句',
  '出处今译',
  '总笔画',
  '用字常见度',
  '性别风格',
];

// 单元格转义。除了 CSV 本身的引号/逗号规则，还要防 Excel/WPS 的公式执行：
// 以 = + - @ 打头的文本（备注、分组是手打的，可能这样打头）会被当成公式跑一遍。
// 前导单引号是 Excel 认的「这一格整段按文本算」标记，公式不执行，显示时也不会带出这个引号。
const esc = (v: string | number) => {
  const raw = String(v).replace(/[\r\n]+/g, ' ');
  const s = typeof v === 'string' && /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// BOM + CRLF：中文在 Excel/WPS 里不乱码的最小代价
export function candidatesCsv(results: Result[]): string {
  const rows = candidateRows(results).map((x) =>
    [x.full, x.name, x.readings, x.score, x.book, x.title, x.author, x.line, x.gloss, x.strokes, x.popularity, x.gender]
      .map(esc)
      .join(','),
  );
  return '\ufeff' + [CSV_HEADER.join(','), ...rows].join('\r\n');
}

// 收藏名单 CSV：候选的列全部保留，再加「分组」「备注」两列（这两列只在收藏里有意义）
export const FAV_CSV_HEADER = [...CSV_HEADER, '分组', '备注'];

export function favoritesCsv(entries: { r: Result; note?: string; group?: string }[]): string {
  const rows = entries.map((e) => {
    const x = candidateRows([e.r])[0];
    return [
      x.full,
      x.name,
      x.readings,
      x.score,
      x.book,
      x.title,
      x.author,
      x.line,
      x.gloss,
      x.strokes,
      x.popularity,
      x.gender,
      e.group ?? '',
      e.note ?? '',
    ]
      .map(esc)
      .join(',');
  });
  return '\ufeff' + [FAV_CSV_HEADER.join(','), ...rows].join('\r\n');
}
