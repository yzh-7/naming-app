import { describe, expect, it } from 'vitest';
import { candidateRows, candidatesCsv, candidatesJson, CSV_HEADER } from './candidates';
import { plan } from '../engine/name';
import type { Opts, Result } from '../engine/types';
import { BOOK_ORDER } from '../engine/types';

const opts: Opts = {
  gender: 'any', genderWeak: false, length: 2,
  books: Object.fromEntries(BOOK_ORDER.map((b) => [b, true])) as Opts['books'],
  redupOnly: false, exclude: [], count: 0, search: '', sort: 'score',
  strokeMax: 0, noMonotone: false, popFloor: 0, mustChar: '', mustPos: 'any',
};

// 假 Result 只填 CSV 会读到的字段，专测转义
const fake = (over: Partial<Result>): Result => ({
  id: 'x', name: '清婉', full: '苏清婉', book: 'shijing', title: '野有死麕', author: '佚名',
  line: '野有死麕，白茅包之', seg: '野有死麕', foot: 2, gap: 1, strict: true, redup: false, lg: 0,
  readings: ['qīng', 'wǎn'], total: 31, deltas: [], flags: [], gender: { side: 'n', strong: false, why: '' },
  ...over,
} as Result);

describe('候选全量导出', () => {
  const page = plan('林', opts, 0).page;
  it('全量：count:0 时 plan 一屏给出整个池，导出条数＝池子条数', () => {
    expect(page.length).toBeGreaterThan(100);
    expect(candidateRows(page)).toHaveLength(page.length);
    const json = JSON.parse(candidatesJson(page));
    expect(json.kind).toBe('candidates');
    expect(json.count).toBe(page.length);
    expect(json.rows[0]).toMatchObject({ full: expect.any(String), score: expect.any(Number), book: expect.any(String) });
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
  it('字段完整：出处今译与笔画、常见度都在行里', () => {
    const row = candidateRows(plan('苏', { ...opts, search: '清馨' }, 0).page)[0];
    expect(row.name).toBe('清馨');
    expect(row.book).toBeTruthy();
    expect(row.gloss).toBeTruthy();
    expect(row.strokes).toBeGreaterThan(0);
    expect(['很常见', '常见', '一般', '少见', '冷僻'].some((b) => b.includes(row.popularity) || row.popularity.includes(b))).toBe(true);
  });
});
