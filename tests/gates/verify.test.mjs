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

  it('白名单少一个字且清单已同步：构建阶段就地拦住，不让残缺语料进产物', () => {
    const dir = fixture();
    const lines = read(dir, 'data/raw/l0-verdicts.txt').trimEnd().split('\n');
    let moved = '';
    const out = lines.map((l) => {
      if (l.startsWith('保留=')) {
        const keep = l.slice(3);
        moved = keep.at(-1) ?? '';
        return '保留=' + keep.slice(0, -1);
      }
      if (l.startsWith('剔除=')) return '剔除=' + moved;
      return l;
    });
    write(dir, 'data/raw/l0-verdicts.txt', out.join('\n') + '\n');
    // 判定表不进上游指纹（它是判定结果，不是外部语料），所以这里不需要动 SHA256SUMS。
    const r = runVerify(dir);
    expect(r.code).not.toBe(0);
    // 门禁在这里是「构建脚本自己拒绝写出产物」，不是一条 FAIL 计数；
    // 移出幽之后，17 条含幽今译在放行后的原句里找不到出处。
    expect(r.out).toContain('没有对应原句');
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
});

afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});
