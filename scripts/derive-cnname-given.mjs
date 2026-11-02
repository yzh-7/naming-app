// 一次性派生脚本（不属于常规 build）：把上游「中文人名语料（带性别）」裁剪成 data/raw/cnname_given.json。
// 上游：wainshine/Chinese-Names-Corpus 的 `Chinese_Names_Corpus_Gender（120W）.txt`（Apache-2.0），
// 每行 `姓名,性别`（性别取值 男／女／未知）。同一仓库的另一份 `Chinese_Names_Corpus（120W）.txt`
// 已经被 derive-dict.mjs 用来算「名用字频次」，这里补上的是**整个名字**这一层：
// 某两个字的组合真有人用过多少次、用的人偏男还是偏女。
// 用法：把上游文件放到 UP 目录（默认 /tmp/opencode，文件名 names120w_gender.txt），再
// `node scripts/derive-cnname-given.mjs`。产物进 data/raw，登记进 SHA256SUMS，构建期只读裁剪结果。
// 只留聚合数，不留任何单条姓名；隐私口径与 name_given_freq.json 一致。
import fs from 'node:fs';
import path from 'node:path';

const UP = process.env.UP_DIR ?? '/tmp/opencode';
const OUT = 'data/raw';
const src = fs.readFileSync(path.join(UP, 'names120w_gender.txt'), 'utf8');

// 通用规范汉字表三级全集：不在表内的字运行时没有读音与字义，收了也用不上
const GSC = new Set();
for (const f of ['gsc_level_1.txt', 'gsc_level_2.txt', 'gsc_level_3.txt']) {
  for (const line of fs.readFileSync(path.join(OUT, f), 'utf8').split('\n')) {
    for (const c of line.trim()) GSC.add(c);
  }
}

const MIN = 2; // 只出现过一次的组合不进表：120 万行里的孤例绝大多数是录入噪声
const rows = src.split('\n');
const table = new Map();
let lines = 0;
for (const raw of rows) {
  const line = raw.trim().replace(/^\uFEFF/, '');
  if (!line || /^[B\d]/.test(line)) continue; // 表头与日期行
  const [full, sexRaw] = line.split(',');
  if (!full || full.length < 2) continue;
  const given = full.slice(1); // 首字作姓去掉（与 derive-dict.mjs 同一口径）
  if (given.length !== 2 || ![...given].every((c) => GSC.has(c))) continue;
  lines += 1;
  const sex = sexRaw === '男' || sexRaw === '女' ? sexRaw : '';
  const cur = table.get(given) ?? [0, 0, 0];
  cur[0] += 1;
  if (sex === '男') cur[1] += 1;
  if (sex === '女') cur[2] += 1;
  table.set(given, cur);
}
const out = {};
for (const [k, v] of table) if (v[0] >= MIN) out[k] = v;
const sorted = Object.fromEntries(Object.entries(out).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
fs.writeFileSync(path.join(OUT, 'cnname_given.json'), JSON.stringify(sorted) + '\n');

const named = Object.values(sorted);
console.log(
  JSON.stringify(
    {
      上游行: rows.length - 1,
      合格二字名行: lines,
      不同二字名: table.size,
      进表次数门槛: MIN,
      进表条目: named.length,
      进表覆盖行: named.reduce((a, b) => a + b[0], 0),
      男多: named.filter((v) => v[1] + v[2] >= 5 && v[1] / (v[1] + v[2]) >= 0.8).length,
      女多: named.filter((v) => v[1] + v[2] >= 5 && v[2] / (v[1] + v[2]) >= 0.8).length,
      两侧都用: named.filter((v) => v[1] + v[2] >= 5 && v[1] / (v[1] + v[2]) > 0.2 && v[2] / (v[1] + v[2]) > 0.2)
        .length,
      产物字节: fs.statSync(path.join(OUT, 'cnname_given.json')).size,
    },
    null,
    1,
  ),
);
