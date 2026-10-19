import { describe, expect, it } from 'vitest';
import {
  cleanSurname, genderOf, genderPass, genderStats, glossOf, isKnownSurname, lineGlossOf, minGnOf, namePinyin,
  nicknames, plan, polyphoneTags, poolSize, popBand, popScore, popularity, radicalTags,
  readings, scoreItem, searchText, shapeTags, surnameReads,
} from './name';
import { CHARS, META, POOL, SINGLES } from './data';
import { BOOK_ORDER, type Book, type Opts } from './types';

const gen = (sur: string, o: Opts, b: number) => plan(sur, o, b).page;

const ALL_BOOKS = Object.fromEntries(BOOK_ORDER.map((b) => [b, true])) as Record<Book, boolean>;
const opts = (p: Partial<Opts> = {}): Opts => ({
  gender: 'any', genderWeak: false, length: 2, books: { ...ALL_BOOKS },
  redupOnly: false, exclude: [], count: 12, search: '', sort: 'score',
  strokeMax: 0, noMonotone: false, popFloor: 0, ...p,
});

describe('姓氏输入归一化', () => {
  it('拼音输入法中间态与非汉字一律剔除，最多两字', () => {
    expect(cleanSurname('yuan苏')).toBe('苏');
    expect(cleanSurname('苏')).toBe('苏');
    expect(cleanSurname('欧阳').length).toBe(2);
    expect(cleanSurname('司马大')).toBe('司马');
    expect(cleanSurname('')).toBe('');
  });
});

describe('读音表', () => {
  it('已知字给出带调读音，未知字给空数组', () => {
    expect(readings('苏')[0].syl).toBe('su');
    expect(readings('苏')[0].mark).toBe('sū');
    expect(readings('囍')).toEqual([]);
  });
  it('姓氏读音选择器只在首字多音时可选项，且序号越界回退到首读', () => {
    expect(surnameReads('欧')).toBe(1);
    expect(surnameReads('曾')).toBeGreaterThan(1);
    expect(surnameReads('')).toBe(0);
    expect(surnameReads('囍')).toBe(0);
  });
  it('一条读音＝一个带调音节：三数组必须等长且 mark 的声调与 t 一致', () => {
    const TONE: Record<string, string> = {
      ā: 'a', ē: 'e', ī: 'i', ō: 'o', ū: 'u', ǖ: 'ü',
      á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ǘ: 'ü',
      ǎ: 'a', ě: 'e', ǐ: 'i', ǒ: 'o', ǔ: 'u', ǚ: 'ü',
      à: 'a', è: 'e', ì: 'i', ò: 'o', ù: 'u', ǜ: 'ü',
    };
    for (const [ch, i] of Object.entries(CHARS)) {
      expect(i.py.length, ch).toBe(i.pm.length);
      expect(i.pm.length, ch).toBe(i.t.length);
      expect(i.py.length, ch).toBeGreaterThan(0);
      for (let k = 0; k < i.py.length; k++) {
        const raw = i.pm[k];
        // 只放过成音节写法（嗯 ǹg、呒 ḿ、欸 ê̄/ế）：它们用了常规拼音字母表之外的字符
        const exotic = [...raw].some((c) => !/[a-züāēīōǖáéíóúǘǎěǐǒǔǚàèìòùǜ]/.test(c));
        if (!exotic) {
          const base = [...raw].map((c) => TONE[c] ?? c).join('');
          expect(base, `${ch} 第 ${k} 条：${raw} 应为 ${i.py[k]}`).toBe(i.py[k]);
        }
        const tn = /[āēīōǖ]/.test(raw) ? 1 : /[áéíóú]/.test(raw) ? 2 : /[ǎěǐǒǔ]/.test(raw) ? 3 : /[àèìòù]/.test(raw) ? 4 : 0;
        if (tn) expect(i.t[k], `${ch} 第 ${k} 条声调与带调写法不符`).toBe(tn);
      }
    }
  });
});

describe('名用字与部首标注', () => {
  it('主池每个字都在 L0 与读音表内（+20「同在名用字表」这条规则的前提）', () => {
    for (const it of POOL) {
      for (const c of it.chars) {
        expect(CHARS[c], `${it.name} 的 ${c} 不在 CHARS`).toBeTruthy();
        expect(CHARS[c].l0, `${it.name} 的 ${c} 不在 L0`).toBe(true);
      }
    }
    for (const s of SINGLES) expect(CHARS[s.char].l0, s.char).toBe(true);
  });
  it('部首只标康熙五部的字，重复字不重复出标', () => {
    expect(radicalTags('沐杰').length).toBe(2);
    expect(radicalTags('沐沐').length).toBe(1);
    expect(radicalTags('叮咛')).toEqual([]);
  });
});

describe('性别判定：强弱两级', () => {
  it('两侧都有字＝中性，不靠一票定性', () => {
    const both = POOL.find((p) => {
      const f = p.chars.some((c) => genderOf(c).side === 'f');
      const m = p.chars.some((c) => genderOf(c).side === 'm');
      return f && m;
    });
    expect(both, '主池里应有两侧字混用的名字').toBeTruthy();
    const g = genderOf(both!.name);
    expect(g.side).toBe('n');
    expect(g.why).toContain('两表都有字');
    expect(genderPass(both!.name, opts({ gender: 'f' }))).toBe(true);
  });
  it('单侧命中但其余字无信号＝疑似；每字同侧＝强', () => {
    const weak = [...POOL].map((p) => p.name).find((n) => { const g = genderOf(n); return g.side !== 'n' && !g.strong; });
    const strong = [...POOL].map((p) => p.name).find((n) => { const g = genderOf(n); return g.side !== 'n' && g.strong; });
    expect(genderOf(weak!).strong).toBe(false);
    expect(genderOf(strong!).strong).toBe(true);
  });
  it('筛选：反向名排除、中性保留、疑似默认排除', () => {
    const f = (name: string) => genderOf(name).side === 'f';
    const m = (name: string) => genderOf(name).side === 'm';
    const femName = POOL.find((p) => f(p.name))!.name;
    const maleName = POOL.find((p) => m(p.name))!.name;
    expect(genderPass(femName, opts({ gender: 'm' }))).toBe(false);
    expect(genderPass(maleName, opts({ gender: 'f' }))).toBe(false);
    expect(genderPass(maleName, opts({ gender: 'any' }))).toBe(true);
    const weakFem = POOL.find((p) => { const g = genderOf(p.name); return g.side === 'f' && !g.strong; })!;
    expect(genderPass(weakFem.name, opts({ gender: 'f' }))).toBe(false);
    expect(genderPass(weakFem.name, opts({ gender: 'f', genderWeak: true }))).toBe(true);
  });
  it('poolSize 与 genderStats 同一口径', () => {
    const o = opts({ gender: 'f' });
    expect(genderStats(o).kept).toBe(poolSize(o));
    expect(genderStats(o).same).toBeLessThanOrEqual(poolSize(o));
    expect(poolSize(opts())).toBe(META.pool_B);
  });
});

describe('打分', () => {
  it('总分等于明细之和，且明细规则文案不重复（卡片用 rule 作 key）', () => {
    for (const it of gen('苏', opts(), 0)) {
      expect(it.total).toBe(it.deltas.reduce((a, d) => a + d.delta, 0));
      expect(new Set(it.deltas.map((d) => d.rule)).size).toBe(it.deltas.length);
    }
  });
  it('单名卡片不许出现「两字同在名用字表」', () => {
    const single = gen('苏', opts({ length: 1 }), 0)[0];
    expect(single.name.length).toBe(1);
    expect(single.deltas.some((d) => d.rule.includes('两字'))).toBe(false);
  });
  it('无姓时不伪造姓氏：全名＝名字本身，读音只含名字的字', () => {
    const it = POOL[0];
    const r = scoreItem('', it, opts(), 0);
    expect(r.full).toBe(it.name);
    expect(r.readings.length).toBe([...it.name].length);
  });
  it('音韵规则真在跑：三字同声调 / 双声 / 叠韵 / 谐音至少各有可命中的样本', () => {
    const rules = new Set<string>();
    for (const sur of ['苏', '林', '江', '周', '张']) {
      for (const it of POOL) for (const d of scoreItem(sur, it, opts(), 0).deltas) rules.add(d.rule.split('（')[0].split('「')[0]);
    }
    const hit = (kw: string) => [...rules].some((r) => r.includes(kw));
    expect(hit('声调')).toBe(true);
    expect(hit('双声')).toBe(true);
    expect(hit('叠韵')).toBe(true);
    expect(hit('谐音')).toBe(true);
  });
});

describe('姓字查不到读音：音韵规则整体失效必须可见', () => {
  it('已知姓返回 true，查不到的字返回 false', () => {
    expect(isKnownSurname('苏')).toBe(true);
    expect(isKnownSurname('欧阳')).toBe(true);
    expect(isKnownSurname('囍囍')).toBe(false);
  });
});

// 全池逐页翻是 O(页数 × 全池打分)：种子版 39 页毫秒级，扩表到 3,234 条实测 20 ms/页 × 270 页 ≈ 5.5 s/轮，
// 这个 describe 里有 8 轮，默认 5 s 超时会把「覆盖率门禁」误判成失败。只给这里放宽，别处仍按默认。
const SWEEP_TIMEOUT = 120_000;

describe('批次可达性：换一批必须真能翻遍全池', () => {
  const sweep = (o: Opts, sur: string) => {
    const p0 = plan(sur, o, 0);
    const seen: string[] = [];
    for (let b = 0; b < p0.pages; b++) seen.push(...gen(sur, o, b).map((r) => r.id));
    return { p0, seen, uniq: new Set(seen) };
  };
  for (const count of [12, 24, 48]) {
    it(`每批 ${count} 条：翻满 plan().pages 页不重不漏覆盖全池`, () => {
      const o = opts({ count });
      for (const sur of ['苏', '欧阳']) {
        const { p0, seen, uniq } = sweep(o, sur);
        expect(p0.pool).toBe(poolSize(o));
        expect(uniq.size).toBe(p0.pool);
        expect(seen.length).toBe(p0.pool);
      }
    }, SWEEP_TIMEOUT);
  }
  it('首页同书不超过 4 条（否则一屏全被宋词占满）；尾部只剩一本书时由补位轮装满', () => {
    const o = opts({ count: 12 });
    const { p0, seen, uniq } = sweep(o, '苏');
    const per = new Map<string, number>();
    for (const r of p0.page) per.set(r.book, (per.get(r.book) ?? 0) + 1);
    for (const [book, n] of per) expect(n, `首页 ${book} ${n} 条`).toBeLessThanOrEqual(4);
    expect(p0.page.length).toBe(o.count);
    expect(uniq.size).toBe(seen.length);
    for (let b = 0; b < p0.pages; b++) {
      const len = gen('苏', o, b).length;
      if (b < p0.pages - 1) expect(len, `第 ${b} 页只有 ${len} 条`).toBe(o.count);
      else expect(len).toBeGreaterThanOrEqual(1);
    }
    expect(p0.pages).toBe(Math.ceil(p0.pool / o.count));
  }, SWEEP_TIMEOUT);
  it('页码回绕：翻过最后一页回到第 1 页，不会翻出空白', () => {
    const o = opts({ count: 12 });
    const { p0 } = sweep(o, '苏');
    expect(plan('苏', o, p0.pages).page.map((r) => r.id)).toEqual(p0.page.map((r) => r.id));
    expect(plan('苏', o, p0.pages + 1).pageNo).toBe(1);
  }, SWEEP_TIMEOUT);
  it('打分确定：同输入两次结果逐条一致，换一个条件就重算', () => {
    const base = opts({ count: 12 });
    const p1 = plan('苏', base, 0).page.map((r) => r.id);
    const fem = plan('苏', opts({ count: 12, gender: 'f' }), 0).page.map((r) => r.id);
    expect(fem).not.toEqual(p1);
    const otherSur = plan('林', base, 0).page.map((r) => r.id);
    expect(otherSur).not.toEqual(p1);
    expect(plan('苏', base, 0).page.map((r) => r.id)).toEqual(p1);
    const first = p1[0];
    const blocked = plan('苏', opts({ count: 12, exclude: [first] }), 0).page.map((r) => r.id);
    expect(blocked).not.toContain(first);
    expect(plan('苏', base, 0).page.map((r) => r.id)).toEqual(p1);
  });
  it('典籍全关＝空池，plan 不炸且页数 0', () => {
    const none = opts({ books: Object.fromEntries(BOOK_ORDER.map((b) => [b, false])) as Record<Book, boolean> });
    const p = plan('苏', none, 3);
    expect(p).toEqual({ page: [], pageNo: 0, pages: 0, pool: 0 });
  });
});

describe('字义 / 字形 / 多音 / 小名 / 用字常见度', () => {
  it('字义取本义、未知字为 null', () => {
    expect(glossOf('沐')).toBe('洗头发');
    expect(glossOf('云')).toBe('云彩');
    expect(glossOf('囍')).toBeNull();
  });
  it('结构来自字表：双字结构给出笔画合计；同结构才提示单调', () => {
    const s = shapeTags('苏沐'); // 苏=上下7画、沐=左右7画
    expect(s.strokes).toBe(14);
    expect(s.sameStructure).toBe(false);
    const same = shapeTags('江河'); // 都左右
    expect(same.sameStructure).toBe(true);
    expect(same.note).toContain('左右');
    const one = shapeTags('苏苏'); // 去重后单字，不判单调
    expect(one.sameStructure).toBe(false);
  });
  it('多音字：只挑出名字里读法不止一种的字', () => {
    const item = POOL.find((p) => p.chars.some((c) => (CHARS[c].pm?.length ?? 0) > 1));
    expect(item, '池内应有多音字样本').toBeTruthy();
    const poly = polyphoneTags(item!.name);
    expect(poly.length).toBeGreaterThan(0);
    for (const p of poly) expect(CHARS[p.ch].pm.length).toBeGreaterThan(1);
    expect(polyphoneTags('沐沐')).toEqual([]);
  });
  it('小名：逐字叠用 + 末字加「小」', () => {
    expect(nicknames('云归')).toEqual(['云云', '归归', '小归']);
    expect(nicknames('沐')).toEqual(['沐沐', '小沐']);
  });
  it('用字常见度分档，依据真实姓名用字频次', () => {
    expect(popularity('云').band).toBe('很常见');
    expect(popularity('归').band).toBe('冷僻');
    expect(popularity('云归').band).toBe('很常见'); // 取更常见的那个字
    expect(popScore('云')).toBeGreaterThan(popScore('归'));
  });
  it('常见度分档的边界值（含最小值也是冷僻）', () => {
    expect(popBand(8000)).toBe('很常见');
    expect(popBand(7999)).toBe('常见');
    expect(popBand(2000)).toBe('常见');
    expect(popBand(1999)).toBe('一般');
    expect(popBand(500)).toBe('一般');
    expect(popBand(499)).toBe('少见');
    expect(popBand(100)).toBe('少见');
    expect(popBand(99)).toBe('冷僻');
    expect(popBand(0)).toBe('冷僻');
  });
  it('namePinyin 拼出无声调读音串，searchText 含名字/拼音/篇名/作者', () => {
    const it = POOL[0];
    const py = namePinyin(it.name);
    expect(py).toBe([...it.name].map((c) => readings(c)[0].syl).join(''));
    expect(py).toMatch(/^[a-z]+$/);
    const t = searchText(it);
    expect(t).toContain(it.name);
    expect(t).toContain(py);
    expect(t).toContain(it.title.toLowerCase());
  });
});

describe('出处今译', () => {
  it('每条候选与单字出处都能取到非空今译，且同一句共用一个下标', () => {
    for (const it of [...POOL, ...SINGLES]) {
      expect(Number.isInteger(it.lg)).toBe(true);
      expect(lineGlossOf(it).length).toBeGreaterThan(0);
    }
    const byLine = new Map<string, number>();
    for (const it of [...POOL, ...SINGLES]) {
      if (byLine.has(it.line)) expect(it.lg).toBe(byLine.get(it.line));
      else byLine.set(it.line, it.lg);
    }
    expect(byLine.size).toBe(META.line_gloss);
  });
  it('抽一条核对句意（灵均）', () => {
    const hit = POOL.find((p) => p.name === '灵均')!;
    expect(lineGlossOf(hit)).toBe('父亲审视我初生时的器度，开始赐我美名：给我取名叫正则，取字叫灵均。');
  });
  it('越界下标返回空串而不是 undefined（界面按留白处理）', () => {
    expect(lineGlossOf({ lg: 99999 })).toBe('');
  });
});

describe('检索与排序', () => {
  it('搜索按 名字/拼音/篇名 命中，并缩小池子', () => {
    const all = poolSize(opts());
    const hit = plan('苏', opts({ search: '云' }), 0);
    expect(hit.pool).toBeLessThan(all);
    for (const r of hit.page) expect(searchText(r)).toContain('云');
    // 拼音也能搜：yun
    expect(poolSize(opts({ search: 'yun' }))).toBeGreaterThan(0);
    // 无命中即空池，不炸
    expect(plan('苏', opts({ search: 'zzzz' }), 0).pool).toBe(0);
  });
  it('按笔画排序时结果笔画单调不减；按常见度排序时单调不增', () => {
    // 单本典籍、一屏全展开：绕开分页的「同书每页≤4」跨书交织，直接看排序键
    const only = (sort: Opts['sort']): Opts => opts({
      count: 0, sort, books: Object.fromEntries(BOOK_ORDER.map((b) => [b, b === 'daofa'])) as Record<Book, boolean>,
    });
    const strokesOf = (name: string) => [...name].reduce((a, ch) => a + (CHARS[ch].st ?? 0), 0);
    const byStroke = plan('苏', only('strokes'), 0).page.map((r) => strokesOf(r.name));
    expect(byStroke.length).toBeGreaterThan(4);
    for (let i = 1; i < byStroke.length; i++) expect(byStroke[i]).toBeGreaterThanOrEqual(byStroke[i - 1]);
    const byPop = plan('苏', only('popular'), 0).page.map((r) => popScore(r.name));
    for (let i = 1; i < byPop.length; i++) expect(byPop[i]).toBeLessThanOrEqual(byPop[i - 1]);
  });
});

describe('生成结果的结构约束', () => {
  it('拉黑过的 id 在任何一批里都不再出现', () => {
    const blocked = POOL.slice(0, 20).map((p) => p.id);
    const o = opts({ count: 24, exclude: blocked });
    for (let b = 0; b < 5; b++) for (const r of gen('苏', o, b)) expect(blocked).not.toContain(r.id);
    expect(poolSize(o)).toBe(META.pool_B - 20);
  });
  it('只留一本典籍时，结果全部来自那一本', () => {
    const only = opts({ books: Object.fromEntries(BOOK_ORDER.map((b) => [b, b === 'daofa'])) as Record<Book, boolean> });
    expect(poolSize(only)).toBe(META.per_book.daofa);
    for (const r of gen('苏', only, 0)) expect(r.book).toBe('daofa');
  });
  it('叠字只存在于双名层：只看典籍叠字 × 单名必定空池（界面据此藏起开关，别让用户猜原因）', () => {
    expect(POOL.filter((p) => p.redup).length).toBeGreaterThan(0);
    expect(poolSize(opts({ length: 1, redupOnly: true }))).toBe(0);
    expect(gen('苏', opts({ length: 1, redupOnly: true }), 0)).toEqual([]);
    expect(poolSize(opts({ length: 2, redupOnly: true }))).toBeGreaterThan(0);
  });
});

describe('字形/用字筛选（可核对的事实，不掺命理）', () => {
  it('整名笔画上限：结果全部 ≤ 上限，且确实缩小了池子', () => {
    const o = opts({ strokeMax: 16 });
    const page = gen('苏', o, 0);
    expect(page.length).toBeGreaterThan(0);
    for (const r of page) expect(shapeTags(r.name).strokes).toBeLessThanOrEqual(16);
    expect(poolSize(o)).toBeLessThan(poolSize(opts()));
  });
  it('用字常见度下限：结果每个字都达标（按最小值判定），冷僻字被挡在外面', () => {
    const o = opts({ popFloor: 500 });
    const page = gen('苏', o, 0);
    expect(page.length).toBeGreaterThan(0);
    for (const r of page) expect(minGnOf(r.name)).toBeGreaterThanOrEqual(500);
    expect(poolSize(o)).toBeLessThan(poolSize(opts()));
  });
  it('避开同结构：结果里没有「两字同结构」的名字', () => {
    const o = opts({ noMonotone: true });
    const page = gen('苏', o, 0);
    expect(page.length).toBeGreaterThan(0);
    for (const r of page) expect(shapeTags(r.name).sameStructure).toBe(false);
  });
  it('三档都为默认值时不改变池子（不限 = 不过滤）', () => {
    expect(poolSize(opts({ strokeMax: 0, popFloor: 0, noMonotone: false }))).toBe(poolSize(opts()));
  });
});
