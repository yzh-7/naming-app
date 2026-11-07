// 繁简输入归一（0.20.0）
//
// 数据是简体的，此前输入繁体什么都搜不到：「蘇」搜不到「苏晚」，姓填「陳」生成不出名字。
// 归一靠一张表，不靠运行时库——本应用运行期间零网络，也不该为了输入归一背几十 KB 的转换器。
// 表的生成口径与两种方案的实测 gzip 见 DESIGN.md「预研：繁简输入归一要花多少体积」；
// 这里带的是「简体侧落在可匹配字符集里」那一档：1,122 对、覆盖 1,031 个简体字。
//
// 两条口径要写清楚：
// ① 只在匹配处用，不改用户写下的东西。输入框里仍是他打的繁体，界面另给一行「蘇 → 苏」，
//    所以「我打的字被偷偷换了」这件事不会发生。
// ② 表里没有的字一律原样留着。表只覆盖本应用搜得到的那些简体字，表外的繁体本来就搜不到东西，
//    归一不该假装能，也不许把它映射到一个语料里没有的字上。

import pairs from '../data/t2s.json';
import { META } from './data';

// 表与 meta 记的对数对不上就是产物被人手改过：宁可启动就报错，也不要带着半张表去匹配
if (pairs.length !== META.t2s_pairs * 2)
  throw new Error(
    `t2s.json 形状不符：应当是 ${META.t2s_pairs * 2} 个字符的「繁体简体相邻成对」串，实际 ${pairs.length} 个`,
  );

// 产物里存的是相邻串：偶数位繁体、奇数位对应简体（省掉 JSON 数组的引号与逗号，实测省 1.7 KB gzip）
const MAP = new Map<string, string>();
for (let i = 0; i + 1 < pairs.length; i += 2) {
  const trad = pairs[i];
  const simp = pairs[i + 1];
  // 串若被截成奇数个字符（手改产物、写入中断），丢掉最后那半个而不是崩在这里
  if (trad === undefined || simp === undefined) continue;
  MAP.set(trad, simp);
}

/** 逐字映射成简体；表里没有的原样保留（拼音、标点、假名都不受影响） */
export const toSimplified = (text: string): string => {
  if (!text) return text;
  let out = '';
  let mapped = false;
  for (const ch of text) {
    const s = MAP.get(ch);
    if (s === undefined) {
      out += ch;
      continue;
    }
    out += s;
    mapped = true;
  }
  return mapped ? out : text;
};

/** 这个串里有没有本表认得的繁体字 */
export const hasTraditional = (text: string): boolean => {
  for (const ch of text) if (MAP.has(ch)) return true;
  return false;
};

/** 界面提示用的逐字对照，按出现顺序去重：['蘇 → 苏', '陳 → 陈'] */
export const traditionalRewrites = (text: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of text) {
    const s = MAP.get(ch);
    if (s === undefined) continue;
    const line = `${ch} → ${s}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
};
