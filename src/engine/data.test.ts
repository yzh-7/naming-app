import { describe, expect, it } from 'vitest';
import candidatesRaw from '../data/candidates.json';
import { META, POOL } from './data';
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
