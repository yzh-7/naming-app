// 带调拼音推导的验收（DESIGN.md 1.3.1「产物里不存可以推导的字段」）。
// 界面显示的带调写法不再随包发，所以这里必须逐条证明它复现上游的写法：
// 任何一条读音对不上，构建产物里的拼音就会静默地变成别的音节。
import { describe, expect, it } from 'vitest';
import { pinyin } from 'pinyin-pro';
import charsJson from '../data/chars.json';
import { CHARS } from './data';
import { markSyllable } from './tone';

describe('带调拼音推导', () => {
  it('标调位置按规则：a o e 优先，ou 标 o，iu 标 u，ui 标 i', () => {
    expect(markSyllable('hui', 1)).toBe('huī');
    expect(markSyllable('gui', 4)).toBe('guì');
    expect(markSyllable('kui', 2)).toBe('kuí');
    expect(markSyllable('liu', 1)).toBe('liū');
    expect(markSyllable('gou', 1)).toBe('gōu');
    expect(markSyllable('shang', 4)).toBe('shàng');
    expect(markSyllable('lü', 4)).toBe('lǜ');
    expect(markSyllable('song', 1)).toBe('sōng');
  });

  it('轻声与没有声调时原样返回', () => {
    expect(markSyllable('de', 0)).toBe('de');
    expect(markSyllable('de', 5)).toBe('de');
  });

  it('自成音节（m n ng ê）按上游写法逐条给出，不猜', () => {
    expect(markSyllable('m', 2)).toBe('ḿ');
    expect(markSyllable('m', 4)).toBe('m̀');
    expect(markSyllable('n', 2)).toBe('ń');
    expect(markSyllable('ng', 2)).toBe('ńg');
    expect(markSyllable('ng', 3)).toBe('ňg');
    expect(markSyllable('ng', 4)).toBe('ǹg');
    expect(markSyllable('ê', 1)).toBe('ê̄');
    expect(markSyllable('ê', 2)).toBe('ế');
    expect(markSyllable('ê', 4)).toBe('ề');
  });

  it('产物里每一条读音的带调写法都能推导出来，且与上游逐字一致', () => {
    let checked = 0;
    for (const [ch, info] of Object.entries(CHARS)) {
      const upstream = pinyin(ch, { toneType: 'symbol', type: 'string', multiple: true })
        .split(/[,\s]+/)
        .filter(Boolean);
      expect(upstream.length, `${ch} 的读音条数与产物不一致`).toBe(info.pm.length);
      info.pm.forEach((mark, i) => {
        expect(mark, `${ch} 第 ${i + 1} 条读音 ${info.py[i]}（${info.t[i]} 声）`).toBe(upstream[i]);
        checked += 1;
      });
    }
    expect(checked, '名用字表的读音总数应当与产物同量级').toBeGreaterThan(9000);
  });

  it('界面拿到的形状不变：pm 与 l0 都在，但产物 json 里没有这两个字段', () => {
    const song = CHARS['松'];
    if (!song) throw new Error('名用字表里没有「松」');
    expect(song.pm).toEqual(['sōng']);
    expect(song.l0).toBe(true);
    const raw = charsJson as unknown as Record<string, Record<string, unknown>>;
    const rawSong = raw['松'];
    if (!rawSong) throw new Error('产物 chars.json 里没有「松」');
    expect('pm' in rawSong, '带调写法又回到产物里了').toBe(false);
    expect('l0' in rawSong, '白名单成员又回到产物里了').toBe(false);
    expect(Object.values(raw).some((c) => 'pm' in c || 'l0' in c)).toBe(false);
  });
});
