import { describe, expect, it } from 'vitest';
import {
  candidateRow,
  candidateRows,
  candidatesCsv,
  candidatesJson,
  favoritesCsv,
  FAV_CSV_HEADER,
  CSV_HEADER,
} from './candidates';
import { plan } from '../engine/name';
import type { Opts, Result } from '../engine/types';
import { BOOK_ORDER } from '../engine/types';
import { at, one } from '../testing';

const opts: Opts = {
  gender: 'any',
  wordOnly: true,
  source: 'all',
  length: 2,
  books: Object.fromEntries(BOOK_ORDER.map((b) => [b, true])) as Opts['books'],
  redupOnly: false,
  exclude: [],
  count: 0,
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

// 假 Result 只填 CSV 会读到的字段，专测转义
const fake = (over: Partial<Result>): Result =>
  ({
    id: 'x',
    name: '清婉',
    full: '苏清婉',
    book: 'shijing',
    title: '野有死麕',
    author: '佚名',
    line: '野有死麕，白茅包之',
    seg: '野有死麕',
    foot: 2,
    gap: 1,
    strict: true,
    redup: false,
    lg: 0,
    readings: ['qīng', 'wǎn'],
    total: 31,
    deltas: [],
    flags: [],
    gender: { side: 'n', strong: false, why: '' },
    ...over,
  }) as Result;

describe('候选全量导出', () => {
  const page = plan('林', opts, 0).page;
  it('全量：count:0 时 plan 一屏给出整个池，导出条数＝池子条数', () => {
    expect(page.length).toBeGreaterThan(100);
    expect(candidateRows(page)).toHaveLength(page.length);
    const json = JSON.parse(candidatesJson(page));
    expect(json.kind).toBe('candidates');
    expect(json.count).toBe(page.length);
    expect(json.rows[0]).toMatchObject({
      full: expect.any(String),
      score: expect.any(Number),
      book: expect.any(String),
    });
  });
  it('CSV：BOM + 表头 + 每行一个候选', () => {
    const csv = candidatesCsv(page);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines).toHaveLength(page.length + 1);
  });
  it('CSV 转义：引号翻倍、含逗号/引号的字段整段加引号', () => {
    const csv = candidatesCsv([fake({ line: '他说，"清"婉', title: '篇,名' })]);
    const row = csv.slice(1).split('\r\n')[1];
    expect(row).toContain('"他说，""清""婉"');
    expect(row).toContain('"篇,名"');
  });
  it('CSV 防公式注入：= + - @ 打头的文本前置单引号，换行压成空格', () => {
    const csv = candidatesCsv([fake({ full: '=1+1', title: '-2', author: '@cmd', line: '+3' })]);
    // 数据行必须在：后面的按列拆分断言才能继续
    const row = at(csv.slice(1).split('\r\n'), 1, 'CSV 的数据行');
    expect(row).toContain("'=1+1");
    expect(row).toContain("'-2");
    expect(row).toContain("'@cmd");
    expect(row).toContain("'+3");
    // 不加前导引号就会出现「,=1+1」这种能被表格软件当公式执行的写法
    expect(row).not.toContain(',=1+1');
    // 字段里塞换行会凭空多出一行，必须压掉
    const nl = candidatesCsv([fake({ line: '第一行\n第二行\r\n第三行' })]);
    expect(nl.slice(1).split('\r\n')).toHaveLength(2);
    expect(nl).toContain('第一行 第二行 第三行');
    // 数字列不受影响：分数仍是裸数字（既没被加前导引号，也不是 undefined）
    expect(row.split(',')[3]).toMatch(/^\d+(\.\d+)?$/);
  });
  it('收藏 CSV 的分组与备注（手打的）同样防公式执行', () => {
    const r = one(plan('苏', { ...opts, search: '清馨' }, 0).page, 'plan 搜「清馨」的候选页');
    const csv = favoritesCsv([{ r, group: '=HYPERLINK("x")', note: '-@危险备注' }]);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain("'-@危险备注");
  });
  it('成词依据、拆词、真实用名次数、其他出处数四列有值：有依据的写出次数，跨字取词被剪开的写出原词，别处还核对得到的写条数', () => {
    expect(CSV_HEADER.slice(-4)).toEqual(['成词依据', '拆词', '真实用名次数', '其他出处数']);
    const rows = candidateRows(plan('袁', { ...opts, count: 0 }, 0).page);
    const attested = rows.find((x) => x.word.startsWith('语料内相邻'));
    const modern = rows.find((x) => x.word.startsWith('现代词表收录'));
    const split = rows.find((x) => x.split);
    expect(attested, '应有语料内相邻多次的名字').toBeTruthy();
    expect(modern, '应有现代词表收录的名字').toBeTruthy();
    expect(split, '应有被剪开原词的名字').toBeTruthy();
    expect(attested!.word).toMatch(/^语料内相邻 \d+ 次$/);
    expect(split!.split.length).toBe(2);
  });

  it('「其他出处数」就是卡片上「另有 N 处出处」的那个 N：条数来自引擎，不是导出里另算一遍', () => {
    const page = plan('袁', { ...opts, count: 0 }, 0).page;
    const idx = CSV_HEADER.indexOf('其他出处数');
    expect(idx, '候选 CSV 必须有「其他出处数」这一列').toBe(CSV_HEADER.length - 1);
    const withAlt = one(
      page.filter((r) => (r.alts?.length ?? 0) > 0),
      '用例前提：池里得有条目在主出处之外还能核对到别处',
    );
    expect(candidateRow(withAlt).altCount).toBe(withAlt.alts!.length);
    const bare = one(
      page.filter((r) => r.book !== 'real' && !r.alts),
      '用例前提：池里得有条目只有主出处一处',
    );
    expect(candidateRow(bare).altCount).toBe(0);
    // 真实人名档没有典籍出处，这一列留空而不是写 0（写 0 会让它看起来像「查过典籍、只有一处」）
    const realRow = candidateRow(one(plan('袁', { ...opts, count: 0, source: 'real' }, 0).page, '真实人名档候选'));
    expect(realRow.book).toBe('真实人名');
    expect(realRow.altCount).toBe('');
    // 导出的是条数不是那些原句本身：1,677 处出处文本不该被塞进一份随手下载的表里
    const csv = candidatesCsv(page);
    expect(csv).not.toContain('另有');
    expect(at(csv.slice(1).split('\r\n'), 1, '候选 CSV 的数据行').split(',').length).toBe(CSV_HEADER.length);
  });

  it('字段完整：出处今译与笔画、常见度都在行里', () => {
    const row = one(candidateRows(plan('苏', { ...opts, search: '清馨' }, 0).page), 'candidateRows 导出的行');
    expect(row.name).toBe('清馨');
    expect(row.book).toBeTruthy();
    expect(row.gloss).toBeTruthy();
    expect(row.strokes).toBeGreaterThan(0);
    expect(
      ['很常见', '常见', '一般', '少见', '冷僻'].some((b) => b.includes(row.popularity) || row.popularity.includes(b)),
    ).toBe(true);
  });

  it('收藏 CSV 在候选列之后只加分组、备注、收藏来源三列（性别那一列已经有了，不再加一列性别档），带逗号的备注要加引号', () => {
    const r = one(plan('苏', { ...opts, search: '清馨' }, 0).page, 'plan 搜「清馨」的候选页');
    const csv = favoritesCsv([{ r, group: '终选', note: '喜欢, 但笔画多', from: 'gen' }]);
    const lines = csv.replace(/\r\n/g, '\n').split('\n');
    expect(lines[0]).toBe('\ufeff' + FAV_CSV_HEADER.join(','));
    expect(FAV_CSV_HEADER.slice(CSV_HEADER.length)).toEqual(['分组', '备注', '收藏来源']);
    // 数据行必须在：下面的按列拆分与尾部断言都落在它身上
    const dataLine = at(lines, 1, '收藏 CSV 拆出的行');
    const cells = dataLine.split(',');
    // 含逗号的字段必须整字段加引号，否则列会错位（这里数一下就看得出多了一列）
    expect(dataLine).toContain('"喜欢, 但笔画多"');
    // 尾部两列是分组／备注，最后一列是收藏时按下的入口
    expect(dataLine.endsWith('"喜欢, 但笔画多",生成页')).toBe(true);
    expect(cells[0]).toBe(r.full);
    expect(cells[CSV_HEADER.length]).toBe('终选');
    // 没有分组与备注、也没存过来源的老记录：三列都在，来源写「未记录」
    const bareCsv = favoritesCsv([{ r }]).replace(/\r\n/g, '\n').split('\n');
    const bare = at(bareCsv, 1, '无分组备注的收藏 CSV 拆出的行').split(',');
    expect(bare).toHaveLength(FAV_CSV_HEADER.length);
    expect(bare.slice(CSV_HEADER.length)).toEqual(['', '', '未记录']);
  });
});
