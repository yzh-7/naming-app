// 带调拼音的推导。
//
// 产物里过去同时存两套拼音：不带调的 `py`（打分与搜索用）和带调的 `pm`（界面显示用）。
// 带调写法其实是「不带调音节 + 声调号」的纯函数，8,105 字共 9,629 条读音，光 `pm` 就占 22,604 B gzip。
// 现在只发 `py` 与 `t`，带调写法在这里推导。
//
// 规则是汉语拼音的标调位置规则：有 a 标 a，有 o 标 o，有 e 标 e；`ou` 标 o；`iu` 标 u、`ui` 标 i；
// 否则标第一个元音。自成音节的四个例外（m n ng ê）没有元音可标，按上游写法逐条列出。
//
// 这条推导不是「看起来对」就算数：`src/engine/tone.test.ts` 逐条比对 pinyin-pro 的带调输出，
// `scripts/build-data.mjs` 在构建时用同一套规则比对上游，任一处漂移都会判红。

const TONE_MARKS: Record<string, string> = {
  a: 'āáǎà',
  e: 'ēéěè',
  i: 'īíǐì',
  o: 'ōóǒò',
  u: 'ūúǔù',
  ü: 'ǖǘǚǜ',
};

// 自成音节：没有元音可标，上游怎么写就怎么写（数据里出现过的全部组合）
const STANDALONE: Record<string, Record<number, string>> = {
  m: { 2: 'ḿ', 3: 'm̌', 4: 'm̀' },
  n: { 2: 'ń', 3: 'ň', 4: 'ǹ' },
  ng: { 1: 'ṅg', 2: 'ńg', 3: 'ňg', 4: 'ǹg' },
  ê: { 1: 'ê̄', 2: 'ế', 3: 'ê̌', 4: 'ề' },
};

const vowelIndex = (syl: string): number => {
  for (const v of ['a', 'o', 'e']) {
    const i = syl.indexOf(v);
    if (i >= 0) return i;
  }
  const ou = syl.indexOf('ou');
  if (ou >= 0) return ou;
  const iu = syl.indexOf('iu');
  if (iu >= 0) return iu + 1;
  const ui = syl.indexOf('ui');
  if (ui >= 0) return ui + 1;
  for (let i = 0; i < syl.length; i++) if (TONE_MARKS[syl[i] ?? '']) return i;
  return -1;
};

/** 给一个不带调音节加声调号；tone 为 0 或 5（轻声）时原样返回。 */
export const markSyllable = (syl: string, tone: number): string => {
  if (!tone || tone === 5) return syl;
  const standalone = STANDALONE[syl];
  if (standalone && standalone[tone]) return standalone[tone];
  const i = vowelIndex(syl);
  const marks = i >= 0 ? TONE_MARKS[syl[i] ?? ''] : undefined;
  if (!marks || tone < 1 || tone > 4) return syl;
  return syl.slice(0, i) + marks[tone - 1] + syl.slice(i + 1);
};
