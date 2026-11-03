import { describe, expect, it } from 'vitest';
import candidatesRaw from '../data/candidates.json';
import sourcesRaw from '../data/sources.json';
import realRaw from '../data/realnames.json';
import { META, POOL, REAL_ITEMS } from './data';
import { L0_CHARS } from './name';
import { one } from '../testing';

describe('候选池产物的存储形状', () => {
  type Raw = {
    name: string;
    chars?: string[];
    ti?: number;
    li?: number;
    so?: number;
    sn?: number;
    ns?: string;
    sq?: number;
  };
  const raw = candidatesRaw as unknown as Raw[];
  const SRC = sourcesRaw as unknown as { titles: { t: string; slug: string }[]; lines: { s: string; g: number }[] };
  it('产物里不存 chars：双名条目的 chars 由 name 在加载时展开，运行时形状不变', () => {
    expect(raw.some((c) => 'chars' in c)).toBe(false);
    expect(POOL.length).toBe(raw.length);
    expect(POOL.length).toBe(META.pool_B);
    expect(POOL.map((it) => [...it.name].join(''))).toEqual(raw.map((c) => c.name));
    expect(one(POOL, '主池首条').chars).toEqual([...one(POOL, '主池首条').name]);
  });
  it('产物只存「共享表下标＋自己独有的字段」：id／原句／篇名／作者／今译下标都在加载时补', () => {
    const derived = ['id', 'chars', 'book', 'title', 'author', 'line', 'seg', 'tier', 'strict', 'lg'];
    expect(raw.some((c) => derived.some((k) => k in c))).toBe(false);
    expect(
      raw.every(
        (c) => Number.isInteger(c.ti) && Number.isInteger(c.li) && typeof c.ns === 'string' && Number.isInteger(c.sq),
      ),
    ).toBe(true);
    expect(SRC.titles.length).toBe(META.src_titles);
    expect(SRC.lines.length).toBe(META.src_lines);
    expect(SRC.lines.filter((l) => l.g === -1).length).toBe(META.src_lines_gap);
    // 共享的前提：同一条原句只存一次，所以表必然比条目短
    expect(SRC.lines.length).toBeLessThan(raw.length);
    expect(SRC.titles.length).toBeLessThan(raw.length);
    const first = one(POOL, '主池首条');
    const raw0 = one(raw, '产物首条');
    const sharedLine = SRC.lines[raw0.li ?? -1];
    const sharedTitle = SRC.titles[raw0.ti ?? -1];
    if (!sharedLine || !sharedTitle) throw new Error('共享表下标越界');
    expect(first.line).toBe(sharedLine.s);
    expect(first.title).toBe(sharedTitle.t);
    expect(first.id.startsWith('B')).toBe(true);
    // 名字拼音段进 id 的那部分来自每条自己的 ns，不是现拼：多音字现拼会错位
    expect(first.id).toContain(raw0.ns ?? '');
  });
});
describe('真实人名档的存储形状', () => {
  const raw = realRaw as unknown as { name: string; rn: number; src: string; rs?: string; id?: string }[];
  it('产物只存 name / rn / src（有性别标注时多个 rs），其余形状由加载时补', () => {
    expect(raw.length).toBe(META.real_tier);
    expect(REAL_ITEMS.length).toBe(META.real_tier);
    expect(raw.every((r) => !('id' in r) && !('line' in r) && r.src === 'real')).toBe(true);
    expect(raw.every((r) => [...r.name].length === 2 && r.rn >= 1)).toBe(true);
    expect(raw.every((r) => !('rs' in r) || ['m', 'f', 'n'].includes(r.rs as string))).toBe(true);
    const first = one(raw, '真实人名档首条');
    const loaded = one(REAL_ITEMS, '真实人名档加载后首条');
    expect(loaded.id).toBe(`RN_${first.name}`);
    expect(loaded.book).toBe('real');
    expect(loaded.line).toBe('');
    expect(loaded.lg).toBe(-1);
    expect(loaded.rn).toBe(first.rn);
  });
  it('这一档的每个字都在名用字白名单里——它不许绕过用字口径', () => {
    for (const it of REAL_ITEMS)
      for (const ch of it.name) expect(L0_CHARS.includes(ch), `${it.name} 的 ${ch}`).toBe(true);
  });
});
