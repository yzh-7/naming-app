# 设计说明

面向维护者。README 讲「是什么」和「怎么用」，这里讲「怎么搭起来、边界在哪、改东西要动哪儿」。

## 1. 数据管线

一次性：`scripts/derive-dict.mjs`（读 `UP_DIR`，默认 `/tmp/opencode`）从上游词典与姓名语料裁出三份精简输入：

- `data/raw/dict_shape.json` — 每字的笔画与结构代码（D 独体 / A 品字 / B 上下 / E 上中下 / H 左右 / M 左中右 / Q 全包围 / R 半包围）。
- `data/raw/dict_gloss.json` — 每字本义（优先 `本义:`，截断 28 字）。
- `data/raw/name_given_freq.json` — 名部（名字第二字）用字频次，共 2240 字。

三份新原始文件都已登记进 `data/raw/SHA256SUMS`。

出处今译 `data/raw/line_gloss.tsv` 是**本项目自撰**（1123 行「原句\t释义」，与候选/单字的原句逐条对应），不引入古诗文网、程俊英等任何现代整理本的注释或译文；许可说明见 `data/raw/LICENSES.md`。构建期按「候选 → 单字」首次出现顺序编号，条目加 `lg` 下标，另出 `src/data/line_gloss.json`（纯字符串数组，同一句只存一份）。缺一条、多一条、原句重复都会在构建期直接失败。

每次构建：`scripts/build-data.mjs` → `src/data/*.json`。这是**唯一**的正式数据来源，`src/data/` 下的文件都是产物，不要手改。

### 主池口径（Pool-B）

1. 六本典籍原文 → 按 `。！？；` 分句、`，、：` 分句读、去标点。
2. 取字对：第一字落在**音步起点**（依诗体定 offset），第二字在同句读内、间隔 ≤3 字；相邻重复字（叠字装置）与假叠字剔除。
3. 两道减法：两字都须在 **L0 名用字白名单**内；排除虚词、忌讳字、现代高频成词（jieba 词频 ≥5000）、以及噪声词。

结果：`pool_B = 1505` 条双名（`by_gap` 720/464/321），单字名 216 个，整体数据 gzip ≈ 257 KB（含 1123 条出处今译约 30 KB）。

### L0 白名单

种子 = `cnname_attributes.json` 全部用字 ∩ 通用规范汉字表（WH123）= 268 字；再并入 `data/raw/l0-verdicts.txt` 里人工过字「保留」的 25 字 = **293 字**。`verify.mjs` 校验账目（`L0_size = L0_seed + L0_added`）与判定文本指纹。要扩表：跑 `node scripts/l0-unlock.mjs` 生成待审表，勾选后把结果写回 `l0-verdicts.txt`，再 `npm run build`。

## 2. 引擎（`src/engine/name.ts`）

纯函数，无副作用，输入 `Opts` 输出 `Result[]`。

- `universe(opts)`：按书籍/性别/**字形（`passesShape`）**/叠字/搜索过滤候选空间。
- `passesShape(name, opts)`：可核对事实类筛选——`strokeMax`（整名笔画上限，0=不限）、`popFloor`（逐字常见度下限，用 `minGnOf`）、`noMonotone`（排除两字同结构）。选项档位见 `types.ts` 的 `STROKE_MAXES` / `POP_FLOORS`。
- `plan(surname, opts, batch, reading)`：分页取一批，按 `opts.sort` 排序（score/strokes/popular/book）；仅 score/book 时按书分组展示，strokes/popular 保持所选顺序。
- 打分：音韵（声调/声母/多音）、谐音避讳、字频、性别风格等。
- 展示层：`glossOf`、`lineGlossOf`（按条目 `lg` 取出处今译）、`charFacts`（逐字事实）、`composeName`（自选组合核对）、`findCombo` / `pairCandidates`（出处精确查 / 同句读搭配）、`shapeTags`（笔画 + 结构，叠字不判同结构）、`polyphoneTags`、`nicknames`、`popularity` / `popBand` / `popScore` / `minGnOf`（常见度分档：≥8000 很常见 / ≥2000 常见 / ≥500 一般 / ≥100 少见 / <100 冷僻）、`searchText`。

`src/engine/data.ts` 装配构建产物并导出 `META`、`GLOSS`、`LINE_GLOSS`；每份 JSON 在**加载时做一遍结构自检**（`asPool`/`asChars`/`asMeta`…），数据不合规就在启动阶段大声失败，替代裸 `as` 断言。类型在 `src/engine/types.ts`。

## 3. 状态与迁移（`src/store/`）

- `local.ts`：localStorage 持久化。key 前缀 `naming.*.v1`。收藏从旧的 `string[]` 自动升级为 `FavRecord{id,note?,group?,ts}`；`DEFAULT_OPTS`、`loadOpts` 兼容 `search`/`sort`/`strokeMax`/`noMonotone`/`popFloor`。`saveFavorites` / `saveBlocklist` 供导入整体写回。主题存 `Theme = 'light'|'dark'|'system'`；`resolveDark` + `prefersDark` 决定是否加 `dark`，`THEME_ORDER` / `THEME_LABEL` 供 UI 循环。
- `transfer.ts`：`SavedState` 的构造 / 序列化 / 解析（导入即校验，非法返回 `null` 不抛）、`sanitizeOpts` 收敛越界、`toQuery` / `fromQuery`（URL 只含筛选：`s/r/g/len/n/q/o/sm/nm/pf/b/d`，不含收藏）。

## 4. UI（`src/ui/`、`src/App.tsx`）

- `App.tsx`：三 tab（生成 / 收藏 / 拉黑）、导出导入（**导入时弹合并/覆盖选择**）、复制链接、主题三态循环、离线 / 新版本提示、打印名单、URL 初始状态、跳过链接、`aria-live` 播报、tablist 语义。收藏页支持**搜索 / 排序（最近·分数·笔画·常见度）/ 分组过滤 / 导出名单长图**，勾 2–3 个做对比表 `Compare`。
- `Controls.tsx`：姓氏/读音/字数/性别/书籍/叠字/每批条数/换一批 + 搜索框 + 排序下拉 + **整名笔画上限 / 用字常见度下限 / 避开同结构**。
- `NameCard.tsx`：读音、出处、原句、**今译**、字义、字形、常见度、多音、小名、收藏/拉黑/分享/复制。局部变量 `shadow` 表示阴影，别改回 `shape`（与 `shapeTags` 冲突）。动作区与折叠详情带 `no-print`。`Source` 与 `SourceRef` 单独导出，自选页复用同一套出处渲染。
- `Compose.tsx`：**自选页**。用户自选姓与 1–2 个字（任意汉字，非 L0 字标注），`composeName` 只做读音/谐音/字形事实核对，**不套 Pool-B 分数**（那套分数只对池内候选有校准意义）。出处用 `findCombo` 精确查 Pool-B/singles：查到就渲染 `Source`，查不到明说「未见此搭配」，不拿别的句子凑。另有 `pairCandidates(ch)`（同句读搭配字，从 `candidates.json` 现算，零新增数据）与随机池（默认只随机有出处的）。无出处组合不给收藏入口——收藏按 `id` 回查，没有 id 会坏。草稿存 `localStorage`（`naming.compose.v1`）。
- `ErrorBoundary.tsx`：包裹整棵应用，出错给兜底页而非白屏。

深色模式用 Tailwind 4 的 `@custom-variant dark (&:where(.dark, .dark *))`（`src/styles.css`），令牌用 `dark:` 前缀。打印样式在 `styles.css` 的 `@media print`（隐藏 `.no-print`、卡片不跨页断开）。

## 5. 离线 / PWA

`public/manifest.webmanifest` + `public/icon.svg` + `public/icon-192.png` / `icon-512.png` + `public/sw.js`。SW 注册集中在 `src/lib/pwa.ts` 的 `usePwa()`（http(s) 下注册，cache-first 缓存应用壳，暴露 `offline` / `updateReady` / `applyUpdate`）；页面点「刷新」时向等待中的 worker 发 `SKIP_WAITING`（`sw.js` 的 `message` 监听）。站点本身零网络请求，SW 只是让二次访问更快、断网也能开。

## 6. 门禁与预算

`npm run build` 依次跑：`build:data` → `verify` → `tsc --noEmit` → `eslint .` → `vitest run` → `vite build` → `size-check`。

Vite 侧用 `manualChunks` 把 `vendor`（React 等）、`data`（构建期固化的词典 JSON）、`index`（业务码）拆成三个 chunk：数据只打包、运行时零请求，单独拆出便于长期缓存。唯一超过 500 KB 的 `data` chunk 已把 `chunkSizeWarningLimit` 设在其上方并注明原因，真正的发布门禁是 `size-check`。

- `verify.mjs`：raw 指纹、白名单账目、候选出处自洽、单字名覆盖、出处今译覆盖率（唯一原句＝释义条数、一句一译）、五部标注只落在 L0、性别表等。种子版（无 `l0-verdicts.txt`）与扩表版走不同断言分支（`SEED_MODE = !meta.L0_added`）。
- `size-check.mjs`：资源 gzip 合计 ≤ 400 KB；单文件 HTML 壳 ≤ 1.5 MB。

## 7. 诊断脚本的口径一致性

`measure-funnel / measure-l0-curve / measure-gap-ladder` 曾各自用「种子 ∩ 一级字表」当 L0，扩表后会与 `meta.pool_B` 对不上而误报「口径漂移」。现在它们统一通过 `scripts/l0-keep.mjs` 的 `buildL0()` 并入 `l0-verdicts.txt` 的保留字，与 `build-data.mjs` 同口径；任一处改动白名单规则，须同步这条链路。
