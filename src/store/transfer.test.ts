import { describe, expect, it } from 'vitest';
import { buildState, fromQuery, parseState, sanitizeOpts, serialize, toQuery } from './transfer';
import type { FavRecord } from './local';
import { BOOK_ORDER, type Opts } from '../engine/types';

const baseOpts = (): Opts => sanitizeOpts({});

describe('导入解析', () => {
  it('导出→解析 往返一致', () => {
    const fav: FavRecord[] = [{ id: 'x', note: '喜欢', group: '女', ts: 1 }];
    const st = buildState({ surname: '苏', reading: 1, opts: baseOpts(), favorites: fav, blocklist: ['y'] });
    const back = parseState(serialize(st));
    expect(back).not.toBeNull();
    expect(back!.surname).toBe('苏');
    expect(back!.reading).toBe(1);
    expect(back!.favorites[0].note).toBe('喜欢');
    expect(back!.blocklist).toEqual(['y']);
  });
  it('非本应用的文件返回 null，不抛异常', () => {
    expect(parseState('not json')).toBeNull();
    expect(parseState('{"foo":1}')).toBeNull();
    expect(parseState('[1,2,3]')).toBeNull();
  });
  it('字段缺失/越界被收敛到默认值', () => {
    const st = parseState('{"opts":{"gender":"zzz","count":9999,"length":3,"books":{"shijing":false}}}');
    expect(st).not.toBeNull();
    expect(st!.opts.gender).toBe('any');
    expect(st!.opts.count).toBe(12);
    expect(st!.opts.length).toBe(2);
    expect(st!.opts.books.shijing).toBe(false);
    expect(st!.surname).toBe('');
  });
  it('姓氏只保留汉字', () => {
    expect(parseState('{"opts":{},"surname":"苏A1"}')!.surname).toBe('苏');
  });
  it('sanitizeOpts：笔画越界归 0，常见度只认档位，布尔项强制转布尔', () => {
    expect(sanitizeOpts({ strokeMax: -3 }).strokeMax).toBe(0);
    expect(sanitizeOpts({ strokeMax: 999 }).strokeMax).toBe(0);
    expect(sanitizeOpts({ strokeMax: 20 }).strokeMax).toBe(20);
    expect(sanitizeOpts({ popFloor: 123 }).popFloor).toBe(0);
    expect(sanitizeOpts({ popFloor: 500 }).popFloor).toBe(500);
    expect(sanitizeOpts({ noMonotone: 'yes' }).noMonotone).toBe(true);
    expect(sanitizeOpts({ noMonotone: 0 }).noMonotone).toBe(false);
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
