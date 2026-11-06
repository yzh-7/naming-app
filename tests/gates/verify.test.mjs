// @vitest-environment node
// 验收门禁自身的失败路径用例（DESIGN.md 第 3 节「输入指纹」与第 1 节「确定性」）。
// 每个用例都在临时目录里重出一份夹具（scripts/ + src/data/ + data/raw/），
// 绝不改动仓库里的语料：语料与清单一旦被测试改动，其它用例与门禁都会读到脏数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const SCRIPT = path.join(REPO, 'scripts', 'verify.mjs');

const created = [];

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-gate-'));
  created.push(dir);
  fs.cpSync(path.join(REPO, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  fs.cpSync(path.join(REPO, 'src', 'data'), path.join(dir, 'src', 'data'), { recursive: true });
  fs.cpSync(path.join(REPO, 'data', 'raw'), path.join(dir, 'data', 'raw'), { recursive: true });
  // verify 的第 1) 步会重跑 build:data（连跑两次比哈希），所以夹具里要有脚本与依赖。
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

function runVerify(dir) {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function runBuild(dir) {
  const r = spawnSync(process.execPath, ['scripts/build-data.mjs'], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function write(dir, rel, text) {
  fs.writeFileSync(path.join(dir, rel), text);
}

// 语料改了就把清单一起改：用来模拟「语料更新链走完，但断言拦不住」这种情形。
function refreshSum(dir, rel) {
  const sums = read(dir, 'data/raw/SHA256SUMS').trimEnd().split('\n');
  const h = createHash('sha256')
    .update(fs.readFileSync(path.join(dir, 'data', 'raw', rel)))
    .digest('hex');
  const out = sums.map((l) => {
    const [, f] = l.trim().split(/\s+/);
    return f === rel ? `${h}  ${f}` : l;
  });
  write(dir, 'data/raw/SHA256SUMS', out.join('\n') + '\n');
}

// 只数断言行（末尾的汇总行「FAILURES: N」不算一条断言）。
const failLines = (out) => out.split('\n').filter((l) => /^\s+FAIL\s/.test(l));

describe('verify 门禁的失败路径', () => {
  it('夹具未改动时全绿，后面的判红不是假阳性', () => {
    const { code, out } = runVerify(fixture());
    expect(out).toContain('ALL PASS');
    expect(failLines(out)).toHaveLength(0);
    expect(code).toBe(0);
  }, 120_000);

  it('清单里的哈希与语料对不上：判红并指名哪个文件字节已变', () => {
    const dir = fixture();
    const sums = read(dir, 'data/raw/SHA256SUMS').trimEnd().split('\n');
    const touched = sums.map((l) => (l.includes('line_gloss.tsv') ? '0'.repeat(64) + l.slice(64) : l));
    write(dir, 'data/raw/SHA256SUMS', touched.join('\n') + '\n');
    const { code, out } = runVerify(dir);
    expect(code).toBe(1);
    expect(failLines(out)).toHaveLength(1);
    expect(out).toContain('line_gloss.tsv 字节已变');
    expect(out).toContain('FAILURES: 1');
  }, 120_000);

  it('data/raw 里多出未登记的文件：判红（语料不能悄悄长出来）', () => {
    const dir = fixture();
    write(dir, 'data/raw/未登记探测.txt', '这一行不是语料，是夹具。\n');
    const { code, out } = runVerify(dir);
    expect(code).toBe(1);
    expect(failLines(out)).toHaveLength(1);
    expect(out).toContain('未登记探测.txt 未登记');
    expect(out).toContain('FAILURES: 1');
  }, 120_000);

  it('判定表改了但没重建：判红，并说明 src/data 不是当前判定的产物', () => {
    const dir = fixture();
    write(dir, 'data/raw/l0-verdicts.txt', read(dir, 'data/raw/l0-verdicts.txt').trimEnd() + '\n# 探测用附加行\n');
    const { code, out } = runVerify(dir);
    expect(code).toBe(1);
    expect(failLines(out)).toHaveLength(1);
    expect(out).toContain('判定文本与构建时一致');
    expect(out).toContain('表已改动但没重跑 build:data');
    expect(out).toContain('FAILURES: 1');
  }, 120_000);

  it('保留里塞一个虚词或字表外的字：构建阶段就地拦住，不让没人判过的字进白名单', () => {
    const dir = fixture();
    const lines = read(dir, 'data/raw/l0-verdicts.txt').trimEnd().split('\n');
    const out = lines.map((l) => (l.startsWith('保留=') ? l + '兮' : l)); // 兮 是虚词闸门里的字
    write(dir, 'data/raw/l0-verdicts.txt', out.join('\n') + '\n');
    // 判定表不进上游指纹（它是判定结果，不是外部语料），所以这里不需要动 SHA256SUMS。
    // 门禁是「构建脚本自己拒绝写出产物」，不是一条 FAIL 计数：白名单准入放宽到一二三级字表之后，
    // 闸门本身必须还能判红，否则放宽就变成没有闸门。
    const b = runBuild(dir);
    expect(b.code).not.toBe(0);
    expect(b.out).toContain('不该进白名单的字');
  }, 120_000);

  it('白名单少一个字且清单已同步：判定与产物对不上就判红（判定表改了必须重跑构建）', () => {
    const dir = fixture();
    const lines = read(dir, 'data/raw/l0-verdicts.txt').trimEnd().split('\n');
    const out = lines.map((l) => (l.startsWith('保留=') ? '保留=' + l.slice(3, -1) : l));
    write(dir, 'data/raw/l0-verdicts.txt', out.join('\n') + '\n');
    const r = runVerify(dir);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('判定文本与构建时一致');
  }, 120_000);

  it('自撰今译的文本改动不会被判红（门禁锁的是覆盖与一致性，不是译文措辞）', () => {
    const dir = fixture();
    const lines = read(dir, 'data/raw/line_gloss.tsv').split('\n');
    const i = lines.findIndex((l) => l.trim() && !l.startsWith('#'));
    lines[i] = lines[i] + '（探测改动）';
    write(dir, 'data/raw/line_gloss.tsv', lines.join('\n'));
    refreshSum(dir, 'line_gloss.tsv');
    const { code, out } = runVerify(dir);
    expect(out).toContain('ALL PASS');
    expect(code).toBe(0);
  }, 120_000);

  it('给「只出现在别处出处」的句子补一行今译：构建照收、译文进包、门禁不判红', () => {
    const dir = fixture();
    const src0 = JSON.parse(read(dir, 'src/data/sources.json'));
    const cand0 = JSON.parse(read(dir, 'src/data/candidates.json'));
    const mainLines = new Set(cand0.map((c) => c.li));
    const altOnly = src0.lines.filter((_, i) => !mainLines.has(i));
    expect(altOnly.length, '夹具里必须有只为 alternates 存在的原句').toBeGreaterThan(0);
    // 0.16.0 起这一批也全带今译了，所以夹具自己先把某一句的译文摘掉，再按标准补法加回去
    const withGloss = altOnly.find((l) => typeof l === 'object' && l !== null && l.g >= 0);
    expect(withGloss, '夹具里必须有一句只为 alternates 存在且带今译').toBeTruthy();
    const target = withGloss.s;
    const tsvLines = read(dir, 'data/raw/line_gloss.tsv').trimEnd().split('\n');
    const row = tsvLines.find((l) => l.split('\t')[0] === target);
    expect(row, '夹具里这一句必须真有今译行').toBeTruthy();
    write(dir, 'data/raw/line_gloss.tsv', tsvLines.filter((l) => l !== row).join('\n') + '\n');
    refreshSum(dir, 'line_gloss.tsv');
    expect(runBuild(dir).code, '摘掉一行后构建必须仍然收').toBe(0);
    const srcMid = JSON.parse(read(dir, 'src/data/sources.json'));
    const mid = srcMid.lines[src0.lines.indexOf(withGloss)];
    expect(typeof mid === 'string', '摘掉译文后这句应回到「没有今译」的形状').toBe(true);
    const metaMid = JSON.parse(read(dir, 'src/data/meta.json'));
    expect(metaMid.gloss_gap_items, '别处出处那一头的缺口不记在主出处那本账上').toBe(0);
    // 补法照既有口径：加一行「原句 TAB 今译」，重跑构建即进包
    write(
      dir,
      'data/raw/line_gloss.tsv',
      read(dir, 'data/raw/line_gloss.tsv').trimEnd() + `\n${target}\t这一句补上的今译\n`,
    );
    refreshSum(dir, 'line_gloss.tsv');
    const { code, out } = runVerify(dir);
    expect(out, out.slice(-700)).toContain('ALL PASS');
    expect(code, out.slice(-700)).toBe(0);
    const src1 = JSON.parse(read(dir, 'src/data/sources.json'));
    const found = src1.lines.find((l) => (typeof l === 'string' ? l : l.s) === target);
    expect(typeof found === 'object' && found !== null && found.g >= 0, '补的译文必须挂进原句表').toBe(true);
    const gloss = JSON.parse(read(dir, 'src/data/line_gloss.json'));
    expect(gloss[found.g]).toBe('这一句补上的今译');
    const meta1 = JSON.parse(read(dir, 'src/data/meta.json'));
    expect(meta1.gloss_lines, 'meta 记的今译条数必须是补完之后的数').toBe(gloss.length);
  }, 120_000);

  it('名句层的判据被改坏成人手一份：门禁从语料重算，判红而不是读回产物里记的数', () => {
    const dir = fixture();
    const script = read(dir, 'scripts/build-data.mjs');
    const tampered = script.replace(
      'const isFamous = (name) => (adjacent.get(name) ?? 0) >= famousThreshold;',
      'const isFamous = () => true; // 探测：名句分人手一份',
    );
    expect(tampered, '夹具必须确实改到那一条判据').not.toBe(script);
    write(dir, 'scripts/build-data.mjs', tampered);
    // 构建脚本自己会照改坏的判据重算 meta.pool_famous，产物内部照样自洽；
    // 拦得住它的是 verify 4g 那份从 data/raw 独立重算的阈值与逐条判定。
    const { code, out } = runVerify(dir);
    expect(code).toBe(1);
    expect(failLines(out).length).toBeGreaterThan(0);
    expect(out).toContain('名句层 famous');
    expect(out).toContain('FAILURES:');
  }, 120_000);

  it('alternates 判定被改坏（每条只留主出处）：门禁从语料独立重算判红，而不是读回产物里记的数', () => {
    const dir = fixture();
    const script = read(dir, 'scripts/build-data.mjs');
    const tampered = script.replace(
      'alts: (footAll.get(name)?.list ?? []).filter((o) => o !== v),',
      'alts: [], // 探测：把「另有几处出处」这条判定改坏，只留主出处',
    );
    expect(tampered, '夹具必须确实改到那一条判定').not.toBe(script);
    write(dir, 'scripts/build-data.mjs', tampered);
    // 0.16.0 起别处出处的句子也全带今译，所以这一发探测先撞构建自己的守卫：
    // alternates 一空，那 986 句今译就没人用了，构建直接报错退出。这条先记下来。
    const built = runBuild(dir);
    expect(built.code, '把 alternates 判定改坏后，构建自己就该发现那批今译没人用了').toBe(1);
    expect(built.out).toContain('条释义没有对应原句');
    // 再连那批今译一起摘掉，让这一发探测能走到 verify 4h 那份从 data/raw 独立重算的逐条比对。
    const src0 = JSON.parse(read(dir, 'src/data/sources.json'));
    const cand0 = JSON.parse(read(dir, 'src/data/candidates.json'));
    const primaryLines = new Set(cand0.map((c) => c.li));
    const altOnly = new Set(
      src0.lines.filter((_, i) => !primaryLines.has(i)).map((l) => (typeof l === 'string' ? l : l.s)),
    );
    const tsvAll = read(dir, 'data/raw/line_gloss.tsv').trimEnd().split('\n');
    const tsvKept = tsvAll.filter((l) => !altOnly.has(l.split('\t')[0]));
    expect(tsvAll.length - tsvKept.length, '夹具摘掉的必须正好是只为别处出处存在的那批今译').toBe(altOnly.size);
    write(dir, 'data/raw/line_gloss.tsv', tsvKept.join('\n') + '\n');
    refreshSum(dir, 'line_gloss.tsv');
    expect(runBuild(dir).code, '摘干净之后构建必须收').toBe(0);
    // 构建脚本自己那套 meta.alt_total 计数照旧在数，产物内部也自洽；
    // 拦得住它的是 verify 4h 那份从 data/raw 独立重算的逐条比对。
    const { code, out } = runVerify(dir);
    expect(code).toBe(1);
    expect(failLines(out).length).toBeGreaterThan(0);
    expect(out).toContain('多出处 alternates');
    expect(out).toContain('alternates 总数 > 0');
    expect(out).toContain('处数对不上');
    expect(out).toContain('FAILURES:');
  }, 120_000);

  it('alternates 的取词下标被挪动一位：门禁逐条咬住「没指到那两个字的这对位置」', () => {
    const dir = fixture();
    const script = read(dir, 'scripts/build-data.mjs');
    const tampered = script.replace(
      'flat.push(altTitleSlot(a), li - prevLi, a.pa, a.pb - a.pa);',
      'flat.push(altTitleSlot(a), li - prevLi, a.pa + 1, a.pb - a.pa);',
    );
    expect(tampered, '夹具必须确实改到那一条编码').not.toBe(script);
    write(dir, 'scripts/build-data.mjs', tampered);
    const { code, out } = runVerify(dir);
    expect(code).toBe(1);
    expect(failLines(out).length).toBeGreaterThan(0);
    expect(out).toContain('多出处 alternates');
    expect(out).toContain('FAILURES:');
  }, 120_000);

  it('恒假的可选字段被写回产物（risk:null / redup:false / famous:false）：4i 判红，产物形状与声明不许分叉', () => {
    const dir = fixture();
    const script = read(dir, 'scripts/build-data.mjs');
    const tampered = script.replace(
      'if (v === undefined || v === null || v === false) continue;',
      'if (v === undefined) continue; // 探测：把恒假的键照旧写进产物',
    );
    expect(tampered, '夹具必须确实改到那一条落键规则').not.toBe(script);
    write(dir, 'scripts/build-data.mjs', tampered);
    const { code, out } = runVerify(dir);
    expect(code).toBe(1);
    expect(failLines(out).length).toBeGreaterThan(0);
    expect(out).toContain('恒假的可选字段一律不落键');
    expect(out).toContain('risk:null');
    expect(out).toContain('FAILURES:');
    // 夹具自己那一份产物确实被改回了恒假键：判红不是发生在「脚本没跑起来」这一头
    const cand = JSON.parse(read(dir, 'src/data/candidates.json'));
    expect(
      cand.some((c) => c.risk === null || c.redup === false || c.famous === false),
      '夹具必须真写出恒假键',
    ).toBe(true);
  }, 120_000);
});

afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});
