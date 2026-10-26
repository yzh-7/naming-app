import { describe, expect, it } from 'vitest';
import { buildState, fromQuery, parseState, sanitizeOpts, serialize, toQuery } from './transfer';
import type { FavRecord } from './local';
import { BOOK_ORDER, type Opts } from '../engine/types';

const baseOpts = (): Opts => sanitizeOpts({});

describe('导入解析', () => {
  it('导出→解析 往返一致（含收藏里的名字快照）', () => {
    const fav: FavRecord[] = [{ id: 'x', note: '喜欢', group: '女', ts: 1, name: '清婉', book: 'shijing', title: '野有死麕', line: '野有死麕，白茅包之' }];
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
        { id: 'x', note: '长'.repeat(300), group: '组'.repeat(60), name: '名'.repeat(40), title: '篇'.repeat(50), line: '句'.repeat(300) },
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
    const x = res.state.favorites[1];
    expect(x.note).toHaveLength(120);
    expect(x.group).toHaveLength(24);
    expect(x.name).toHaveLength(8);
    expect(x.title).toHaveLength(30);
    expect(x.line).toHaveLength(120);
    expect(res.state.favorites[2]).toEqual({ id: 'y', ts: 3 });
    expect(res.state.favorites[2].book).toBeUndefined();
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
  it('sanitizeOpts：笔画越界归 0，常见度只认档位，布尔项强制转布尔，篇名截到 30 字', () => {
    expect(sanitizeOpts({ strokeMax: -3 }).strokeMax).toBe(0);
    expect(sanitizeOpts({ strokeMax: 999 }).strokeMax).toBe(0);
    expect(sanitizeOpts({ strokeMax: 20 }).strokeMax).toBe(20);
    expect(sanitizeOpts({ popFloor: 123 }).popFloor).toBe(0);
    expect(sanitizeOpts({ popFloor: 500 }).popFloor).toBe(500);
    expect(sanitizeOpts({ noMonotone: 'yes' }).noMonotone).toBe(true);
    expect(sanitizeOpts({ noMonotone: 0 }).noMonotone).toBe(false);
    expect(sanitizeOpts({ title: '篇'.repeat(50) }).title).toHaveLength(30);
    expect(sanitizeOpts({ search: 'x'.repeat(99) }).search).toHaveLength(40);
  });
});

describe('可分享链接', () => {
  it('只带非默认项，默认筛选产生空串', () => {
    expect(toQuery({ surname: '', reading: 0, opts: baseOpts() })).toBe('');
  });
  it('URL 往返：姓氏/读音/性别/条数/搜索/排序/典籍位', () => {
    const opts: Opts = { ...baseOpts(), gender: 'f', length: 1, count: 0, search: '云', sort: 'strokes', redupOnly: false };
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
  it('默认值不写进 URL；越界的 sm/pf 被忽略', () => {
    expect(toQuery({ surname: '', reading: 0, opts: baseOpts() })).not.toContain('sm=');
    const back = fromQuery('sm=0&pf=999&nm=0');
    expect(back!.opts.strokeMax).toBeUndefined();
    expect(back!.opts.popFloor).toBeUndefined();
    expect(back!.opts.noMonotone).toBeUndefined();
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
    expect(fromQuery('mc=%E6%B8%85%E6%98%8E')!.opts.mustChar).toBeUndefined();
    expect(fromQuery('mc=abc')!.opts.mustChar).toBeUndefined();
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
