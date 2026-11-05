// 逐字段比对产物与上一个 commit：双名与单字名的 id / name / ti / li / ns / sq / foot / gap / score … 必须逐字不变。
// 唯一允许的新增是候选条目上的 `alt` 键（多出处）。收藏、拉黑、分享链接全靠 id，所以这条比对是硬前提。
// 判据写成「剥掉 alt 之后整条记录逐字节相同」，比逐字段比更强：字段顺序、数字写法、缺字段都在比对范围里。
// 共享表另判一条：原表必须是新表的前缀（老条目的下标一个都不位移）。
// 用法：node scripts/records-diff.mjs [git ref，默认 HEAD]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ref = process.argv[2] ?? 'HEAD';
const show = (f) =>
  execFileSync('git', ['show', `${ref}:src/data/${f}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const now = (f) => fs.readFileSync(`src/data/${f}`, 'utf8').trim();

let bad = 0;
let compared = 0;
let withAlt = 0;

for (const file of ['candidates.json', 'singles.json']) {
  const before = JSON.parse(show(file));
  const after = JSON.parse(now(file));
  console.log(`${file}：${ref} 有 ${before.length} 条，工作区有 ${after.length} 条`);
  if (before.length !== after.length) {
    console.log(`  FAIL 条数变了：${before.length} → ${after.length}`);
    bad++;
    continue;
  }
  for (let i = 0; i < before.length; i++) {
    compared += 1;
    const a = after[i];
    if ('alt' in a) withAlt += 1;
    // 克隆一份不含 alt 的对象再逐字节比：JSON 里的键顺序、数字写法、少一个字段都算不一致
    const clone = { ...a };
    delete clone.alt;
    const same = JSON.stringify(before[i]) === JSON.stringify(clone);
    const extraKeys = Object.keys(a).filter((k) => k !== 'alt' && !(k in before[i]));
    const missingKeys = Object.keys(before[i]).filter((k) => !(k in a));
    if (!same || extraKeys.length || missingKeys.length) {
      bad++;
      if (bad <= 6)
        console.log(
          `  FAIL 第 ${i} 条（${a.name ?? a.char}）与 ${ref} 不一致：${same ? '' : '字节不同'}${
            extraKeys.length ? ` 多出 ${extraKeys.join('/')}` : ''
          }${missingKeys.length ? ` 少了 ${missingKeys.join('/')}` : ''}`,
        );
    }
  }
}

const srcBefore = JSON.parse(show('sources.json'));
const srcAfter = JSON.parse(now('sources.json'));
for (const table of ['titles', 'lines']) {
  const b = srcBefore[table];
  const a = srcAfter[table];
  const prefixOk = b.length <= a.length && b.every((x, i) => JSON.stringify(x) === JSON.stringify(a[i]));
  console.log(
    `sources.${table}：${b.length} → ${a.length} 条，老条目逐字节是前缀：${prefixOk ? '是' : '否（下标会位移，id 就变了）'}`,
  );
  if (!prefixOk) bad++;
}

console.log(`\n比对 ${compared} 条记录，不一致 ${bad} 处${withAlt ? `（其中 ${withAlt} 条带新增的 alt 键）` : ''}`);
process.exit(bad ? 1 : 0);
