import { describe, expect, it } from 'vitest';
import candidatesRaw from '../data/candidates.json';
import realRaw from '../data/realnames.json';
import { META, POOL, REAL_ITEMS } from './data';
import { L0_CHARS } from './name';
import { one } from '../testing';

describe('候选池产物的存储形状', () => {
  const raw = candidatesRaw as unknown as { name: string; chars?: string[] }[];
  it('产物里不存 chars：双名条目的 chars 由 name 在加载时展开，运行时形状不变', () => {
    expect(raw.some((c) => 'chars' in c)).toBe(false);
    expect(POOL.length).toBe(raw.length);
    expect(POOL.length).toBe(META.pool_B);
    expect(POOL.map((it) => [...it.name].join(''))).toEqual(raw.map((c) => c.name));
    expect(one(POOL, '主池首条').chars).toEqual([...one(POOL, '主池首条').name]);
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
