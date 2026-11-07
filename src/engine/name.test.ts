import { describe, expect, it } from 'vitest';
import {
  avoidPass,
  charFacts,
  cleanSurname,
  composeName,
  findCombo,
  findItem,
  genderOf,
  genderPass,
  glossOf,
  isKnownSurname,
  isReduplexName,
  L0_CHARS,
  lineGlossOf,
  minGnOf,
  namePinyin,
  pairCandidates,
  nicknames,
  plan,
  POOL_TITLES,
  polyphoneTags,
  poolSize,
  titlesForBooks,
  popBand,
  popScore,
  popularity,
  radicalTags,
  readings,
  scoreItem,
  searchText,
  shapeTags,
  surnameReads,
  wordBonus,
  wordEvidence,
  wordPass,
} from './name';
import { CHARS, META, POOL, REAL_ITEMS, SINGLES } from './data';
import { BOOK_ORDER, type Book, type Opts } from './types';
import { at, one } from '../testing';
import { toSimplified } from './simplified';

const gen = (sur: string, o: Opts, b: number) => plan(sur, o, b).page;

const ALL_BOOKS = Object.fromEntries(BOOK_ORDER.map((b) => [b, true])) as Record<Book, boolean>;
const opts = (p: Partial<Opts> = {}): Opts => ({
  gender: 'any',
  // 这一份夹具默认只看典籍：本文件的多数断言是候选池口径（1,525 条双名、成词层 497 条），
  // 真实人名档另有自己的用例（下面「真实人名档」那一段），混进来会让每个计数都要加一遍。
  source: 'book',
  // 这一份是全池口径的公共夹具：成词门槛关掉，池子才是完整的 1,525 条。
  // 门槛本身另有专门用例（下面的「成词门槛」describe），别在这里顺带测。
  wordOnly: false,
  length: 2,
  books: { ...ALL_BOOKS },
  redupOnly: false,
  exclude: [],
  count: 12,
  search: '',
  title: '',
  sort: 'score',
  strokeMax: 0,
  noMonotone: false,
  popFloor: 0,
  mustChar: '',
  mustPos: 'any',
  avoidChars: '',
  ...p,
});

describe('输入繁体也认（0.20.0 繁简归一）', () => {
  it('姓打繁体：读音查得到，出来的名字仍是简体写法', () => {
    expect(isKnownSurname('蘇'), '查不到读音的话整条音韵链会静默空转').toBe(true);
    const page = gen('蘇', opts(), 0);
    expect(page.length).toBeGreaterThan(0);
    for (const r of page) expect(r.full.startsWith('苏'), r.full).toBe(true);
  });

  it('姓打繁体与打简体，这一池是同一条池（不是两条凑出来的）', () => {
    expect(plan('蘇', opts(), 0).pool).toBe(plan('苏', opts(), 0).pool);
    expect(composeName('蘇', '晚').full).toBe('苏晚');
  });

  it('搜索打繁体与打简体，池内条数相等且不为零', () => {
    const t = poolSize(opts({ search: '雲' }));
    expect(t).toBeGreaterThan(0);
    expect(t).toBe(poolSize(opts({ search: '云' })));
  });

  it('篇名筛选也归一：離騷 与 离骚 是同一篇', () => {
    const t = poolSize(opts({ title: '離騷' }));
    expect(t).toBeGreaterThan(0);
    expect(t).toBe(poolSize(opts({ title: '离骚' })));
  });

  it('指定字打繁体照样限定：東 → 每条名里都有东', () => {
    const got = gen('苏', opts({ mustChar: '東' }), 0);
    expect(got.length).toBeGreaterThan(0);
    for (const r of got) expect(r.name.includes('东'), r.name).toBe(true);
  });

  it('禁用字打繁体照样排除：東 → 名里不许有东', () => {
    const got = gen('苏', opts({ avoidChars: '東' }), 0);
    expect(got.length).toBeGreaterThan(0);
    for (const r of got) expect(r.name.includes('东'), r.name).toBe(false);
  });

  it('一字对多的两个繁体都算同一个禁用字（發／髮 → 发）', () => {
    expect(poolSize(opts({ avoidChars: '發' }))).toBe(poolSize(opts({ avoidChars: '髮' })));
  });

  it('表外的繁体不会变成别的字：搜它得到零条，与今天的口径相同', () => {
    expect(poolSize(opts({ search: 'Δ' }))).toBe(0);
    expect(toSimplified('Δ')).toBe('Δ');
  });
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
    const su = one(readings('苏'), '「苏」的读音表');
    expect(su.syl).toBe('su');
    expect(su.mark).toBe('sū');
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
      ā: 'a',
      ē: 'e',
      ī: 'i',
      ō: 'o',
      ū: 'u',
      ǖ: 'ü',
      á: 'a',
      é: 'e',
      í: 'i',
      ó: 'o',
      ú: 'u',
      ǘ: 'ü',
      ǎ: 'a',
      ě: 'e',
      ǐ: 'i',
      ǒ: 'o',
      ǔ: 'u',
      ǚ: 'ü',
      à: 'a',
      è: 'e',
      ì: 'i',
      ò: 'o',
      ù: 'u',
      ǜ: 'ü',
    };
    for (const [ch, i] of Object.entries(CHARS)) {
      expect(i.py.length, ch).toBe(i.pm.length);
      expect(i.pm.length, ch).toBe(i.t.length);
      expect(i.py.length, ch).toBeGreaterThan(0);
      for (let k = 0; k < i.py.length; k++) {
        const raw = at(i.pm, k, `「${ch}」的带调写法（pm）列表`);
        // 只放过成音节写法（嗯 ǹg、呒 ḿ、欸 ê̄/ế）：它们用了常规拼音字母表之外的字符
        const exotic = [...raw].some((c) => !/[a-züāēīōǖáéíóúǘǎěǐǒǔǚàèìòùǜ]/.test(c));
        if (!exotic) {
          const base = [...raw].map((c) => TONE[c] ?? c).join('');
          expect(base, `${ch} 第 ${k} 条：${raw} 应为 ${i.py[k]}`).toBe(i.py[k]);
        }
        const tn = /[āēīōǖ]/.test(raw)
          ? 1
          : /[áéíóú]/.test(raw)
            ? 2
            : /[ǎěǐǒǔ]/.test(raw)
              ? 3
              : /[àèìòù]/.test(raw)
                ? 4
                : 0;
        if (tn) expect(i.t[k], `${ch} 第 ${k} 条声调与带调写法不符`).toBe(tn);
      }
    }
  });
});

describe('名用字与部首标注', () => {
  it('主池每个字都在 L0 与读音表内（+20「同在名用字表」这条规则的前提）', () => {
    for (const it of POOL) {
      for (const c of it.chars) {
        const facts = CHARS[c];
        expect(facts, `${it.name} 的 ${c} 不在 CHARS`).toBeTruthy();
        // 断言只记录失败、不收窄类型：取 .l0 前按规则对 Record 下标做显式存在性确认
        if (facts === undefined) throw new Error(`用例前提不成立：字表 CHARS 里没有「${c}」`);
        expect(facts.l0, `${it.name} 的 ${c} 不在 L0`).toBe(true);
      }
    }
    for (const s of SINGLES) {
      const facts = CHARS[s.char];
      if (facts === undefined) throw new Error(`用例前提不成立：字表 CHARS 里没有「${s.char}」`);
      expect(facts.l0, s.char).toBe(true);
    }
  });
  it('部首只标康熙五部的字，重复字不重复出标', () => {
    expect(radicalTags('沐杰').length).toBe(2);
    expect(radicalTags('沐沐').length).toBe(1);
    expect(radicalTags('叮咛')).toEqual([]);
  });
});

describe('性别判定：三档互斥（偏男／中性／偏女）', () => {
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
    expect(genderPass(both!, opts({ gender: 'f' }))).toBe(false);
    expect(genderPass(both!, opts({ gender: 'n' }))).toBe(true);
  });
  it('单侧命中但其余字无信号＝疑似；每字同侧＝强', () => {
    const weak = [...POOL]
      .map((p) => p.name)
      .find((n) => {
        const g = genderOf(n);
        return g.side !== 'n' && !g.strong;
      });
    const strong = [...POOL]
      .map((p) => p.name)
      .find((n) => {
        const g = genderOf(n);
        return g.side !== 'n' && g.strong;
      });
    expect(genderOf(weak!).strong).toBe(false);
    expect(genderOf(strong!).strong).toBe(true);
  });
  it('筛选：三档互斥——反向名与中性名都不进偏男/偏女，疑似名留在自己那一档', () => {
    const f = (name: string) => genderOf(name).side === 'f';
    const m = (name: string) => genderOf(name).side === 'm';
    const femName = POOL.find((p) => f(p.name))!;
    const maleName = POOL.find((p) => m(p.name))!;
    expect(genderPass(femName, opts({ gender: 'm' }))).toBe(false);
    expect(genderPass(maleName, opts({ gender: 'f' }))).toBe(false);
    expect(genderPass(maleName, opts({ gender: 'any' }))).toBe(true);
    const weakFem = POOL.find((p) => {
      const g = genderOf(p.name);
      return g.side === 'f' && !g.strong;
    })!;
    expect(genderPass(weakFem, opts({ gender: 'f' }))).toBe(true);
    expect(genderPass(weakFem, opts({ gender: 'm' }))).toBe(false);
    expect(genderPass(weakFem, opts({ gender: 'n' }))).toBe(false);
  });
  it('三档条数之和＝候选池总数，一档不多一条不少（开着成词门槛也成立）', () => {
    for (const wordOnly of [false, true]) {
      const each = (['m', 'n', 'f'] as const).map((g) => poolSize(opts({ gender: g, wordOnly })));
      const total = poolSize(opts({ wordOnly }));
      expect(
        each.reduce((a, b) => a + b, 0),
        `wordOnly=${wordOnly}`,
      ).toBe(total);
    }
    expect(poolSize(opts({ wordOnly: false }))).toBe(META.pool_B);
    // 同一批名字不会同时出现在两档里：任取一条名字，它只落在其中一档
    const sample = POOL.filter((_, i) => i % 37 === 0);
    expect(sample.length).toBeGreaterThan(30);
    for (const it of sample) {
      const hits = (['m', 'n', 'f'] as const).filter((g) => genderPass(it, opts({ gender: g })));
      expect(hits.length, `${it.name} 落在 ${hits.join('/')}`).toBe(1);
    }
  });
  it('titlesForBooks 只列开着的那几本：关掉楚辞，它的篇名不再出现在候选列表里', () => {
    const on = Object.fromEntries(BOOK_ORDER.map((b) => [b, true]));
    const all = titlesForBooks(on);
    expect(all).toContain('离骚');
    const noChuci = titlesForBooks({ ...on, chuci: false });
    expect(noChuci).not.toContain('离骚');
    expect(noChuci.length).toBeLessThan(all.length);
    // 没说关的按开着算（空对象＝全部典籍）
    expect(titlesForBooks({})).toEqual(all);
  });
  it('池子条数就是候选池口径本身，且单名层不受「来源」开关影响（那一层没有真实人名可看）', () => {
    expect(poolSize(opts())).toBe(META.pool_B);
    // 单名层：三种来源取值给同一个池子（这一层没有真实人名可切，开关不该把它清空）
    const one = (['all', 'book', 'real'] as const).map((source) =>
      poolSize(opts({ length: 1, source, wordOnly: false })),
    );
    expect(one[0]).toBeGreaterThan(0);
    expect(one).toEqual([one[0], one[0], one[0]]);
    // 双名层：这一开关真有作用，两个来源互不重叠、加起来就是全部
    const books = poolSize(opts({ source: 'book', wordOnly: false }));
    const real = poolSize(opts({ source: 'real' }));
    expect(books).toBe(META.pool_B);
    expect(real).toBe(META.real_tier);
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
    const single = one(gen('苏', opts({ length: 1 }), 0), '单名首页结果');
    expect(single.name.length).toBe(1);
    expect(single.deltas.some((d) => d.rule.includes('两字'))).toBe(false);
  });
  it('无姓时不伪造姓氏：全名＝名字本身，读音只含名字的字', () => {
    const it = one(POOL, '主池 POOL 的首条');
    const r = scoreItem('', it, opts(), 0);
    expect(r.full).toBe(it.name);
    expect(r.readings.length).toBe([...it.name].length);
  });
  it('音韵规则真在跑：三字同声调 / 双声 / 叠韵 / 谐音至少各有可命中的样本', () => {
    const rules = new Set<string>();
    for (const sur of ['苏', '林', '江', '周', '张']) {
      for (const it of POOL)
        for (const d of scoreItem(sur, it, opts(), 0).deltas) {
          // 规则名可能被「（…」或「「…」截尾，逐级切出的首段也必须确实在
          const head = one(d.rule.split('（'), '规则文案按「（」切出的首段');
          rules.add(one(head.split('「'), `「${head}」按「「」切出的首段`));
        }
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
    it(
      `每批 ${count} 条：翻满 plan().pages 页不重不漏覆盖全池`,
      () => {
        const o = opts({ count });
        for (const sur of ['苏', '欧阳']) {
          const { p0, seen, uniq } = sweep(o, sur);
          expect(p0.pool).toBe(poolSize(o));
          expect(uniq.size).toBe(p0.pool);
          expect(seen.length).toBe(p0.pool);
        }
      },
      SWEEP_TIMEOUT,
    );
  }
  it(
    '首页同书不超过 4 条（否则一屏全被宋词占满）；尾部只剩一本书时由补位轮装满',
    () => {
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
    },
    SWEEP_TIMEOUT,
  );
  it(
    '页码回绕：翻过最后一页回到第 1 页，不会翻出空白',
    () => {
      const o = opts({ count: 12 });
      const { p0 } = sweep(o, '苏');
      expect(plan('苏', o, p0.pages).page.map((r) => r.id)).toEqual(p0.page.map((r) => r.id));
      expect(plan('苏', o, p0.pages + 1).pageNo).toBe(1);
    },
    SWEEP_TIMEOUT,
  );
  it('打分确定：同输入两次结果逐条一致，换一个条件就重算', () => {
    const base = opts({ count: 12 });
    const p1 = plan('苏', base, 0).page.map((r) => r.id);
    const fem = plan('苏', opts({ count: 12, gender: 'f' }), 0).page.map((r) => r.id);
    expect(fem).not.toEqual(p1);
    const otherSur = plan('林', base, 0).page.map((r) => r.id);
    expect(otherSur).not.toEqual(p1);
    expect(plan('苏', base, 0).page.map((r) => r.id)).toEqual(p1);
    const first = one(p1, '默认批第 1 页的 id 列表');
    const blocked = plan('苏', opts({ count: 12, exclude: [first] }), 0).page.map((r) => r.id);
    expect(blocked).not.toContain(first);
    expect(plan('苏', base, 0).page.map((r) => r.id)).toEqual(p1);
  });
  it('典籍全关＝空池，plan 不炸且页数 0', () => {
    const none = opts({ books: Object.fromEntries(BOOK_ORDER.map((b) => [b, false])) as Record<Book, boolean> });
    const p = plan('苏', none, 3);
    expect(p).toEqual({ page: [], pageNo: 0, pages: 0, pool: 0, titleCounts: new Map() });
  });
  it('「同篇还有 N 条」按当前筛选算：禁用字把某篇削掉之后，篇名按钮上的数跟着变小', () => {
    const plain = plan('苏', opts({}), 0);
    const avoid = plan('苏', opts({ avoidChars: '月' }), 0);
    let narrowed = 0;
    for (const [k, n] of plain.titleCounts) {
      const now = avoid.titleCounts.get(k) ?? 0;
      expect(now, '当前口径下的篇内条数不该比不设筛选时多').toBeLessThanOrEqual(n);
      if (now < n) narrowed++;
    }
    expect(narrowed, '禁用「月」之后至少有一篇的条数变小').toBeGreaterThan(0);
    // 篇内计数与候选池用的是同一份集合：各篇加起来就是池子的大小
    const sum = [...avoid.titleCounts.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(avoid.pool);
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
    const item = POOL.find((p) =>
      p.chars.some((c) => {
        const facts = CHARS[c];
        if (facts === undefined) throw new Error(`用例前提不成立：字表 CHARS 里没有「${c}」`);
        return (facts.pm?.length ?? 0) > 1;
      }),
    );
    expect(item, '池内应有多音字样本').toBeTruthy();
    const poly = polyphoneTags(item!.name);
    expect(poly.length).toBeGreaterThan(0);
    for (const p of poly) {
      const facts = CHARS[p.ch];
      if (facts === undefined) throw new Error(`用例前提不成立：多音标记里的「${p.ch}」不在字表 CHARS`);
      expect(facts.pm.length).toBeGreaterThan(1);
    }
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
    const it = one(POOL, '主池 POOL 的首条');
    const py = namePinyin(it.name);
    expect(py).toBe([...it.name].map((c) => one(readings(c), `「${c}」的读音表`).syl).join(''));
    expect(py).toMatch(/^[a-z]+$/);
    const t = searchText(it);
    expect(t).toContain(it.name);
    expect(t).toContain(py);
    expect(t).toContain(it.title.toLowerCase());
  });
});

describe('出处今译', () => {
  it('每条出处的今译要么非空、要么是明确的 -1（待补），且同一句共用一个下标', () => {
    let pending = 0;
    for (const it of [...POOL, ...SINGLES]) {
      expect(Number.isInteger(it.lg)).toBe(true);
      if (it.lg === -1) {
        pending += 1; // 界面与导出在这里显示「今译待补」，逐句清单在 docs/gloss-gaps.md
        continue;
      }
      expect(lineGlossOf(it).length).toBeGreaterThan(0);
    }
    expect(pending / (POOL.length + SINGLES.length), '待补占比不得超过两成').toBeLessThan(0.2);
    const byLine = new Map<string, number>();
    const gapLines = new Set<string>();
    for (const it of [...POOL, ...SINGLES]) {
      if (it.lg === -1) {
        gapLines.add(it.line);
        continue;
      }
      if (byLine.has(it.line)) expect(it.lg).toBe(byLine.get(it.line));
      else byLine.set(it.line, it.lg);
    }
    expect(byLine.size).toBe(META.gloss_lines_primary); // 主出处用到的那批：一句一条、共用下标（别处出处的今译在 gloss_lines 总数里）
    expect(gapLines.size).toBe(META.gloss_gap_lines); // 待补的那批：句数与 meta 记的一致
  });
  it('抽一条核对句意（灵均）', () => {
    const hit = POOL.find((p) => p.name === '灵均')!;
    expect(lineGlossOf(hit)).toBe('父亲审视我初生时的器度，开始赐我美名：给我取名叫正则，取字叫灵均。');
  });
  it('越界下标返回空串而不是 undefined（界面按留白处理）', () => {
    expect(lineGlossOf({ lg: 99999 })).toBe('');
  });
});

describe('自选组合：只查事实，不套池内分数', () => {
  it('有出处的组合能精确查到，出处字段与池内条目一致', () => {
    const hit = findCombo('子归');
    expect(hit).not.toBeNull();
    expect(hit!.book).toBe('shijing');
    expect(hit!.line).toContain('之子归');
    expect(hit!.lg).toBeGreaterThanOrEqual(0);
  });
  it('单字名走 singles 查出处', () => {
    const hit = findCombo('子');
    expect(hit).not.toBeNull();
    expect('char' in hit! ? hit!.char : '').toBe('子');
  });
  it('无出处的组合返回 null，不拿别的句子凑', () => {
    expect(findCombo('龙凤')).toBeNull();
  });
  it('composeName 给读音与标记；非白名单字 known 仍为 true 但 allL0 为 false', () => {
    const a = composeName('苏', '子归');
    expect(a.readings).toEqual(['sū', 'zǐ', 'guī']);
    expect(a.allL0).toBe(true);
    expect(a.known).toBe(true);
    const b = composeName('苏', '龙凤');
    expect(b.allL0).toBe(true);
    const c = composeName('苏', '龘');
    expect(c.known).toBe(false);
    expect(c.allL0).toBe(false);
    expect(c.readings).toEqual([]);
  });
  it('搭配字：同一句读里与「子」配过的字，按分数降序且不重复', () => {
    const hits = pairCandidates('子');
    expect(hits.length).toBeGreaterThan(10);
    const chs = hits.map((h) => h.ch);
    expect(new Set(chs).size).toBe(chs.length);
    expect(chs).toContain('归');
    for (let i = 1; i < hits.length; i++)
      expect(at(hits, i - 1, '「子」的搭配候选（按分数降序）').score).toBeGreaterThanOrEqual(
        at(hits, i, '「子」的搭配候选（按分数降序）').score,
      );
    // 反向也要成立：每个搭配字回查时都能找到「子」
    expect(pairCandidates('归').some((h) => h.ch === '子')).toBe(true);
  });
  it('名用字表 293 字，与 meta 对得上', () => {
    expect(L0_CHARS).toHaveLength(META.L0_size);
    expect(L0_CHARS).toContain('子');
  });
  it('charFacts 给出字义/结构/笔画/常见度/读音，未知字留白', () => {
    const a = charFacts('子');
    expect(a.known).toBe(true);
    expect(a.l0).toBe(true);
    expect(a.gloss).toBe('婴儿');
    expect(a.reads).toContain('zǐ');
    const b = charFacts('龘');
    expect(b.known).toBe(false);
    expect(b.l0).toBe(false);
    expect(b.gloss).toBeNull();
    expect(b.reads).toEqual([]);
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
  it('多本典籍分页时「按笔画排」也真是笔画序：分页不许再用同书上限牵制它', () => {
    const strokesOf = (name: string) =>
      [...name].reduce((a, ch) => {
        const facts = CHARS[ch];
        if (facts === undefined) throw new Error(`用例前提不成立：字表 CHARS 里没有「${ch}」`);
        return a + (facts.st ?? 0);
      }, 0);
    const o = opts({ count: 12, sort: 'strokes' });
    const page = plan('苏', o, 0).page;
    expect(page.length).toBe(12);
    const st = page.map((r) => strokesOf(r.name));
    for (let i = 1; i < st.length; i++)
      expect(at(st, i, '按笔画排序的笔画数序列')).toBeGreaterThanOrEqual(at(st, i - 1, '按笔画排序的笔画数序列'));
  });
  it('按笔画排序时结果笔画单调不减；按常见度排序时单调不增', () => {
    // 单本典籍、一屏全展开：绕开分页的「同书每页≤4」跨书交织，直接看排序键
    const only = (sort: Opts['sort']): Opts =>
      opts({
        count: 0,
        sort,
        books: Object.fromEntries(BOOK_ORDER.map((b) => [b, b === 'daofa'])) as Record<Book, boolean>,
      });
    const strokesOf = (name: string) =>
      [...name].reduce((a, ch) => {
        const facts = CHARS[ch];
        if (facts === undefined) throw new Error(`用例前提不成立：字表 CHARS 里没有「${ch}」`);
        return a + (facts.st ?? 0);
      }, 0);
    const byStroke = plan('苏', only('strokes'), 0).page.map((r) => strokesOf(r.name));
    expect(byStroke.length).toBeGreaterThan(4);
    for (let i = 1; i < byStroke.length; i++)
      expect(at(byStroke, i, '按笔画排序的笔画数序列')).toBeGreaterThanOrEqual(
        at(byStroke, i - 1, '按笔画排序的笔画数序列'),
      );
    const byPop = plan('苏', only('popular'), 0).page.map((r) => popScore(r.name));
    for (let i = 1; i < byPop.length; i++)
      expect(at(byPop, i, '按常见度排序的分值序列')).toBeLessThanOrEqual(at(byPop, i - 1, '按常见度排序的分值序列'));
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
    const only = opts({
      books: Object.fromEntries(BOOK_ORDER.map((b) => [b, b === 'daofa'])) as Record<Book, boolean>,
    });
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

describe('指定用字（mustChar / mustPos）', () => {
  const mc = '清';
  it('不限位置：池子只留名字含该字的搭配，条数与池内实况一致', () => {
    const n = poolSize(opts({ mustChar: mc }));
    expect(n).toBe(POOL.filter((p) => p.name.includes(mc)).length);
    expect(n).toBeGreaterThan(0);
    for (const r of plan('苏', opts({ mustChar: mc, count: 0 }), 0).page) expect(r.name).toContain(mc);
  });
  it('首字 / 末字：位置各自精确', () => {
    expect(poolSize(opts({ mustChar: mc, mustPos: 'first' }))).toBe(POOL.filter((p) => p.name[0] === mc).length);
    expect(poolSize(opts({ mustChar: mc, mustPos: 'last' }))).toBe(POOL.filter((p) => p.name[1] === mc).length);
    for (const r of plan('苏', opts({ mustChar: mc, mustPos: 'first', count: 0 }), 0).page) expect(r.name[0]).toBe(mc);
    for (const r of plan('苏', opts({ mustChar: mc, mustPos: 'last', count: 0 }), 0).page) expect(r.name[1]).toBe(mc);
  });
  it('单名模式：指定字就是该字本身（有对齐出处才在池）', () => {
    expect(poolSize(opts({ length: 1, mustChar: mc }))).toBe(SINGLES.filter((s) => s.char === mc).length);
    expect(poolSize(opts({ length: 1, mustChar: mc, mustPos: 'first' }))).toBe(
      SINGLES.filter((s) => s.char === mc).length,
    );
  });
  it('字不在名用字表时结果为 0——那是事实，不硬凑', () => {
    expect(poolSize(opts({ mustChar: '龘' }))).toBe(0);
  });
  it('指定字与其它筛选是交集，不会互相覆盖', () => {
    const both = poolSize(opts({ mustChar: mc, search: 'qing' }));
    expect(both).toBeLessThanOrEqual(poolSize(opts({ mustChar: mc })));
    expect(both).toBeGreaterThan(0);
    for (const r of plan('苏', opts({ mustChar: mc, search: 'qing', count: 0 }), 0).page) {
      expect(r.name).toContain(mc);
      expect(searchText(r).toLowerCase()).toContain('qing');
    }
  });
});

describe('禁用字（避讳字）', () => {
  const av = '月';
  it('avoidPass：空串放行，名里命中任意一个禁用字就整条排除', () => {
    expect(avoidPass('清风', opts({ avoidChars: '' }))).toBe(true);
    expect(avoidPass('清风', opts({ avoidChars: '风' }))).toBe(false);
    expect(avoidPass('明月', opts({ avoidChars: '风光' }))).toBe(true);
    expect(avoidPass('月风', opts({ avoidChars: '风光' }))).toBe(false);
  });
  it('池子精确扣掉名里含禁用字的搭配；重复字不重复扣', () => {
    const n = poolSize(opts({ avoidChars: av }));
    expect(n).toBe(POOL.filter((p) => !p.name.includes(av)).length);
    expect(n).toBeLessThan(poolSize(opts()));
    expect(n).toBeGreaterThan(0);
    expect(poolSize(opts({ avoidChars: av + av }))).toBe(n);
  });
  it('结果页里没有一条名含禁用字，翻满全页也不漏', () => {
    const p = plan('苏', opts({ avoidChars: av, count: 24 }), 0);
    const seen = new Set<string>();
    for (let b = 0; b < p.pages; b++) {
      for (const r of plan('苏', opts({ avoidChars: av, count: 24 }), b).page) {
        expect(r.name).not.toContain(av);
        seen.add(r.id);
      }
    }
    expect(seen.size).toBe(poolSize(opts({ avoidChars: av })));
  });
  it('只查名不查姓：姓自己带禁用字，池子和结果都不受影响', () => {
    expect(poolSize(opts({ avoidChars: '柳' }))).toBe(POOL.filter((p) => !p.name.includes('柳')).length);
    const page = plan('柳', opts({ avoidChars: '柳', count: 24 }), 0).page;
    expect(page.length).toBeGreaterThan(0);
    for (const r of page) {
      expect(r.name).not.toContain('柳');
      expect(r.full.startsWith('柳')).toBe(true);
    }
  });
  it('单名模式：单名就是那一个字，禁用即排除', () => {
    expect(poolSize(opts({ length: 1, avoidChars: av }))).toBe(SINGLES.filter((s) => s.char !== av).length);
    expect(poolSize(opts({ length: 1, avoidChars: av }))).toBeLessThan(poolSize(opts({ length: 1 })));
  });
  it('指定字与禁用字矛盾时结果为 0——那是事实，不硬凑', () => {
    expect(poolSize(opts({ mustChar: av, avoidChars: av }))).toBe(0);
    expect(plan('苏', opts({ mustChar: av, avoidChars: av }), 0).page).toHaveLength(0);
  });
  it('与性别、笔画是交集：禁用字只收窄，不放宽', () => {
    const base = poolSize(opts({ gender: 'f' }));
    const both = poolSize(opts({ gender: 'f', avoidChars: av }));
    expect(both).toBeLessThanOrEqual(base);
    expect(both).toBeGreaterThan(0);
    expect(poolSize(opts({ strokeMax: 40, avoidChars: av }))).toBeLessThanOrEqual(poolSize(opts({ strokeMax: 40 })));
  });
});

describe('成词门槛：默认只给「典籍里本来就挨着的」名字（用户反馈：名字像硬凑）', () => {
  const noEvidence = (it: (typeof POOL)[number]) => (it.a ?? 0) < 2 && (it.w ?? 0) === 0 && !it.redup;
  it('门槛开着＝池子只剩成词层，条数与 meta 记的数一致；门槛关着＝全池', () => {
    expect(poolSize(opts({ wordOnly: true }))).toBe(META.pool_word);
    expect(poolSize(opts({ wordOnly: false }))).toBe(META.pool_B);
    expect(META.pool_word + META.pool_no_evidence).toBe(META.pool_B);
    expect(META.pool_word).toBeGreaterThan(400); // 门槛不能把池子砍到没得挑
  });
  it('留下的每条都真有证据，挡掉的每条都真没证据', () => {
    const sample = POOL.filter((_, i) => i % 19 === 0);
    expect(sample.length).toBeGreaterThan(50);
    for (const it of sample) {
      const ev = wordEvidence(it);
      expect(wordPass(it, opts({ wordOnly: true })), `${it.name} ${ev.tier}`).toBe(ev.tier !== 'none');
      if (ev.tier === 'attested') expect(it.a ?? 0).toBeGreaterThanOrEqual(2);
      if (ev.tier === 'modern') expect(it.w ?? 0).toBeGreaterThan(0);
      if (ev.tier === 'none') expect(noEvidence(it)).toBe(true);
    }
    expect(sample.filter((it) => wordEvidence(it).tier === 'none').length).toBeGreaterThan(10);
  });
  it('拆词标记只发生在跨字取词上，并在分数明细里单独扣 10 分、写清被剪开的是哪个词', () => {
    const split = POOL.filter((it) => it.spl);
    expect(split.length).toBe(META.pool_split);
    expect(split.every((it) => it.gap >= 2)).toBe(true);
    const it = one(split, '池内应有被剪开原词的条目');
    const r = scoreItem('袁', it, opts({ wordOnly: false }), 0);
    const d = r.deltas.find((x) => x.rule.startsWith('拆词'));
    expect(d, `拆词扣分应在明细里（${r.deltas.map((x) => x.rule).join(' | ')}）`).toBeTruthy();
    expect(d?.delta).toBe(-10);
    expect(d?.rule).toContain(it.spl as string);
  });
  it('成词加分按语料内复现次数分三档，无依据扣分', () => {
    expect(wordBonus({ tier: 'attested', a: 2, w: 0, spl: '', why: '' })).toBe(6);
    expect(wordBonus({ tier: 'attested', a: 10, w: 0, spl: '', why: '' })).toBe(9);
    expect(wordBonus({ tier: 'attested', a: 30, w: 0, spl: '', why: '' })).toBe(12);
    expect(wordBonus({ tier: 'modern', a: 0, w: 7, spl: '', why: '' })).toBe(2);
    expect(wordBonus({ tier: 'redup', a: 0, w: 0, spl: '', why: '' })).toBe(0);
    expect(wordBonus({ tier: 'none', a: 0, w: 0, spl: '', why: '' })).toBe(-6);
    const rare = POOL.find((it) => (it.a ?? 0) === 2 && !it.spl);
    const common = POOL.find((it) => (it.a ?? 0) >= 30 && !it.spl);
    expect(rare, '池内应有只出现两次的成词名').toBeTruthy();
    expect(common, '池内应有语料里反复出现的成词名').toBeTruthy();
    const dr = scoreItem('袁', rare!, opts({ wordOnly: false }), 0).deltas.find((d) => d.rule.startsWith('成词'));
    const dc = scoreItem('袁', common!, opts({ wordOnly: false }), 0).deltas.find((d) => d.rule.startsWith('成词'));
    expect(dc!.delta).toBeGreaterThan(dr!.delta);
    const bad = POOL.find((it) => noEvidence(it) && !it.spl);
    const b = scoreItem('袁', bad!, opts({ wordOnly: false }), 0).deltas.find((d) => d.rule.startsWith('未见成词依据'));
    expect(b?.delta).toBe(-6);
  });
  it('成词多的名字在默认结果里排在前面（第一页要放有依据的名字）', () => {
    const all = plan('袁', opts({ wordOnly: true, count: 0 }), 0, 0).page;
    const top = [...all].sort((x, y) => y.total - x.total).slice(0, 12);
    expect(top.every((r) => wordEvidence(r as never).tier === 'attested')).toBe(true);
    const as = top.map((r) => (r as unknown as { a?: number }).a ?? 0);
    expect(as.filter((a) => a >= 10).length, `前 12 条里的语料复现次数：${as.join(',')}`).toBeGreaterThanOrEqual(3);
  });
  it('单名层不受成词门槛影响（单字谈不上成词）', () => {
    const o = opts({ length: 1, wordOnly: true });
    expect(poolSize(o)).toBe(poolSize(opts({ length: 1, wordOnly: false })));
    expect(wordEvidence({ char: '东' }).tier).toBe('single');
  });
});

describe('名句层 famous：跨全池的单一阈值（换成可复核的判据）', () => {
  const T = META.famous_threshold;
  it('阈值是一个单一数，严于成词门槛 a ≥ 2，命中数既不能退化也不能人手一份', () => {
    expect(Number.isInteger(T), `阈值要是整数（现 ${T}）`).toBe(true);
    expect(T, '阈值必须严于成词门槛，否则名句分与成词分是同一件事').toBeGreaterThanOrEqual(3);
    expect(POOL.filter((it) => it.famous).length).toBe(META.pool_famous);
    expect(META.pool_famous, '旧判据（每本书取词段复现 ≥ 2）只命中 58 条，新判据必须明显多于它').toBeGreaterThan(58);
    expect(META.pool_famous, '名句层不许宽到人手一份').toBeLessThan(POOL.length * 0.2);
    expect(META.singles_famous).toBe(SINGLES.filter((s) => s.famous).length);
  });
  it('逐条对齐：a ≥ 阈值才有这一分，一条都对不上就红', () => {
    const bad = POOL.filter((it) => it.famous !== (it.a ?? 0) >= T);
    expect(
      bad.map((it) => `${it.name} a=${it.a ?? 0} famous=${it.famous}`).slice(0, 5),
      '逐条 famous 与 a 不一致',
    ).toEqual([]);
    const none = POOL.filter((it) => (it.a ?? 0) === 0);
    expect(none.length, '池内该有从没挨着的拼字').toBeGreaterThan(0);
    expect(none.filter((it) => it.famous).length, '从没挨着的拼字不该有名句分').toBe(0);
  });
  it('明月、君子这一类典籍里反复出现的词必须有这一分（旧判据给不出）', () => {
    for (const n of ['明月', '君子', '依依', '昊天']) {
      const it = POOL.find((p) => p.name === n);
      expect(it, `池内应有「${n}」`).toBeTruthy();
      expect(it?.famous, `「${n}」相邻出现 ${it?.a ?? 0} 次，阈值 ${T}，该有名句分`).toBe(true);
    }
  });
  it('分数明细那一行说的是新判据，不再写「本书名句层」', () => {
    const it = one(
      POOL.filter((p) => p.famous),
      '带名句分的条目',
    );
    const row = one(
      scoreItem('苏', it, opts({ wordOnly: false }), 0).deltas.filter((x) => x.rule.includes('名句层')),
      '明细里的名句层那一行',
    );
    expect(row.delta).toBe(8);
    expect(row.rule, row.rule).toContain('反复出现');
    expect(row.rule, row.rule).not.toContain('本书');
  });
  it('单字名继承它那条出处的判定：出处带分它才带分', () => {
    const famous = new Map(POOL.map((p) => [p.name, p.famous]));
    const bad = SINGLES.filter((s) => !!s.famous !== !!famous.get(s.from)).map((s) => `${s.char}←${s.from}`);
    expect(bad.slice(0, 5), '单字名与出处的名句判定不一致').toEqual([]);
  });
});
describe('真实用名证据（120 万条真实姓名语料）', () => {
  it('字表没有信号时由真实语料补档，补出来的档仍是互斥三档之一', () => {
    const noSignal = (n: string) => genderOf(n).why === '用字不在性别风格字表内';
    const resolved = POOL.filter((it) => (it.rs === 'm' || it.rs === 'f') && noSignal(it.name));
    expect(resolved.length, '池内应有「字表无信号、真实语料有标注」的名字').toBeGreaterThan(50);
    expect(resolved.length).toBe(META.pool_real_resolved);
    for (const it of resolved.slice(0, 8)) {
      const tag = genderOf(it.name, { n: it.rn, side: it.rs });
      expect(tag.side).toBe(it.rs);
      expect(tag.why).toContain('真实姓名语料');
    }
    const sides = (['m', 'f', 'n'] as const).map(
      (g) => POOL.filter((it) => genderOf(it.name, { n: it.rn, side: it.rs }).side === g).length,
    );
    expect(at(sides, 0, '偏男档计数')).toBeGreaterThan(0);
    expect(at(sides, 1, '偏女档计数')).toBeGreaterThan(0);
    expect(
      at(sides, 0, '偏男档计数') + at(sides, 1, '偏女档计数') + at(sides, 2, '中性档计数'),
      '补档后三档之和必须仍等于全池',
    ).toBe(POOL.length);
  });
  it('真实用名加分分两档，次数少的只说明不加分，没记录的一分不扣', () => {
    const many = one(
      POOL.filter((it) => (it.rn ?? 0) >= 50),
      '池内应有语料里多人用过的名字',
    );
    const mid = one(
      POOL.filter((it) => (it.rn ?? 0) >= 10 && (it.rn ?? 0) < 50),
      '池内应有语料里十来个人用过的名字',
    );
    const few = one(
      POOL.filter((it) => (it.rn ?? 0) >= 2 && (it.rn ?? 0) < 10),
      '池内应有语料里只有几次记录的名字',
    );
    const none = one(
      POOL.filter((it) => !it.rn),
      '池内应有语料里没有记录的名字',
    );
    const d = (it: (typeof POOL)[number]) =>
      scoreItem('袁', it, opts({ wordOnly: false }), 0).deltas.find((x) => x.rule.startsWith('真实用名'));
    expect(d(many)?.delta).toBe(4);
    expect(d(mid)?.delta).toBe(2);
    expect(d(few)?.delta).toBe(0);
    expect(d(few)?.rule).toContain('次数少');
    expect(d(none), '没记录不该出现扣分项').toBeUndefined();
  });
  it('两条证据不一致时记在 conflict 里，名字归属跟着性别风格字表不动', () => {
    const it = one(
      POOL.filter((p) => p.rs && genderOf(p.name).side !== 'n' && genderOf(p.name).side !== p.rs),
      '池内应有两条证据不一致的名字',
    );
    const tag = genderOf(it.name, { n: it.rn, side: it.rs });
    expect(tag.side).toBe(genderOf(it.name).side);
    expect(tag.conflict).toContain('真实姓名语料');
  });
  it('meta 的真实用名计数与池内实况一致', () => {
    expect(POOL.filter((it) => it.rn).length).toBe(META.pool_real_named);
    expect(POOL.filter((it) => it.rs === 'm').length).toBe(META.pool_real_side_m);
    expect(POOL.filter((it) => it.rs === 'f').length).toBe(META.pool_real_side_f);
  });
});
describe('筛选与卡片必须同一套证据', () => {
  it('任一性别档下的每一条结果，卡片上的档就是那一档（真实语料补的档也算）', () => {
    for (const side of ['m', 'f', 'n'] as const) {
      const all = plan('袁', opts({ gender: side, wordOnly: false, count: 0 }), 0, 0).page;
      expect(all.length, `${side} 档不该筛空`).toBeGreaterThan(0);
      const wrong = all.filter((r) => r.gender.side !== side);
      expect(wrong.map((r) => `${r.name}:${r.gender.side}`).slice(0, 5), '结果里出现了别的档').toEqual([]);
    }
  });
});
describe('真实人名档（第二个来源）', () => {
  const all = opts({ wordOnly: false, source: 'all' });
  const realOnly = opts({ wordOnly: false, source: 'real' });
  const bookOnly = opts({ wordOnly: false, source: 'book' });

  it('默认两个来源都看：条数＝典籍全池＋真实人名档，两个来源之间不重名', () => {
    expect(REAL_ITEMS.length).toBe(META.real_tier);
    expect(poolSize(all)).toBe(META.pool_B + META.real_tier);
    expect(poolSize(bookOnly)).toBe(META.pool_B);
    expect(poolSize(realOnly)).toBe(META.real_tier);
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const it of [...POOL, ...REAL_ITEMS]) {
      if (seen.has(it.name)) dup.push(it.name);
      seen.add(it.name);
    }
    expect(dup.slice(0, 5), '名字必须全局唯一').toEqual([]);
  });

  it('真实人名档不写成词门槛的受害者：门槛开着它也整档在，典籍那一半照旧被门槛管', () => {
    const gated = opts({ wordOnly: true, source: 'real' });
    const gatedBooks = opts({ wordOnly: true, source: 'book' });
    expect(poolSize(gated)).toBe(META.real_tier);
    expect(poolSize(gatedBooks)).toBe(META.pool_word);
  });

  it('这一档只有双名：切到单名层时它一条也没有', () => {
    expect(poolSize(opts({ length: 1, source: 'all', wordOnly: false }))).toBe(META.singles);
  });

  it('「只看叠字」不再整档屏蔽真实人名：真叠字名留下，非叠字名照旧不给', () => {
    const o = opts({ redupOnly: true, source: 'all', wordOnly: false, count: 0 });
    const pool = plan('苏', o, 0).page;
    const reduplex = REAL_ITEMS.filter((it) => isReduplexName(it.name));
    const plain = REAL_ITEMS.filter((it) => !isReduplexName(it.name));
    expect(reduplex.length, '真实人名档里的真叠字名（婷婷 丹丹 晶晶 这一类）要有量').toBeGreaterThan(100);
    const realSeen = new Set(pool.filter((r) => r.book === 'real').map((r) => r.name));
    expect([...realSeen].sort(), '真实人名档在这一开关下只剩真叠字名，一条不多一条不少').toEqual(
      reduplex.map((it) => it.name).sort(),
    );
    for (const n of ['婷婷', '丹丹', '晶晶']) expect(realSeen.has(n), `${n} 必须看得见`).toBe(true);
    const leaked = plain.filter((it) => realSeen.has(it.name)).map((it) => it.name);
    expect(leaked.slice(0, 5), '非叠字的真实人名一条都不该进这一档').toEqual([]);
    for (const r of pool) expect(isReduplexName(r.name), `${r.name} 不是叠字名`).toBe(true);
    // 典籍那一半的行为不变：开关照旧按构建期的叠字标记筛
    const corpusRedup = POOL.filter((p) => p.redup).length;
    expect(pool.filter((r) => r.book !== 'real').length).toBe(corpusRedup);
    expect(poolSize(o)).toBe(corpusRedup + reduplex.length);
    // 成词门槛开着（界面默认那一档）时也一样：这一档的叠字名不该被开关整档带走
    expect(poolSize(opts({ redupOnly: true, source: 'all' })), '默认门槛下这一档仍留着叠字名').toBe(
      corpusRedup + reduplex.length,
    );
  });

  it('三档互斥在两个来源合起来的那份池子上同样成立', () => {
    const sum = (['m', 'f', 'n'] as const).map((g) => poolSize(opts({ wordOnly: false, source: 'all', gender: g })));
    expect(
      at(sum, 0, '偏男档') + at(sum, 1, '偏女档') + at(sum, 2, '中性档'),
      '两个来源合起来的三档之和必须等于池子',
    ).toBe(META.pool_B + META.real_tier);
    for (const side of ['m', 'f', 'n'] as const) {
      const page = plan('袁', opts({ gender: side, wordOnly: false, count: 0 }), 0, 0).page;
      expect(
        page
          .filter((r) => r.gender.side !== side)
          .map((r) => `${r.name}:${r.gender.side}`)
          .slice(0, 5),
      ).toEqual([]);
    }
  });

  it('真实人名的条目没有出处字段，id 以 RN_ 打头，能被 findItem 找回来（收藏靠它）', () => {
    const it = one(REAL_ITEMS, '真实人名档首条');
    expect(it.book).toBe('real');
    expect(it.line).toBe('');
    expect(it.title).toBe('');
    expect(it.lg).toBe(-1);
    expect(it.id.startsWith('RN_')).toBe(true);
    expect(findItem(it.id)?.name).toBe(it.name);
    expect(it.rn).toBeGreaterThanOrEqual(40);
  });

  it('卡片上的分数明细里不出现成词与拆词那两行，但出现真实用名那一行', () => {
    const it = one(
      REAL_ITEMS.filter((x) => (x.rn ?? 0) >= 50),
      '语料里多人用过的真实人名',
    );
    const r = scoreItem('袁', it, opts({ wordOnly: false }), 0);
    expect(r.deltas.some((d) => d.rule.startsWith('成词') || d.rule.startsWith('未见成词依据'))).toBe(false);
    expect(r.deltas.some((d) => d.rule.startsWith('真实用名'))).toBe(true);
    expect(r.deltas.some((d) => d.rule.includes('名用字表 L0'))).toBe(true);
  });

  it('篇名筛选与「同篇还有几条」不管这一档：它没有篇名', () => {
    expect(POOL_TITLES.length).toBeGreaterThan(10);
    const titles = plan('袁', opts({ wordOnly: false, source: 'real', title: '小明' }), 0, 0).page;
    expect(titles.length).toBe(0);
  });
});
