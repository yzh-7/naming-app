// @vitest-environment node
// 体积门禁自身的失败路径用例。这里测的是 scripts/size-check.mjs 会不会真的判红，
// 不是仓库当前产物的体积（那条由门禁本身在构建时把）。
// 夹具用固定种子的伪随机字节：不可压缩，gzip 后与原始大小几乎等值，
// 于是「超限」在各台机器上都能复现，不依赖某份真实产物的巧合。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const SCRIPT = path.join(REPO, 'scripts', 'size-check.mjs');
// 与 scripts/size-check.mjs 里的常量同口径；数值断言同时把文档里的预算锁在这里。
const ASSET_BUDGET = 409_600;
const SHELL_BUDGET = 409_600;
const SINGLE_BUDGET = 460_800;

let tmp = '';

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'size-gate-'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// xorshift32：确定性不可压缩字节源。
function noise(bytes, seed = 0x9e3779b9) {
  const buf = Buffer.allocUnsafe(bytes);
  let x = seed >>> 0;
  for (let i = 0; i < bytes; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    buf[i] = x & 0xff;
  }
  return buf;
}

function fixture(name, files) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function runSizeCheck(dir, ...flags) {
  const r = spawnSync(process.execPath, [SCRIPT, dir, ...flags], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('size-check 门禁的失败路径', () => {
  it('夹具在预算内时判绿，并把两条预算与余量都打出来', () => {
    const dir = fixture('pass', {
      'index.html': noise(1024),
      'assets/app.js': noise(60_000),
      'assets/data.js': noise(30_000),
    });
    const { code, out } = runSizeCheck(dir);
    expect(out).toContain('资源合计');
    expect(out).toContain(`预算 ${ASSET_BUDGET} B`);
    expect(out).toContain(`预算 ${SHELL_BUDGET} B`);
    expect(out).toContain('PASS');
    expect(code).toBe(0);
  });

  it('非 HTML 资源合计超预算时判红，余量为负也照样打出来', () => {
    const dir = fixture('asset-over', {
      'index.html': noise(1024),
      'assets/data.js': noise(ASSET_BUDGET + 60_000),
    });
    const { code, out } = runSizeCheck(dir);
    expect(code).toBe(1);
    expect(out).toMatch(/资源合计 \d+ B gz（预算 409600 B）→ FAIL/);
  });

  it('HTML 超页面壳预算但未超单文件预算：不带 --single 判红，带 --single 判绿', () => {
    // 夹具落在两个预算之间：409,600 < gz < 460,800，
    // 用来证明脚本按参数声明的口径判定，而不是按产物大小自己猜形态。
    const html = noise(430_000);
    const dir = fixture('html-between-budgets', { 'index.html': html, 'assets/app.js': noise(1024) });
    const shell = runSizeCheck(dir);
    expect(shell.code).toBe(1);
    expect(shell.out).toContain('FAIL');
    expect(shell.out).toContain('站点 HTML 壳');
    expect(shell.out).toContain(`预算 ${SHELL_BUDGET} B`);
    const single = runSizeCheck(dir, '--single');
    expect(single.out).toContain('单文件产物 index.html');
    expect(single.out).toContain(`预算 ${SINGLE_BUDGET} B`);
    expect(single.code).toBe(0);
  });

  it('单文件形态下资源合计那条仍然生效（换了口径不等于取消门禁）', () => {
    const dir = fixture('single-asset-over', {
      'index.html': noise(2048),
      'assets/big.js': noise(ASSET_BUDGET + 40_000),
    });
    const { code, out } = runSizeCheck(dir, '--single');
    expect(code).toBe(1);
    expect(out).toContain('资源合计');
    expect(out).toContain('FAIL');
  });

  it('SVG 与 .txt 不计入资源合计（它们不是首屏要下载的包）', () => {
    const heavy = noise(ASSET_BUDGET + 40_000);
    const asSvg = fixture('svg-excluded', {
      'index.html': noise(1024),
      'icon.svg': heavy,
      'assets.txt': heavy,
    });
    expect(runSizeCheck(asSvg).code).toBe(0);
    // 同样的字节数换成 .js 就应当判红：证明排除是按后缀，不是恰好没数到
    const asJs = fixture('svg-included-as-js', {
      'index.html': noise(1024),
      'icon.js': heavy,
      'extra.js': heavy,
    });
    expect(runSizeCheck(asJs).code).toBe(1);
  });

  it('夹具里没有 HTML 时只判资源那条，HTML 那条整行不打印', () => {
    const dir = fixture('no-html', { 'assets/app.js': noise(4096) });
    const { code, out } = runSizeCheck(dir);
    // 记录这条口径：入口文件是否存在不由体积门禁负责（vite 构建与 e2e 才管这件事），
    // 所以脚本对「没有 HTML」既不判红也不打印 HTML 那一行。
    expect(code).toBe(0);
    expect(out).toMatch(/资源合计 \d+ B gz（预算 409600 B）→ PASS/);
    expect(out).not.toContain('HTML 壳');
  });
});
