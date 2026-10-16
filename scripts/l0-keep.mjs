// 读 data/raw/l0-verdicts.txt 的「保留」字，供设计期诊断脚本对齐 build-data 的 L0 口径。
// 扩表后（种子 ∩ 通用规范字表 ∪ 人工保留），这些脚本若不并入人工保留，池子就会与 meta.pool_B 对不上而误报「口径漂移」。
import fs from 'node:fs';
import path from 'node:path';

export const VERDICT_FILE = 'l0-verdicts.txt';

export function verdictKeep(rawDir = 'data/raw') {
  const p = path.join(rawDir, VERDICT_FILE);
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, 'utf8');
  const m = text.match(/^保留=([\s\S]*?)(?=\n(?=#|保留=|剔除=|待判=|预计)|$)/m);
  return m ? [...m[1].replace(/[^一-鿿]/g, '')] : [];
}

export function buildL0(seed, rawDir = 'data/raw') {
  const L0 = new Set(seed);
  for (const c of verdictKeep(rawDir)) L0.add(c);
  return L0;
}
