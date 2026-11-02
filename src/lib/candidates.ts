// 候选全量导出：纯函数，把当前筛选命中的全部候选（不只是当前一页）转成 JSON / CSV 文本，下载由调用方做。
import { BOOK_LABEL, type Result } from '../engine/types';
import { lineGlossOf, popularity, shapeTags, wordEvidence } from '../engine/name';

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
  word: string; // 成词依据（语料内相邻次数 / 现代词表收录 / 典籍叠字 / 未见依据）
  split: string; // 跨字取词时被剪开的原词，没有就留空
};

export function candidateRow(r: Result): CandidateRow {
  return {
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
    ...candidateQuality(r),
  };
}

// 成词依据与拆词：卡片上那两个标签的同一套口径写进导出，用户在表格里也能只留「有依据的」那一档
export function candidateQuality(r: Result): { word: string; split: string } {
  const ev = wordEvidence(r as unknown as { a?: number; w?: number; redup?: boolean; spl?: string; char?: string });
  const word =
    ev.tier === 'attested'
      ? `语料内相邻 ${ev.a} 次`
      : ev.tier === 'modern'
        ? `现代词表收录（词频 ${ev.w}）`
        : ev.tier === 'redup'
          ? '典籍叠字'
          : ev.tier === 'single'
            ? '单字名不适用'
            : '未见依据';
  return { word, split: ev.spl };
}

export const candidateRows = (results: Result[]): CandidateRow[] => results.map((r) => candidateRow(r));

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

export const FAV_GENDER_LABEL: Record<'f' | 'm' | 'n', string> = { f: '偏女', m: '偏男', n: '中性' };

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
  '成词依据',
  '拆词',
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
    [
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
      x.word,
      x.split,
    ]
      .map(esc)
      .join(','),
  );
  return '\ufeff' + [CSV_HEADER.join(','), ...rows].join('\r\n');
}

// 收藏名单 CSV：候选的列全部保留，再加「分组」「备注」「收藏来源」「性别档」四列
// 来源与性别档是收藏当时按下的入口与当时所属的档，老记录没存过这两项就留空
export const FAV_CSV_HEADER = [...CSV_HEADER, '分组', '备注', '收藏来源', '性别档'];

export function favoritesCsv(
  entries: { r: Result; note?: string; group?: string; from?: 'gen' | 'compose' }[],
): string {
  const rows = entries.map((e) => {
    const x = candidateRow(e.r);
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
      x.word,
      x.split,
      e.group ?? '',
      e.note ?? '',
      e.from === 'gen' ? '生成页' : e.from === 'compose' ? '自选页' : '未记录',
      FAV_GENDER_LABEL[e.r.gender.side],
    ]
      .map(esc)
      .join(',');
  });
  return '\ufeff' + [FAV_CSV_HEADER.join(','), ...rows].join('\r\n');
}
