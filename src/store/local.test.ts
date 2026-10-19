import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addBlock, addFavorite, BLOCK_KEY, DEFAULT_OPTS, FAV_KEY, loadBlocklist, loadCompose, loadFavorites,
  loadOpts, loadReading, loadSurname, loadTheme, removeBlock, removeFavorite, resolveDark,
  saveBlocklist, saveCompose, saveFavorites, saveReading, saveSurname, saveTheme, updateFavorite,
} from './local';
import { BOOK_ORDER } from '../engine/types';

const K = {
  fav: 'naming.favorites.v1',
  block: 'naming.blocklist.v1',
  surname: 'naming.surname.v1',
  reading: 'naming.surnameReading.v1',
  opts: 'naming.opts.v1',
  theme: 'naming.theme.v1',
};

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('收藏：新增 / 删除 / 更新 / 去重', () => {
  it('最近收藏排在前面，重复收藏不重复记', () => {
    addFavorite('a');
    addFavorite('b');
    addFavorite('a');
    expect(loadFavorites().map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('updateFavorite 只改命中的那条，写回后可读', () => {
    addFavorite('a'); addFavorite('b');
    const l = updateFavorite('a', { note: '喜欢', group: '女' });
    expect(l.find((r) => r.id === 'a')).toMatchObject({ note: '喜欢', group: '女' });
    expect(loadFavorites().find((r) => r.id === 'a')!.note).toBe('喜欢');
    expect(updateFavorite('missing', { note: 'x' }).length).toBe(2);
  });
  it('removeFavorite 删除后回读一致', () => {
    addFavorite('a'); addFavorite('b');
    expect(removeFavorite('a').map((r) => r.id)).toEqual(['b']);
    expect(loadFavorites().map((r) => r.id)).toEqual(['b']);
  });
  it('旧格式（id 字符串数组）就地升级成记录，保留顺序并去重', () => {
    localStorage.setItem(K.fav, JSON.stringify(['a', 'b', 'a']));
    expect(loadFavorites()).toEqual([{ id: 'a', ts: 0 }, { id: 'b', ts: 1 }]);
  });
  it('脏数据不炸：非数组、空对象、漏 id 一律跳过', () => {
    localStorage.setItem(K.fav, '"nope"');
    expect(loadFavorites()).toEqual([]);
    localStorage.setItem(K.fav, JSON.stringify([{}, { id: 1 }, { id: 'ok', note: 9, group: '' }, null]));
    expect(loadFavorites()).toEqual([{ id: 'ok', note: undefined, group: undefined, ts: 2 }]);
    localStorage.setItem(K.fav, 'not json');
    expect(loadFavorites()).toEqual([]);
  });
});

describe('拉黑名单', () => {
  it('新增去重、置顶，删除后回读一致', () => {
    addBlock('x'); addBlock('y'); addBlock('x');
    expect(loadBlocklist()).toEqual(['y', 'x']);
    expect(removeBlock('y')).toEqual(['x']);
  });
  it('非字符串项被过滤', () => {
    localStorage.setItem(K.block, JSON.stringify(['a', 3, null, 'a']));
    expect(loadBlocklist()).toEqual(['a']);
  });
});

describe('姓氏与读音持久化', () => {
  it('往返一致；未设置时分别给空串与 0', () => {
    expect(loadSurname()).toBe('');
    expect(loadReading()).toBe(0);
    saveSurname('欧阳');
    saveReading(1);
    expect(loadSurname()).toBe('欧阳');
    expect(loadReading()).toBe(1);
  });
});

describe('主题', () => {
  it('已保存的值优先；三种取值都可读回', () => {
    for (const t of ['dark', 'light', 'system'] as const) {
      saveTheme(t);
      expect(loadTheme()).toBe(t);
    }
  });
  it('未保存时默认「跟随系统」', () => {
    expect(loadTheme()).toBe('system');
  });
  it('resolveDark：显式取值直接生效，system 跟随系统偏好', () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q })) as unknown as typeof window.matchMedia;
    expect(resolveDark('dark')).toBe(true);
    expect(resolveDark('light')).toBe(false);
    expect(resolveDark('system')).toBe(true);
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
    expect(resolveDark('system')).toBe(false);
    // @ts-expect-error 模拟不支持 matchMedia 的环境
    delete window.matchMedia;
    expect(resolveDark('system')).toBe(false);
    expect(resolveDark('dark')).toBe(true);
  });
});

describe('loadOpts：默认值与越界收敛', () => {
  it('空存储给默认值', () => {
    expect(loadOpts()).toEqual(DEFAULT_OPTS);
  });
  it('书籍位逐本合并，只认布尔值', () => {
    localStorage.setItem(K.opts, JSON.stringify({ books: { shijing: false, chuci: 'x' } }));
    const o = loadOpts();
    expect(o.books.shijing).toBe(false);
    expect(o.books.chuci).toBe(true);
    expect(Object.keys(o.books)).toHaveLength(BOOK_ORDER.length);
  });
  it('count 越界回默认，0 与 600 是合法边界', () => {
    for (const [input, expected] of [[9999, 12], [-1, 12], [601, 12], [1.5, 12], ['x', 12], [0, 0], [600, 600], [24, 24]] as const) {
      localStorage.setItem(K.opts, JSON.stringify({ count: input }));
      expect(loadOpts().count, `count=${input}`).toBe(expected);
    }
  });
  it('gender / sort 非法值回默认，合法值保留', () => {
    localStorage.setItem(K.opts, JSON.stringify({ gender: 'zzz', sort: 'nope' }));
    expect(loadOpts().gender).toBe('any');
    expect(loadOpts().sort).toBe('score');
    localStorage.setItem(K.opts, JSON.stringify({ gender: 'f', sort: 'popular' }));
    expect(loadOpts().gender).toBe('f');
    expect(loadOpts().sort).toBe('popular');
  });
  it('search 截断到 40 字；非字符串回默认', () => {
    localStorage.setItem(K.opts, JSON.stringify({ search: 'x'.repeat(60) }));
    expect(loadOpts().search).toHaveLength(40);
    localStorage.setItem(K.opts, JSON.stringify({ search: 7 }));
    expect(loadOpts().search).toBe('');
  });
  it('单名层强制关掉叠字（否则开关藏起来却清空池子）', () => {
    localStorage.setItem(K.opts, JSON.stringify({ length: 1, redupOnly: true }));
    expect(loadOpts().redupOnly).toBe(false);
    localStorage.setItem(K.opts, JSON.stringify({ length: 2, redupOnly: true }));
    expect(loadOpts().redupOnly).toBe(true);
  });
  it('存储损坏回默认，不抛异常', () => {
    localStorage.setItem(K.opts, 'not json');
    expect(loadOpts()).toEqual(DEFAULT_OPTS);
  });
  it('strokeMax 越界回默认，0..64 整数保留', () => {
    for (const [input, expected] of [[-1, 0], [65, 0], [1.5, 0], ['x', 0], [16, 16], [0, 0]] as const) {
      localStorage.setItem(K.opts, JSON.stringify({ strokeMax: input }));
      expect(loadOpts().strokeMax, `strokeMax=${input}`).toBe(expected);
    }
  });
  it('popFloor 只认档位，其余回默认', () => {
    for (const [input, expected] of [[123, 0], [500, 500], [2000, 2000], [0, 0]] as const) {
      localStorage.setItem(K.opts, JSON.stringify({ popFloor: input }));
      expect(loadOpts().popFloor, `popFloor=${input}`).toBe(expected);
    }
  });
  it('noMonotone 强制转布尔', () => {
    localStorage.setItem(K.opts, JSON.stringify({ noMonotone: 'yes' }));
    expect(loadOpts().noMonotone).toBe(true);
  });
});

describe('导入写回：saveFavorites / saveBlocklist', () => {
  it('saveFavorites 整体覆盖并回读', () => {
    addFavorite('old');
    const back = saveFavorites([{ id: 'a', note: 'n', group: 'g', ts: 1 }]);
    expect(back.map((r) => r.id)).toEqual(['a']);
    expect(loadFavorites()[0]).toMatchObject({ id: 'a', note: 'n', group: 'g' });
  });
  it('saveBlocklist 写回时去重', () => {
    expect(saveBlocklist(['x', 'x', 'y'])).toEqual(['x', 'y']);
    expect(loadBlocklist()).toEqual(['x', 'y']);
  });
});

describe('导出的 localStorage key 常量与实际键一致', () => {
  it('FAV_KEY / BLOCK_KEY', () => {
    expect(FAV_KEY).toBe(K.fav);
    expect(BLOCK_KEY).toBe(K.block);
  });
});

describe('自选页草稿持久化', () => {
  const ck = 'naming.compose.v1';
  it('默认值：空存储给双名/空字/非自由', () => {
    expect(loadCompose()).toEqual({ length: 2, chars: [], free: false });
  });
  it('往返一致', () => {
    saveCompose({ length: 1, chars: ['子'], free: true });
    expect(loadCompose()).toEqual({ length: 1, chars: ['子'], free: true });
  });
  it('脏数据被收敛：非汉字过滤、超长截断、length 只认 1/2', () => {
    localStorage.setItem(ck, JSON.stringify({ length: 3, chars: ['子', 'a', '归', '云'], free: 1 }));
    expect(loadCompose()).toEqual({ length: 2, chars: ['子', '归'], free: true });
  });
  it('存储损坏回默认，不抛异常', () => {
    localStorage.setItem(ck, 'not json');
    expect(loadCompose()).toEqual({ length: 2, chars: [], free: false });
  });
});
