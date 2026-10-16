// L0 候选字解锁量实测：按「真实边际增量」贪心给候选字排序，并算出保留前 N 行时的准确双名池规模。
// 口径与 build-data 完全一致（六本、音步起点、同句读内间隔≤3、虚词/忌讳/高频/现代成词四道减法、叠词粘连与假叠字剔除）。
// 配对按「有几个字不在种子表内」分类：0 个已在池、1 个选中该字即得（含两字相同的自配）、2 个要两字都选中才得。
// 早期版本只统计新字×种子字，把四万多条新×新漏在账外，累计池系统性偏低。
// node scripts/l0-unlock.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NAME_NOISE } from './name-noise.mjs';

const RAW = 'data/raw';
const NOT_CJK = /[^一-鿿]/g;
const read = (p) => fs.readFileSync(path.join(RAW, p), 'utf-8');
const json = (p) => JSON.parse(read(p));
const loadCharList = (p) => read(p).split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => { const q = l.split(/\s+/); return q.length === 2 && /^\d+$/.test(q[0]) ? q[1] : l; });

const WH1 = new Set(loadCharList('gsc_level_1.txt'));
const WH123 = new Set([...WH1, ...new Set(loadCharList('gsc_level_2.txt')), ...new Set(loadCharList('gsc_level_3.txt'))]);
const XUCI = new Set('兮之以太其于而则且亦何斯夫惟维矣乎焉哉也矣耶欤矣噫只且'.split(''));
const FUNC = new Set('的了是在有他不这我都还说法把让向对为等与就只很更最些什么样怎么如果但是因为所以而且并且或者被它你们我们他们它们有个之以及然而则即便共'.split(''));
const XU = new Set([...XUCI, ...FUNC]);
const NOISE = new Set(NAME_NOISE);
const BAD = new Set('胸鬼懒禽鸟鸡我邪罪凶丑仇鼠蟋蟀淫秽妹狐鸭蝇悔鱼肉苦犬吠窥血丧饥搔父母昏狗蟊疾病痛死潦哀痒害蛇牲妇狸鹅穴畜烂兽靡爪氓劫鬣婚姻匪婆羞辱'.split('').filter((c) => WH1.has(c)));
const wf = new Map();
for (const line of read('jieba_dict.txt').split('\n')) { const p = line.split(' '); if (p.length >= 3) wf.set(p[0], Number(p[1])); }
const ad = json('cnname_attributes.json'); const attrDict = ad.dict ?? ad;
const SEED = new Set([...new Set(Object.values(attrDict).filter((v) => typeof v === 'string').join('').split(''))].filter((c) => WH123.has(c)));
// 与 build-data 同源：当前 L0 还包含人工过字「保留」的字，否则与 meta.pool_B 对不上。
const VERDICT_FILE = path.join(RAW, 'l0-verdicts.txt');
if (fs.existsSync(VERDICT_FILE)) {
  const m = fs.readFileSync(VERDICT_FILE, 'utf8').match(/^保留=([\s\S]*?)(?=\n(?=#|保留=|剔除=|待判=|预计)|$)/m);
  if (m) for (const c of m[1].replace(/[^一-鿿]/g, '')) SEED.add(c);
}

const BOOKS = [
  { key: 'shijing', strictMeter: true }, { key: 'chuci', strictMeter: 'chuci' },
  { key: 'lunyu', strictMeter: false }, { key: 'shuimo', strictMeter: true },
  { key: 'song300', strictMeter: false }, { key: 'daofa', strictMeter: false },
];
const offsets = (book, n) => {
  if (book === 'shijing' || book === 'shuimo') return ({ 4: [0, 2], 5: [0, 2], 7: [0, 2, 4] })[n] ?? [...Array(n - 1).keys()];
  if (book === 'chuci') return ({ 4: [0, 2], 5: [0, 3], 7: [0, 2, 4] })[n] ?? [...Array(n - 1).keys()];
  return [...Array(n - 1).keys()];
};
const SPLIT = /[。！？；]/, COMMA = /[，、：]/;
const inRedup = (cs, i) => (i > 0 && cs[i - 1] === cs[i]) || (i < cs.length - 1 && cs[i + 1] === cs[i]);
function rawText(book) {
  const j = json(`${book}.json`);
  if (book === 'lunyu') return j.flatMap((ch) => ch.paragraphs);
  if (book === 'shuimo') return j.map((po) => po.paragraphs.join('，'));
  if (book === 'song300') return j.map((po) => (po.paragraphs ?? []).join('，'));
  if (book === 'daofa') return j.map((po) => (po.content ?? []).join('。'));
  return j.map((po) => (po.content ?? []).join('，'));
}

const units = [];
const charFoot = new Map(); // 典籍里作为音步起点出现的次数
const charAny = new Map();  // 典籍里任意位置出现次数
for (const { key: book } of BOOKS) {
  for (const text of rawText(book)) {
    for (const line of String(text).split(SPLIT)) {
      const t = line.trim(); if (!t) continue;
      for (const u of t.split(COMMA)) {
        const cleaned = u.replace(/[“”‘’「」《》（）()]/g, '').trim(); if (!cleaned) continue;
        for (const seg of cleaned.replace(NOT_CJK, '').split('兮')) {
          if (seg.length < 2) continue;
          const cs = [...seg];
          const offs = offsets(book, cs.length);
          units.push({ book, seg, cs, offs });
          for (let k = 0; k < cs.length; k++) {
            charAny.set(cs[k], (charAny.get(cs[k]) ?? 0) + 1);
            if (offs.includes(k)) charFoot.set(cs[k], (charFoot.get(cs[k]) ?? 0) + 1);
          }
        }
      }
    }
  }
}

// 定稿口径下的「干净出现」与「只以粘连/假叠字身份出现」两个集合
const clean = new Set(), dirty = new Set();
for (const u of units) {
  for (const i of u.offs) {
    for (let gap = 1; gap <= 3; gap++) {
      const j = i + gap; if (j >= u.cs.length) break;
      const p = u.cs[i] + u.cs[j];
      const okChars = [...p].every((c) => WH123.has(c)) && ![...p].some((c) => XU.has(c) || BAD.has(c)) && !NOISE.has(p) && (wf.get(p) ?? 0) < 5000;
      if (!okChars) continue;
      const glue = gap > 1 && (inRedup(u.cs, i) || inRedup(u.cs, j));
      const fake = p[0] === p[1] && gap > 1;
      (glue || fake ? dirty : clean).add(p);
    }
  }
}
for (const p of clean) dirty.delete(p);

const inPool = (L0) => [...clean].filter((p) => [...p].every((c) => L0.has(c)));
const base = new Set(inPool(SEED));
const meta = JSON.parse(fs.readFileSync('src/data/meta.json', 'utf8'));
if (base.size !== meta.pool_B) { console.error(`口径漂移：本脚本算出 ${base.size} 条，build-data 报 ${meta.pool_B} 条——两边规则不一致，表里的解锁数不可用`); process.exit(1); }
console.log(`六本句读单元 ${units.length}｜clean 配对（通用规范字表内）${clean.size}｜种子 L0 ${SEED.size} 字 → 池 ${base.size} 条（与 build-data 一致 ✓）`);

// 精确池模型：把每个 clean 配对按「有几个字不在种子表内」分类。
// 0 个→已在 base；1 个→选中那个字就到手（含两字相同的自配）；2 个→两个字都选中才到手。
// 之前只算「新字×种子字」，系统性低估——两字皆新的配对有 4 万多条，选了 50 个字就会开始互相配对。
const onePairs = new Map(); // char -> 该字单独入表即解锁的配对
const adj = new Map();      // char -> [{d, p}] 两字皆新的边（双向）
for (const p of clean) {
  const a = p[0], b = p[1];
  const sa = SEED.has(a), sb = SEED.has(b);
  if (sa && sb) continue;
  const addOne = (c) => { if (!onePairs.has(c)) onePairs.set(c, []); onePairs.get(c).push(p); };
  const addEdge = (c, d) => { if (!adj.has(c)) adj.set(c, []); adj.get(c).push({ d, p }); };
  if (a === b) { addOne(a); continue; }
  if (sa !== sb) { addOne(sa ? b : a); continue; }
  addEdge(a, b); addEdge(b, a);
}
let bothNew = 0;
for (const p of clean) { if (!SEED.has(p[0]) && !SEED.has(p[1])) bothNew++; }
const candChars = [...new Set([...onePairs.keys(), ...adj.keys()])].filter((c) => WH1.has(c));

// 贪心：每一步选「真实边际增量最大」的字。增量＝它单独解锁的配对 + 与已选字互相配到的新×新配对。
const chosen = new Set();
const ready = new Map(); // char -> 与已选字之间已就绪的配对数
const ranked = [];
let pool = base.size;
for (;;) {
  let best = null;
  for (const c of candChars) {
    if (chosen.has(c)) continue;
    const gain = (onePairs.get(c)?.length ?? 0) + (ready.get(c) ?? 0);
    if (gain <= 0) continue;
    if (!best || gain > best.gain || (gain === best.gain && (charFoot.get(c) ?? 0) > (charFoot.get(best.c) ?? 0))
      || (gain === best.gain && (charFoot.get(c) ?? 0) === (charFoot.get(best.c) ?? 0) && c < best.c)) best = { c, gain };
  }
  if (!best) break;
  chosen.add(best.c);
  const brought = [...(onePairs.get(best.c) ?? [])];
  for (const { d, p } of adj.get(best.c) ?? []) {
    if (chosen.has(d)) { if (!brought.includes(p)) brought.push(p); }
    else ready.set(d, (ready.get(d) ?? 0) + 1);
  }
  pool += best.gain;
  ranked.push({ c: best.c, gain: best.gain, size: pool, brought });
}
console.log(`候选字 ${candChars.length} 个（其中 ${ranked.length} 个能带来新增配对）｜两字皆新的配对 ${bothNew} 条（要两个字同时入表才拿得到）\n`);
console.log('按「真实边际增量」贪心依次加字后的累计池（＝该前缀全部保留时的双名条数）：');
for (const n of [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 300]) {
  const t = ranked[n - 1];
  if (t) console.log(`  加 ${String(n).padStart(3)} 字 → ${String(t.size).padStart(5)} 条（最后一个字：${t.c}，本字带来 ${t.gain} 条）`);
}
const need = (target) => { const i = ranked.findIndex((t) => t.size >= target); return i < 0 ? null : i + 1; };
for (const tg of [600, 800, 1000, 1500, 2000, 3000]) {
  const n = need(tg);
  console.log(`过 ${tg} 条需要加 ${n === null ? '—（达不到）' : n} 个字`);
}
console.log('\n真实边际 Top 40（字 / 本字增量 / 累计池 / 典籍音步起点次数 / jieba 单字频 / 样例）：');
for (const r of ranked.slice(0, 40)) {
  console.log(`  ${r.c}  +${String(r.gain).padStart(4)}｜累计 ${r.size}｜音步 ${charFoot.get(r.c) ?? 0}｜字频 ${wf.get(r.c) ?? 0}｜${r.brought.slice(0, 8).join(' ')}`);
}
console.log('\n第 41-120 名：');
for (const r of ranked.slice(40, 120)) {
  console.log(`  ${r.c}  +${String(r.gain).padStart(4)}｜累计 ${r.size}｜音步 ${charFoot.get(r.c) ?? 0}｜字频 ${wf.get(r.c) ?? 0}｜${r.brought.slice(0, 6).join(' ')}`);
}

// ---- 交付物：候选字待审表（人工逐字判定用）。数据全部来自上面的实测，不另立口径。 ----
const RADICAL = JSON.parse(fs.readFileSync('src/data/radical.json', 'utf8'));
const TOP = 150;
const top = ranked.slice(0, TOP);
const rows = top.map((r) => ({
  c: r.c, gain: r.gain, one: (onePairs.get(r.c) ?? []).length, pairs: r.brought.slice(0, 20),
  foot: charFoot.get(r.c) ?? 0, any: charAny.get(r.c) ?? 0, wf: wf.get(r.c) ?? 0, el: RADICAL[r.c] ?? '',
}));
const cum = top.map((r) => r.size);
// 表内字两两互相配到的「新×新」边：页面上的实时池要靠它才算准（表外的字这张表给不了，不计）
const idx = new Map(top.map((r, i) => [r.c, i]));
const edges = [];
top.forEach((r, i) => {
  const byOther = new Map();
  for (const { d } of adj.get(r.c) ?? []) if (idx.has(d) && idx.get(d) > i) byOther.set(d, (byOther.get(d) ?? 0) + 1);
  for (const [d, n] of byOther) edges.push([i, idx.get(d), n]);
});
const needAt = (target) => { const i = cum.findIndex((s) => s >= target); return i < 0 ? null : i + 1; };
const need1000 = needAt(1000);
const need2900 = needAt(2900);
// 单名层：白名单里能在双名池中出现过的字才有出处（与 build-data 同口径），按前缀规模算给它两个里程碑数
const edgeList = [];
for (const r of top) for (const { d, p } of adj.get(r.c) ?? []) if (!SEED.has(d)) edgeList.push([r.c, d, p]);
const poolPairsAt = (n) => {
  const W = new Set([...SEED, ...top.slice(0, n).map((r) => r.c)]);
  const got = new Set(base);
  for (const r of top.slice(0, n)) for (const p of onePairs.get(r.c) ?? []) got.add(p);
  for (const [a, b, p] of edgeList) if (W.has(a) && W.has(b)) got.add(p);
  return got;
};
const singlesAt = (n) => { const s = new Set(); for (const p of poolPairsAt(n)) { s.add(p[0]); s.add(p[1]); } return s.size; };
const s1000 = need1000 ? singlesAt(need1000) : 0;
const s2900 = need2900 ? singlesAt(need2900) : 0;
for (const n of [10, 30, 50, 100, 150]) {
  if (n > top.length) continue;
  const re = poolPairsAt(n).size;
  if (re !== cum[n - 1]) { console.error(`内部不一致：贪心算到第 ${n} 字是 ${cum[n - 1]} 条，按集合重算是 ${re} 条`); process.exit(1); }
}
console.log(`\n里程碑（按本表顺序保留前 N 行）：前 ${need1000} 行→双名 ${cum[need1000 - 1]}＋单名 ${s1000}＝${cum[need1000 - 1] + s1000} 个名；前 ${need2900} 行→双名 ${cum[need2900 - 1]}＋单名 ${s2900}＝${cum[need2900 - 1] + s2900} 个名`);
console.log('（贪心累计与按集合重算在两处交叉一致：前 10/30/50/100/150 行 ✓）');
const topChars = top.slice(0, 8).map((r) => r.c).join(' / ');
const samplePairs = top.slice(0, 6).map((r) => `<span>${r.brought[0]}</span>`).join('');
const data = JSON.stringify({ base: base.size, bothNew, need1000, need2900, s1000, s2900, singlesBase: meta.singles, rows, cum, edges });
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>L0 候选字待审表</title>
<style>
 body{font-family:ui-sans-serif,system-ui,"Noto Sans SC",sans-serif;margin:0;background:#fafaf9;color:#171717}
 main{max-width:1180px;margin:0 auto;padding:24px 20px 80px}
 h1{font-size:22px;margin:0 0 4px} .sub{font-size:13px;color:#525252;line-height:1.8}
 .warn{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.9;margin:16px 0}
 .bar{position:sticky;top:0;background:#fafaf9ee;border-bottom:1px solid #e5e5e5;padding:10px 0;margin-bottom:10px;
      display:flex;flex-wrap:wrap;gap:10px;align-items:center;backdrop-filter:blur(4px)}
 .bar b{font-variant-numeric:tabular-nums}
 button{font:inherit;font-size:13px;border:1px solid #d4d4d4;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer}
 button:hover{background:#f5f5f5}
 table{border-collapse:collapse;width:100%;font-size:13px}
 th{position:sticky;top:52px;background:#f5f5f5;text-align:left;padding:7px 8px;font-weight:600;border-bottom:1px solid #e5e5e5;white-space:nowrap}
 td{padding:6px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top}
 tr:hover td{background:#fffdf5}
 .zi{font-family:ui-serif,Georgia,"Songti SC",serif;font-size:24px;line-height:1;cursor:pointer;user-select:none}
 .num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
 .eg{color:#404040;line-height:1.7} .eg span{display:inline-block;background:#f5f5f5;border-radius:4px;padding:1px 5px;margin:1px 3px 1px 0}
 .el{display:inline-block;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:4px;padding:1px 5px;font-size:12px;color:#065f46}
 select{font:inherit;font-size:12px;padding:3px 4px;border:1px solid #d4d4d4;border-radius:5px;background:#fff}
 .keep td{background:#f0fdf4} .drop td{background:#fef2f2;color:#a3a3a3} .drop .eg{visibility:hidden}
 .mark td{background:#eef2ff;color:#3730a3;font-size:12px;padding:5px 8px;border-bottom:1px solid #c7d2fe;font-weight:600}
 textarea{width:100%;height:110px;font-family:ui-monospace,monospace;font-size:12px;margin-top:8px;display:none}
 .hint{font-size:12px;color:#737373;margin-top:6px;line-height:1.8}
</style></head><body><main>
 <h1>L0 候选字待审表——加哪些字进名用字白名单</h1>
 <div class="sub">当前 L0 种子 ${SEED.size} 字 · 双名池 ${base.size} 条 · 单名 ${meta.singles} 条 · 合计 ${base.size + meta.singles} 个可用名。
 表里是前 ${TOP} 个候选字（一级字表内、非虚词、非忌讳），按<b>真实边际增量</b>从大到小排：「本字新增」＝在它上面那些字都已保留的前提下，这一个字能多带来多少条双名（含「两个新字互相配对」那部分，旧版只算「新字×种子字」，会低估）。</div>
 <div class="warn"><b>先看这条再动手：</b>按这个顺序从上往下保留，判到第 <b>${need1000} 行</b>双名破 1,000，判到第 <b>${need2900} 行</b>约 2,900 条。
 榜首八个字是 ${topChars}，它们各自头一条新名字是 <span class="eg">${samplePairs}</span>。
 <br>增量高只说明<b>这个字在典籍里挨着的字多</b>，不说明它拼出来的名字能用。所以这张表不是「勾到 2,900 就算达标」，而是逐字判断：
 <b>这个字进表之后，右侧它带来的名字你能不能接受？</b>
 规模从来不是瓶颈，质量才是——这也是当初黑名单路线把参照项目拖垮的同一个机制。</div>
 <div class="bar">
  已判 <b id="k">0</b> 保留 · <b id="d">0</b> 剔除 · <b id="p">${TOP}</b> 待判 ·
  预计双名池 <b id="pool">${base.size}</b> 条 · 相对现在 <b id="delta">+0</b>
  <button id="cp">复制判定结果</button><button id="rs">全部重置为待判</button>
 </div>
 <table><thead><tr>
  <th>#</th><th>字</th><th class="num">本字新增</th><th class="num">累计真池</th><th class="num">典籍音步次数</th>
  <th class="num">现代字频</th><th>部首</th><th>它带来的名字（前 12 条）</th><th>判定</th>
 </tr></thead><tbody id="tb"></tbody></table>
 <div class="hint">点字可切换 待判→保留→剔除；判定按<b>字</b>存在本机浏览器里（不按行序），重新生成这张表不会让已存的判定错位，但换电脑不带走。<br>
 「累计真池」＝这一行以上（含本行）全部保留时的双名条数；上方的实时数按你实际勾选的集合算，含「两个新字互相配对」，所以勾得不连续也准。<br>
 判完点「复制判定结果」把那一串字交回给我，我按它重建 L0、跑完整门禁、重出交付物。<br>
 另有 ${bothNew.toLocaleString()} 条配对是「两个字都不在表内」，其中另一端不在这 ${TOP} 行之内的，本表拿不到——这部分要再加字才有。</div>
 <textarea id="out" readonly></textarea>
</main>
<script>
const D=${data};
const KEY='l0-review-v2';
const tb=document.getElementById('tb');
const mk=(n,s)=>\`<tr class="mark"><td colspan="9">—— 到这里为止保留前 \${n} 行：双名约 \${D.cum[n-1].toLocaleString()} 条＋单名 \${s} 条＝\${(D.cum[n-1]+s).toLocaleString()} 个可用名 ——</td></tr>\`;
tb.innerHTML=D.rows.map((r,i)=>{
 const m=i+1===D.need1000?mk(D.need1000,D.s1000):i+1===D.need2900?mk(D.need2900,D.s2900):'';
 return \`<tr data-c="\${r.c}">
 <td class="num">\${i+1}</td>
 <td><span class="zi" title="点击切换判定">\${r.c}</span></td>
 <td class="num">+\${r.gain}</td><td class="num">\${D.cum[i].toLocaleString()}</td>
 <td class="num">\${r.foot}</td><td class="num">\${r.wf.toLocaleString()}</td>
 <td>\${r.el?\`<span class="el">\${r.el}部</span>\`:'<span style="color:#d4d4d4">—</span>'}</td>
 <td class="eg">\${r.pairs.slice(0,12).map(p=>'<span>'+p+'</span>').join('')}</td>
 <td><select class="v"><option value="">待判</option><option value="keep">保留</option><option value="drop">剔除</option></select></td>
</tr>\${m}\`;
}).join('');
let S={};
try{const v=JSON.parse(localStorage.getItem(KEY)||'{}');
 if(v&&typeof v==='object'&&!Array.isArray(v)){S=v;D.rows.forEach(r=>{const sel=tb.querySelector('tr[data-c="'+r.c+'"] .v');if(sel&&S[r.c])sel.value=S[r.c];});}}catch(_){}
const kept=()=>D.rows.map((r,i)=>S[r.c]==='keep'?i:-1).filter(i=>i>=0);
const livePool=()=>{const on=new Set(kept());let n=D.base;
 for(const i of on)n+=D.rows[i].one;
 for(const [a,b,k] of D.edges)if(on.has(a)&&on.has(b))n+=k;
 return n;};
const upd=()=>{
 const n=livePool();
 try{localStorage.setItem(KEY,JSON.stringify(S))}catch(_){}
 document.getElementById('pool').textContent=n.toLocaleString();
 document.getElementById('delta').textContent='+'+(n-D.base).toLocaleString();
 document.getElementById('k').textContent=Object.values(S).filter(x=>x==='keep').length;
 document.getElementById('d').textContent=Object.values(S).filter(x=>x==='drop').length;
 document.getElementById('p').textContent=D.rows.length-Object.keys(S).length;
 [...tb.querySelectorAll('tr[data-c]')].forEach(tr=>{const v=S[tr.dataset.c];tr.className=v==='keep'?'keep':v==='drop'?'drop':'';});
};
tb.addEventListener('change',e=>{if(e.target.classList.contains('v')){const c=e.target.closest('tr').dataset.c;const v=e.target.value;if(v)S[c]=v;else delete S[c];upd();}});
tb.addEventListener('click',e=>{if(!e.target.classList.contains('zi'))return;const c=e.target.closest('tr').dataset.c;
 S[c]=!S[c]?'keep':S[c]==='keep'?'drop':null;if(!S[c])delete S[c];
 e.target.closest('tr').querySelector('.v').value=S[c]||'';upd();});
document.getElementById('rs').onclick=()=>{S={};[...tb.querySelectorAll('.v')].forEach(s=>s.value='');upd();};
document.getElementById('cp').onclick=async()=>{
 const f=(v)=>D.rows.filter(r=>S[r.c]===v).map(r=>r.c).join('');
 const keepN=kept().length;
 const sHint=keepN===D.need2900?D.s2900:keepN===D.need1000?D.s1000:'以重建后为准';
 const t=['# L0 判定结果 v1','保留='+f('keep'),'剔除='+f('drop'),'待判='+D.rows.filter(r=>!S[r.c]).map(r=>r.c).join(''),
   '预计双名池='+livePool()+'（现在 '+D.base+'）','预计单名='+sHint].join('\\n');
 const o=document.getElementById('out');o.value=t;o.style.display='block';
 try{await navigator.clipboard.writeText(t);}catch(_){}
 o.select();
};
upd();
</script></body></html>`;
const OUTDESKTOP = path.join(process.env.HOME ?? '', 'Desktop', 'L0-候选字待审表.html');
fs.writeFileSync(OUTDESKTOP, html);
console.log(`\n待审表已写 ${OUTDESKTOP}（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB，前 ${TOP} 个候选字）`);
