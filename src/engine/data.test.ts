import { describe, expect, it } from 'vitest';
import candidatesRaw from '../data/candidates.json';
import sourcesRaw from '../data/sources.json';
import realRaw from '../data/realnames.json';
import { META, POOL, REAL_ITEMS, SINGLES } from './data';
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
    alt?: number[];
    alts?: unknown;
  };
  const raw = candidatesRaw as unknown as Raw[];
  const SRC = sourcesRaw as unknown as {
    titles: { t: string; slug: string }[];
    lines: ({ s: string; g: number } | string)[];
  };
  // 一条 alternate 在产物里就是四个整数：[ti, li 差值, pa, d]
  const altLen = (c: Raw) => {
    const a = c.alt ?? [];
    expect(a.length % 4, `${c.name} 的 alt 长度不是 4 的倍数`).toBe(0);
    return a.length / 4;
  };
  it('产物里不存 chars：双名条目的 chars 由 name 在加载时展开，运行时形状不变', () => {
    expect(raw.some((c) => 'chars' in c)).toBe(false);
    expect(POOL.length).toBe(raw.length);
    expect(POOL.length).toBe(META.pool_B);
    expect(POOL.map((it) => [...it.name].join(''))).toEqual(raw.map((c) => c.name));
    expect(one(POOL, '主池首条').chars).toEqual([...one(POOL, '主池首条').name]);
  });
  it('产物只存「共享表下标＋自己独有的字段」：id／原句／篇名／作者／今译下标都在加载时补', () => {
    const derived = ['id', 'chars', 'book', 'title', 'author', 'line', 'seg', 'tier', 'strict', 'lg', 'alts'];
    expect(raw.some((c) => derived.some((k) => k in c))).toBe(false);
    expect(
      raw.every(
        (c) => Number.isInteger(c.ti) && Number.isInteger(c.li) && typeof c.ns === 'string' && Number.isInteger(c.sq),
      ),
    ).toBe(true);
    expect(SRC.titles.length).toBe(META.src_titles);
    expect(SRC.lines.length).toBe(META.src_lines);
    expect(SRC.lines.filter((l) => (typeof l === 'string' ? true : l.g === -1)).length).toBe(META.src_lines_gap);
    // 共享的前提：同一句原句、同一篇作品在表里只存一份，所以表必然比「它服务的出处数」短。
    // 0.14.0 起出处数＝1,660 处主出处 ＋ alternates 处数，所以这条比的是出处总数而不是条目数。
    const altTotal = raw.reduce((n, c) => n + altLen(c), 0);
    expect(altTotal, '用例前提：产物里得有 alternates').toBeGreaterThan(0);
    expect(altTotal).toBe(META.alt_total);
    expect(SRC.lines.length).toBeLessThan(raw.length + altTotal);
    expect(SRC.titles.length).toBeLessThan(raw.length + altTotal);
    // 为 alternates 追加的条目一律排在主出处那一段之后：主出处用的下标必须是 0..N-1 连续一段，
    // 否则 id 里的书码／篇名拼音就对不上了（收藏、拉黑、分享链接全靠那个 id）
    const mainLines = new Set(raw.map((c) => c.li));
    const mainTitles = new Set(raw.map((c) => c.ti));
    expect(Math.max(...(mainLines as Set<number>))).toBe(mainLines.size - 1);
    expect(Math.max(...(mainTitles as Set<number>))).toBe(mainTitles.size - 1);
    const first = one(POOL, '主池首条');
    const raw0 = one(raw, '产物首条');
    const rawLine = SRC.lines[raw0.li ?? -1];
    const sharedLine = typeof rawLine === 'string' ? { s: rawLine, g: -1 } : rawLine;
    const sharedTitle = SRC.titles[raw0.ti ?? -1];
    if (!sharedLine || !sharedTitle) throw new Error('共享表下标越界');
    expect(first.line).toBe(sharedLine.s);
    expect(first.title).toBe(sharedTitle.t);
    expect(first.id.startsWith('B')).toBe(true);
    // 名字拼音段进 id 的那部分来自每条自己的 ns，不是现拼：多音字现拼会错位
    expect(first.id).toContain(raw0.ns ?? '');
  });
});
describe('多出处 alternates：产物里的编码与加载期展开', () => {
  type RawCand = { name: string; ti: number; li: number; alt?: number[] };
  const raw = candidatesRaw as unknown as RawCand[];
  const SRC = sourcesRaw as unknown as {
    titles: (
      { bk: string; code: string; t: string; au: string; slug: string; st: boolean } | [string, string, string, boolean]
    )[];
    lines: ({ s: string; g: number } | string)[];
  };
  it('每条 alternate 的四个下标都在共享表里，并且真指到那条原句里那两个字的这对位置（全池逐条，不是抽样）', () => {
    let n = 0;
    for (const c of raw) {
      const a = c.alt ?? [];
      expect(a.length % 4, `${c.name} 的 alt 不是 4 个一组`).toBe(0);
      let prev = 0;
      for (let i = 0; i < a.length; i += 4) {
        const [ti, liDelta, pa, d] = a.slice(i, i + 4) as [number, number, number, number];
        const li = prev + liDelta; // 同一个名字里 li 存的是相对上一条的差值
        prev = li;
        const title = SRC.titles[ti];
        const raw2 = SRC.lines[li];
        if (!title || raw2 === undefined) throw new Error(`${c.name} 的 alternate 共享表下标越界（ti=${ti} li=${li}）`);
        const line = typeof raw2 === 'string' ? { s: raw2, g: -1 } : raw2;
        const bk = Array.isArray(title) ? title[0] : title.bk;
        expect(bk, `alternate 指到的书必须是七本典籍之一（${c.name}）`).not.toBe('real');
        const cs = [...line.s];
        expect(
          cs[pa],
          `${c.name} 的 alternate 首字下标没指到「${c.name.charAt(0)}」（「${line.s}」第 ${pa + 1} 字是 ${cs[pa] ?? ''}）`,
        ).toBe(c.name.charAt(0));
        expect(cs[pa + d], `${c.name} 的 alternate 末字下标没指到「${c.name.charAt(1)}」（「${line.s}」）`).toBe(
          c.name.charAt(1),
        );
        n += 1;
      }
    }
    expect(n, '产物里的 alternate 处数与 meta.alt_total 对不上').toBe(META.alt_total);
    expect(n).toBeGreaterThan(0);
  });
  it('两张共享表分两段：主出处那一段形状与字节都不动，为 alternates 追加的那一段用紧凑形', () => {
    const mainLines = new Set(raw.map((c) => c.li));
    const mainTitles = new Set(raw.map((c) => c.ti));
    expect(SRC.lines.slice(0, mainLines.size).every((l) => typeof l !== 'string')).toBe(true);
    // 追加段：没有今译的就只是一个字符串；有人替它补了译文就存成 {s, g}（不许出现 g = -1 的半截形状）
    expect(SRC.lines.slice(mainLines.size).every((l) => typeof l === 'string' || l.g >= 0)).toBe(true);
    expect(SRC.titles.slice(0, mainTitles.size).every((t) => !Array.isArray(t) && !!t.slug && !!t.code)).toBe(true);
    expect(SRC.titles.slice(mainTitles.size).every((t) => Array.isArray(t) && t.length === 4)).toBe(true);
    // 紧凑形只落在追加段：主出处那一段一条也不许是字符串或四元组
    expect(SRC.lines.slice(0, mainLines.size).filter((l) => typeof l === 'string').length).toBe(0);
    expect(SRC.titles.slice(0, mainTitles.size).filter((t) => Array.isArray(t)).length).toBe(0);
  });
  it('加载后每条 alternate 都是界面上要用的形状：书·篇·作者、原句、那一段取词、今译下标', () => {
    const withAlt = POOL.filter((p) => (p.alts?.length ?? 0) > 0);
    expect(withAlt.length, '带 alternates 的条数与 meta.alt_names 对不上').toBe(META.alt_names);
    expect(withAlt.reduce((s, p) => s + p.alts!.length, 0)).toBe(META.alt_total);
    for (const p of withAlt)
      for (const a of p.alts!) {
        expect(a.title.length, 'alternate 必须有篇名').toBeGreaterThan(0);
        expect(a.line.length, 'alternate 必须有原句').toBeGreaterThan(1);
        expect(a.book, '真实人名档不该有 alternate').not.toBe('real');
        expect(typeof a.strict).toBe('boolean');
        expect(Number.isInteger(a.lg), '今译下标必须是整数（-1＝待补）').toBe(true);
        const cs = [...a.line];
        expect(a.win).toBe(cs.slice(a.at, a.at2 + 1).join(''));
        expect(a.win.startsWith(p.name.charAt(0)) && a.win.endsWith(p.name.charAt(1))).toBe(true);
      }
    // 产物里没有 alt 的名字，加载后也不该凭空多出一个运行时字段（界面据此决定要不要显示那一区）
    expect(raw.filter((c) => (c.alt?.length ?? 0) > 0).length).toBe(withAlt.length);
    expect(POOL.filter((p) => p.alts === undefined).length).toBe(raw.length - withAlt.length);
  });
  it('出处最多的那条：君子在《关雎》之外还挂着 288 处，每一处都有自己的篇与原句', () => {
    const junzi = one(
      POOL.filter((p) => p.name === '君子'),
      '池里应有「君子」',
    );
    expect(junzi.alts?.length, '君子的 alternates 处数').toBe(META.alt_max);
    expect(junzi.alts!.length).toBeGreaterThan(200);
    const titles = new Set(junzi.alts!.map((a) => `${a.book}\u0000${a.title}`));
    expect(titles.size, '君子的出处不该全挂在同一篇上').toBeGreaterThan(10);
    expect(junzi.alts!.some((a) => a.line.includes('君子'))).toBe(true);
  });
  it('真实人名档与单字名都不挂 alternates：它们没有「主出处之外还有几处」这件事', () => {
    expect(REAL_ITEMS.every((r) => r.alts === undefined)).toBe(true);
    expect(SINGLES.every((s) => s.alts === undefined)).toBe(true);
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
