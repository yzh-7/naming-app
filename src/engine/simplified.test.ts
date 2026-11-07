import { describe, expect, it } from 'vitest';
import pairs from '../data/t2s.json';
import { META } from './data';
import { hasTraditional, toSimplified, traditionalRewrites } from './simplified';

// 表的口径写在这里而不是只写在文档里：这几条红了，说明表被手改过或语料与表脱节了
describe('繁简输入归一表（0.20.0）', () => {
  it('产物里的对数与 meta 记的一致，且两侧长度成对', () => {
    expect(META.t2s_pairs, 'meta 里的对数是构建时数的，界面这边再数一遍').toBe(1122);
    expect(META.t2s_targets).toBe(1031);
  });

  it('表里没有一行是多余的：简体侧全部落在可匹配字符集里（0.20.0 的取表口径）', () => {
    expect(META.t2s_outside, '多了就说明语料缩了没重生成表；多余的行无害，但要看得见').toBe(0);
    expect(META.t2s_charset).toBeGreaterThan(2000);
  });

  it('常见的姓与用字都认得：蘇 陈 東 雲 龍', () => {
    expect(toSimplified('蘇')).toBe('苏');
    expect(toSimplified('陳').length).toBe(1);
    expect(toSimplified('東')).toBe('东');
    expect(toSimplified('雲')).toBe('云');
    expect(toSimplified('龍')).toBe('龙');
  });

  it('复姓整串归一，两字姓不会只改一半', () => {
    expect(toSimplified('歐陽')).toBe('欧阳');
    expect(toSimplified('諸葛')).toBe('诸葛');
  });

  it('一字对多的两个繁体都落到同一个简体（發／髮 → 发）', () => {
    const a = toSimplified('發');
    const b = toSimplified('髮');
    expect(a).toBe(b);
    expect(hasTraditional('發')).toBe(true);
  });

  it('简体与表外的字符一律原样：拼音、标点、假名、生僻字都不受影响', () => {
    expect(toSimplified('苏晚 dongke · 第2批')).toBe('苏晚 dongke · 第2批');
    expect(toSimplified('')).toBe('');
    expect(toSimplified('぀')).toBe('぀');
  });

  it('归一是幂等的：改过一次的串再过一次不动', () => {
    const once = toSimplified('蘇陳東');
    expect(toSimplified(once)).toBe(once);
    expect(hasTraditional(once)).toBe(false);
  });

  it('表里不许有链：每个简体侧自己必须原样，否则一次映射到位这件事就不成立', () => {
    const chained: string[] = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const simp = pairs[i + 1];
      if (simp === undefined) continue;
      const again = toSimplified(simp);
      if (again !== simp) chained.push(`${simp} → ${again}`);
    }
    expect(chained, '简体侧再映射一次应当不动').toEqual([]);
  });

  it('提示按出现顺序去重，重复的字只列一次', () => {
    expect(traditionalRewrites('蘇蘇陳')).toEqual(['蘇 → 苏', '陳 → 陈']);
    expect(traditionalRewrites('苏陈')).toEqual([]);
  });
});
