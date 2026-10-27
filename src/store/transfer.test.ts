import { describe, expect, it } from 'vitest';
import { buildState, fromQuery, parseState, serialize, toQuery } from './transfer';
import { sanitizeOpts, type FavRecord } from './local';
import { BOOK_ORDER, type Opts } from '../engine/types';
import { at } from '../testing';

const baseOpts = (): Opts => sanitizeOpts({});

describe('导入解析', () => {
  it('导出→解析 往返一致（含收藏里的名字快照）', () => {
    const fav: FavRecord[] = [
      {
        id: 'x',
        note: '喜欢',
        group: '女',
        ts: 1,
        name: '清婉',
        book: 'shijing',
        title: '野有死麕',
        line: '野有死麕，白茅包之',
      },
    ];
    const st = buildState({ surname: '苏', reading: 1, opts: baseOpts(), favorites: fav, blocklist: ['y'] });
    const res = parseState(serialize(st));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.surname).toBe('苏');
    expect(res.state.reading).toBe(1);
    expect(res.state.favorites[0]).toEqual(fav[0]);
    expect(res.state.blocklist).toEqual(['y']);
  });
  it('失败分三种：读不出 JSON / 不是本应用的文件 / 没有可导入的东西', () => {
    expect(parseState('not json')).toEqual({ ok: false, error: 'json' });
    expect(parseState('[1,2,3]')).toEqual({ ok: false, error: 'json' });
    expect(parseState('null')).toEqual({ ok: false, error: 'json' });
    expect(parseState('{"foo":1}')).toEqual({ ok: false, error: 'foreign' });
    expect(parseState('{"app":"other","favorites":[{"id":"x"}]}')).toEqual({ ok: false, error: 'foreign' });
    expect(parseState('{"app":"naming-app","favorites":[]}')).toEqual({ ok: false, error: 'empty' });
    // 只有设置也算有东西可导入
    expect(parseState('{"surname":"苏"}').ok).toBe(true);
  });
  it('收藏逐条消毒：旧格式、超长字段、未知典籍、坏时间戳都被收敛', () => {
    const raw = {
      app: 'naming-app',
      favorites: [
        'bare',
        {
          id: 'x',
          note: '长'.repeat(300),
          group: '组'.repeat(60),
          name: '名'.repeat(40),
          title: '篇'.repeat(50),
          line: '句'.repeat(300),
        },
        { id: 'x', note: '重复 id 应被丢掉' },
        { id: 'y', book: 'baidu' as never, ts: 'not-number' as never },
        { id: '' },
        { id: 42 },
        null,
      ],
      blocklist: ['a', 'a', '', 7 as never, 'b'.repeat(200)],
    };
    const res = parseState(JSON.stringify(raw));
    if (!res.ok) throw new Error('should be ok');
    expect(res.state.favorites.map((f) => f.id)).toEqual(['bare', 'x', 'y']);
    expect(res.state.favorites[0]).toEqual({ id: 'bare', ts: 0 });
    // 第 2、3 条必须还在：字段消毒的断言才有落点
    const x = at(res.state.favorites, 1, '导入并消毒后的收藏');
    expect(x.note).toHaveLength(120);
    expect(x.group).toHaveLength(24);
    expect(x.name).toHaveLength(8);
    expect(x.title).toHaveLength(30);
    expect(x.line).toHaveLength(120);
    const y = at(res.state.favorites, 2, '导入并消毒后的收藏');
    expect(y).toEqual({ id: 'y', ts: 3 });
    // book 是被丢掉了（未知典籍），不是整条不见了，所以先确认这条还在
    expect(y.book).toBeUndefined();
    expect(res.state.blocklist).toEqual(['a', 'b'.repeat(64)]);
  });
  it('条目上限：超过 5000 条的部分不接', () => {
    const many = Array.from({ length: 5200 }, (_, i) => ({ id: `id${i}` }));
    const res = parseState(JSON.stringify({ app: 'naming-app', favorites: many }));
    if (!res.ok) throw new Error('should be ok');
    expect(res.state.favorites).toHaveLength(5000);
  });
  it('字段缺失/越界被收敛到默认值', () => {
    const res = parseState('{"opts":{"gender":"zzz","count":9999,"length":3,"books":{"shijing":false}}}');
    if (!res.ok) throw new Error('should be ok');
    expect(res.state.opts.gender).toBe('any');
    expect(res.state.opts.count).toBe(12);
    expect(res.state.opts.length).toBe(2);
    expect(res.state.opts.books.shijing).toBe(false);
    expect(res.state.surname).toBe('');
  });
  it('姓氏只保留汉字', () => {
    const res = parseState('{"opts":{},"surname":"苏A1"}');
    if (!res.ok) throw new Error('should be ok');
    expect(res.state.surname).toBe('苏');
  });
  it('读音只认 0–9 的整数，其余回 0', () => {
    const readingOf = (json: string) => {
      const res = parseState(json);
      if (!res.ok) throw new Error('should be ok');
      return res.state.reading;
    };
    expect(readingOf('{"reading":2}')).toBe(2);
    expect(readingOf('{"reading":"3"}')).toBe(3);
    expect(readingOf('{"reading":99}')).toBe(0);
    expect(readingOf('{"reading":"曾"}')).toBe(0);
  });
});

describe('可分享链接', () => {
  it('只带非默认项，默认筛选产生空串', () => {
    expect(toQuery({ surname: '', reading: 0, opts: baseOpts() })).toBe('');
  });
  it('URL 往返：姓氏/读音/性别/条数/搜索/排序/典籍位', () => {
    const opts: Opts = {
      ...baseOpts(),
      gender: 'f',
      length: 1,
      count: 0,
      search: '云',
      sort: 'strokes',
      redupOnly: false,
    };
    opts.books = { ...opts.books, shijing: false };
    const q = toQuery({ surname: '欧阳', reading: 2, opts });
    const back = fromQuery(q)!;
    expect(back.surname).toBe('欧阳');
    expect(back.reading).toBe(2);
    expect(back.opts.gender).toBe('f');
    expect(back.opts.length).toBe(1);
    expect(back.opts.count).toBe(0);
    expect(back.opts.search).toBe('云');
    expect(back.opts.sort).toBe('strokes');
    expect(back.opts.books!.shijing).toBe(false);
    expect(Object.keys(back.opts.books!)).toHaveLength(BOOK_ORDER.length);
  });
  it('新增字形筛选进入 URL 并可还原（sm/nm/pf）', () => {
    const opts: Opts = { ...baseOpts(), strokeMax: 20, noMonotone: true, popFloor: 500 };
    const q = toQuery({ surname: '苏', reading: 0, opts });
    expect(q).toContain('sm=20');
    expect(q).toContain('nm=1');
    expect(q).toContain('pf=500');
    const back = fromQuery(q)!;
    expect(back.opts.strokeMax).toBe(20);
    expect(back.opts.noMonotone).toBe(true);
    expect(back.opts.popFloor).toBe(500);
  });
  it('默认值不写进 URL；链接里出现过的越界项回默认（不是忽略）', () => {
    expect(toQuery({ surname: '', reading: 0, opts: baseOpts() })).not.toContain('sm=');
    const back = fromQuery('sm=0&pf=999&nm=0')!;
    expect(back.opts.strokeMax).toBe(0);
    expect(back.opts.popFloor).toBe(0);
    expect(back.opts.noMonotone).toBe(false);
    // 没出现的参数不进入返回值，界面因此保留本机值
    expect('count' in back.opts).toBe(false);
    expect('gender' in back.opts).toBe(false);
  });
  it('空查询串返回 null', () => {
    expect(fromQuery('')).toBeNull();
  });
  it('指定字 mc/mp 往返一致；不限位置不写 mp', () => {
    const o = { ...baseOpts(), mustChar: '清', mustPos: 'last' as const };
    const back = fromQuery(toQuery({ surname: '苏', reading: 0, opts: o }))!;
    expect(back.opts.mustChar).toBe('清');
    expect(back.opts.mustPos).toBe('last');
    expect(toQuery({ surname: '', reading: 0, opts: { ...baseOpts(), mustChar: '清' } })).not.toContain('mp=');
  });
  it('非法指定字一律丢弃：多字、非汉字、未知位置', () => {
    expect(sanitizeOpts({ mustChar: '清清' }).mustChar).toBe('');
    expect(sanitizeOpts({ mustChar: 'a清' }).mustChar).toBe('');
    expect(sanitizeOpts({ mustPos: 'middle' }).mustPos).toBe('any');
    expect(fromQuery('mc=%E6%B8%85%E6%98%8E')!.opts.mustChar).toBe('');
    expect(fromQuery('mc=abc')!.opts.mustChar).toBe('');
  });
  it('禁用字 ac 往返一致；不限时不写进链接', () => {
    const o = { ...baseOpts(), avoidChars: '月风' };
    const q = toQuery({ surname: '苏', reading: 0, opts: o });
    expect(q).toContain('ac=' + encodeURIComponent('月风'));
    const back = fromQuery(q)!;
    expect(back.opts.avoidChars).toBe('月风');
    expect(toQuery({ surname: '', reading: 0, opts: baseOpts() })).not.toContain('ac=');
  });
  it('非法禁用字按规则裁剪：非汉字剔除、重复去重、超过 8 个字截到 8 个', () => {
    expect(sanitizeOpts({ avoidChars: '月a月' }).avoidChars).toBe('月');
    expect(sanitizeOpts({ avoidChars: '一二三四五六七八九十' }).avoidChars).toBe('一二三四五六七八');
    expect(sanitizeOpts({ avoidChars: 42 }).avoidChars).toBe('');
    expect(fromQuery('ac=' + encodeURIComponent('月a月'))!.opts.avoidChars).toBe('月');
    expect(fromQuery('ac=')!.opts.avoidChars).toBe('');
  });
  it('genderWeak（gw）进链接并可还原；性别不限时不写 gw', () => {
    const o = { ...baseOpts(), gender: 'f' as const, genderWeak: true };
    const q = toQuery({ surname: '苏', reading: 0, opts: o });
    expect(q).toContain('gw=1');
    const back = fromQuery(q)!;
    expect(back.opts.genderWeak).toBe(true);
    expect(back.opts.gender).toBe('f');
    expect(toQuery({ surname: '', reading: 0, opts: { ...baseOpts(), genderWeak: true } })).not.toContain('gw=');
    // 关掉 weak 的链接显式写 gw=0，不会把本机的开着的值留着
    expect(fromQuery('g=f&gw=0')!.opts.genderWeak).toBe(false);
  });
  it('三条输入路径口径一致：同一份脏取值，本机存储 / 导入文件 / 链接给出同一个结果', () => {
    const dirty = {
      gender: 'other',
      count: 601,
      length: 9,
      popFloor: 123,
      strokeMax: 999,
      noMonotone: 1,
      redupOnly: 1,
      search: 'x'.repeat(99),
      title: '篇'.repeat(50),
      mustChar: '清清',
      mustPos: 'middle',
      avoidChars: '月a月',
      sort: 'name',
    };
    const viaOpts = sanitizeOpts(dirty);
    const viaFile = parseState(JSON.stringify({ opts: dirty }));
    if (!viaFile.ok) throw new Error('should be ok');
    expect(viaFile.state.opts).toEqual(viaOpts);
    // 同一批取值写成链接参数：每一项消毒后的结果必须与上面相同
    const viaUrl = fromQuery(
      'g=other&n=601&len=9&pf=123&sm=999&o=name&mc=%E6%B8%85%E6%98%8E&mp=middle&ac=' +
        encodeURIComponent('月a月') +
        '&t=' +
        encodeURIComponent('篇'.repeat(50)) +
        '&q=' +
        'x'.repeat(99),
    )!;
    expect(viaUrl.opts.gender).toBe(viaOpts.gender);
    expect(viaUrl.opts.count).toBe(viaOpts.count);
    expect(viaUrl.opts.length).toBe(viaOpts.length);
    expect(viaUrl.opts.popFloor).toBe(viaOpts.popFloor);
    expect(viaUrl.opts.strokeMax).toBe(viaOpts.strokeMax);
    expect(viaUrl.opts.sort).toBe(viaOpts.sort);
    expect(viaUrl.opts.mustChar).toBe(viaOpts.mustChar);
    expect(viaUrl.opts.mustPos).toBe(viaOpts.mustPos);
    expect(viaUrl.opts.avoidChars).toBe(viaOpts.avoidChars);
    expect(viaUrl.opts.title).toBe(viaOpts.title);
    expect(viaUrl.opts.search).toBe(viaOpts.search);
    // 合法值经「写入 → 链接 → 读回」保持原样（链接只带非默认项，所以按项比对）
    const clean = sanitizeOpts({
      gender: 'm',
      count: 600,
      length: 1,
      popFloor: 2000,
      strokeMax: 64,
      noMonotone: true,
      sort: 'book',
      mustChar: '清',
      mustPos: 'first',
      avoidChars: '月风',
      title: '篇'.repeat(30),
      search: '云',
    });
    const back = fromQuery(toQuery({ surname: '', reading: 0, opts: clean }))!;
    const merged = { ...baseOpts(), ...back.opts };
    expect(merged).toEqual(clean);
    expect(viaOpts.count).toBe(12);
    expect(viaOpts.length).toBe(2);
    expect(viaOpts.popFloor).toBe(0);
    expect(viaOpts.strokeMax).toBe(0);
    expect(viaOpts.noMonotone).toBe(true);
    expect(viaOpts.redupOnly).toBe(true);
    expect(viaOpts.search).toHaveLength(40);
    expect(viaOpts.title).toHaveLength(30);
    expect(viaOpts.mustChar).toBe('');
    expect(viaOpts.mustPos).toBe('any');
    expect(viaOpts.avoidChars).toBe('月');
    expect(viaOpts.sort).toBe('score');
    expect(viaOpts.gender).toBe('any');
  });
  it('旧链接兼容：6 位典籍位解析不变，之后新增的书默认开', () => {
    const back = fromQuery('b=101011')!;
    const books = back.opts.books!;
    expect(Object.keys(books)).toHaveLength(BOOK_ORDER.length);
    const bits = '101011';
    BOOK_ORDER.slice(0, 6).forEach((k, i) => expect(books[k], k).toBe(bits[i] === '1'));
    BOOK_ORDER.slice(6).forEach((k) => expect(books[k], k).toBe(true));
  });
});
