# 设计说明

本文面向维护者，说明实现方式、数据口径与门禁。使用说明见 `README.md`。

## 1. 数据管线

### 1.1 派生输入

`scripts/derive-dict.mjs` 从上游词典与姓名语料（读取 `UP_DIR`，默认 `/tmp/opencode`）裁出三份精简输入，一次性生成后作为原始数据登记：

| 文件 | 内容 |
|---|---|
| `data/raw/dict_shape.json` | 字 → `[笔画, 结构代码]`。结构代码：D 独体、A 品字、B 上下、E 上中下、H 左右、M 左中右、Q 全包围、R 半包围 |
| `data/raw/dict_gloss.json` | 字 → 本义。优先取「本义」条目，去训诂括号，截断 28 字 |
| `data/raw/name_given_freq.json` | 名字第二字的用字计数，共 2,240 字 |

三份文件均已登记进 `data/raw/SHA256SUMS`。

### 1.2 出处今译

`data/raw/line_gloss.tsv` 为 1,140 行「原句 ⇥ 释义」，与候选及单字名的原句逐条对应，由本项目撰写。构建时按「候选 → 单字」中首次出现的顺序编号，条目写入 `lg` 下标，同时输出 `src/data/line_gloss.json`（字符串数组，同一句只存一份）。条目缺失、多余或原句重复都会在构建期失败。

### 1.3 构建

`scripts/build-data.mjs` 每次构建把 `data/raw/` 固化为 `src/data/*.json`。这是唯一的正式数据来源，`src/data/` 下的文件均为产物。

产物中的 `src/data/meta.json` 有两项是对外交代的口径：

| 字段 | 内容 | 谁来核对 |
|---|---|---|
| `corpus_sha` | `data/raw/SHA256SUMS` 的 SHA-256 前 12 位，语料清单指纹，页脚显示 | 运行时 `asMeta` 要求它是非空字符串；`verify.mjs` 校验指纹本身 |
| `id_prefix_stats` | 候选编号前缀的分组数、发生碰撞的组数、最大组的条数 | `verify.mjs` 第 4c 节独立重算并与 meta 对账 |

候选编号形态为「层级 + 典籍代号 + 篇名 + 名字去声调拼音 + 序号」，例如 `Bsj_caiwei_yiyi_001`。序号只按「篇 + 去声调拼音」这个前缀计数，池子扩容时旧编号不位移。计数键用拼音而不是汉字，因此同篇同音不同字会共用前缀并按出现顺序递增序号：当前 1,525 条双名共有 1,524 个前缀，其中 1 组 2 条（《诗经·采薇》的「依依」与「翼翼」都是 `yiyi`，编号 `Bsj_caiwei_yiyi_001` / `_002`），最大组 2 条。完整编号仍然唯一，界面、收藏与拉黑都按完整编号取条目，前缀相同不影响取用。这条计数不是缺陷、也不靠注释说明，它作为事实写进 meta 并由门禁核对，语料扩充后组数与最大组的变化会在门禁上暴露。

### 1.4 候选池口径（Pool-B）

1. 典籍原文按 `。！？；` 分句、按 `，、：` 分句读，去标点。
2. 取字对：第一字落在音步起点（起点偏移依诗体确定），第二字在同一句读内、与首字间隔不超过 3 字。相邻重复字（叠字装置）与假叠字剔除。
3. 两道减法：两字都须在 L0 名用字白名单内；排除虚词、忌讳字、现代高频成词（jieba 词频 ≥ 5000）与噪声词。

结果：`pool_B = 1,525` 条双名（`by_gap` 727 / 474 / 324），单字名 217 个，其中 76 个无典籍出处。

### 1.5 L0 白名单

种子为 `cnname_attributes.json` 全部用字与通用规范汉字表（一二三级，8,105 字）的交集，共 268 字；再并入 `data/raw/l0-verdicts.txt` 中人工判定为「保留」的 25 字，共 293 字。`scripts/verify.mjs` 校验账目（`L0_size = L0_seed + L0_added`）与判定文本指纹。

扩充流程：执行 `node scripts/l0-unlock.mjs` 生成边际增量待审表，人工判定后写回 `l0-verdicts.txt`，再执行 `npm run build`。扩表后门禁切换到下界断言模式，既有候选不允许消失。

## 2. 引擎（`src/engine/`）

`name.ts` 为纯函数模块，无副作用，输入 `Opts`，输出 `Result[]`。

| 函数 | 作用 |
|---|---|
| `universe(opts)` | 模块内部函数。按典籍、性别、字形、叠字、搜索词过滤候选空间 |
| `passesShape(name, opts)` | 模块内部函数。事实类筛选：`strokeMax` 整名笔画上限（0 为不限）、`popFloor` 逐字常见度下限（经 `minGnOf`）、`noMonotone` 排除两字同结构。档位定义见 `types.ts` 的 `STROKE_MAXES`、`POP_FLOORS` |
| `plan(surname, opts, batch, surReading)` | 分页取一批候选并按 `opts.sort` 排序。排序为 `score` 或 `book` 时按典籍分组展示，`strokes`、`popular` 保持全局顺序 |
| `scoreItem(surname, item, opts, surReading)` | 打分：静态字形与笔画差值、音韵（声调、声母、多音）、性别风格匹配、同形现代词风险 |
| `glossOf` / `lineGlossOf` | 字义、出处今译（按条目 `lg` 下标取） |
| `charFacts` | 单字事实：读音、笔画、结构、常见度、部首 |
| `composeName` | 自选组合核对，不套用 Pool-B 分数 |
| `findCombo` / `pairCandidates` | 出处精确查询 / 同句读搭配字查询 |
| `shapeTags` | 笔画与结构标签，叠字不判为同结构 |
| `polyphoneTags` | 多音字提示 |
| `popularity` / `popBand` / `popScore` / `minGnOf` | 常见度换算。档位：≥ 8000 很常见、≥ 2000 常见、≥ 500 一般、≥ 100 少见、< 100 冷僻 |
| `nicknames` / `searchText` | 小名建议、搜索文本 |

`data.ts` 加载构建产物并导出 `META`、`GLOSS`、`LINE_GLOSS`。每份 JSON 在加载时执行结构自检（`asPool`、`asChars`、`asMeta` 等），数据不合规在启动阶段报错。类型定义在 `types.ts`。

## 3. 状态与持久化（`src/store/`）

### 3.1 `local.ts`

| 键 | 内容 |
|---|---|
| `naming.favorites.v1` | 收藏记录 `FavRecord { id, note?, group?, ts }`，从旧版 `string[]` 自动升级 |
| `naming.blocklist.v1` | 拉黑名单 |
| `naming.surname.v1` / `naming.surnameReading.v1` | 姓氏与读音序号 |
| `naming.opts.v1` | 筛选配置，`loadOpts` 兼容历史字段 |
| `naming.theme.v1` | `system` / `light` / `dark` |
| `naming.compose.v1` | 自选页草稿 |

`saveFavorites` / `saveBlocklist` 供导入时整体写回。`loadOpts` 把本机存下来的对象交给 `sanitizeOpts`，`loadSurname` / `loadReading` 分别过 `cleanSurname` 与 `sanitizeReading`，写回时同样先清洗再落盘：本机存储里遗留的脏值（旧版本写入的、或用户在控制台改过的）不会被读回界面，也不会原样带进导出文件。`resolveDark` 与 `prefersDark` 决定是否给 `<html>` 加 `dark` 类，`THEME_ORDER` / `THEME_LABEL` 供界面循环使用。

### 3.2 `transfer.ts`

`SavedState` 的构造、序列化与解析。解析不抛异常，失败返回 `{ ok: false, error }`，`error` 取 `json`（不是 JSON 或不是对象）、`foreign`（不是本应用导出的文件：`app` 字段不是 `naming-app`，或没有任何本应用字段）、`empty`（是本应用的文件，但收藏、拉黑、设置三项全空）三种，界面按三种分别措辞。

不可信输入只有一套收敛规则，定义在 `local.ts`：`sanitizeOpts`、`sanitizeReading`，以及 `engine/types.ts` 的 `cleanSurname`。本机存储、导入文件、分享链接三条路径都从这里取值，`transfer.ts` 不再自带一份。数值与枚举的口径是「不可信就回该项默认」，不夹到边界，也不静默丢弃这一项：

| 项 | 可信取值 | 不可信时 |
|---|---|---|
| 姓氏 | 汉字，最多 2 字 | 去掉非汉字后取前 2 字；全非汉字回空串 |
| 姓氏读音序号 | 0–9 的整数（纯数字字符串也接受） | 回 0 |
| 字数 `length` | 只认 `1`，其余取值一律按双名处理 | 回 2 |
| 每批条数 `count` | 0–600 的整数，`0` 表示不限 | 回默认 12 |
| 整名笔画上限 `strokeMax` | 0–64 的整数 | 回 0（不限） |
| 用字常见度 `popFloor` | 只认 `POP_FLOORS` 中的取值（0 / 100 / 500 / 2000） | 回 0 |
| 性别 `gender`、排序 `sort`、指定字位置 `mustPos` | 只认各自白名单 | 回默认 |
| 搜索词 `search`、篇名 `title` | 字符串，分别截断到 40 字、30 字 | 回空串 |
| 指定用字 `mustChar` | 必须是单个汉字 | 回空串 |
| 典籍开关 `books` | 按 `BOOK_ORDER` 顺序的 0/1 串；短于 7 位时未提到的书按开补齐，长于 7 位截断 | 不是 0/1 串则七部全开 |
| 排除名单 `exclude` | 不接受外部输入 | 一律置空，生成时按本机拉黑名单重算 |
| 收藏、拉黑 | `sanitizeFav` 逐条收敛 | 非法条目丢弃，不整份拒绝 |

链接只编码筛选条件，不包含收藏与拉黑。`fromQuery` 是部分合并：某个参数出现了，这一项就进入状态并采用消毒后的取值（越界即默认值）；参数没出现，这一项沿用本机已存的偏好。`toQuery` 不写默认值，`genderWeak` 只在 `gender` 已选定（不起作用的开关不占链接长度）且为真时写出 `gw=1`。参数表：

| 参数 | 含义 |
|---|---|
| `s` | 姓氏 |
| `r` | 姓氏读音序号 |
| `g` | 性别风格（`f` / `m`） |
| `gw` | 含「疑似」一档（`genderWeak`，只在 `g` 存在时写出） |
| `len` | 字数，`1` 表示只看单名 |
| `n` | 每批条数，`all` 表示不限 |
| `q` | 搜索词 |
| `t` | 篇名（只看这一篇） |
| `o` | 排序（`score` / `strokes` / `popular` / `book`） |
| `sm` | 整名笔画上限 |
| `nm` | 避开两字同结构 |
| `pf` | 用字常见度下限 |
| `b` | 典籍开关，按 `BOOK_ORDER` 顺序的 7 位 0/1 串（诗经、楚辞、论语、水墨唐诗、宋词三百首、道法、乐府） |
| `d` | 只看叠字 |
| `mc` / `mp` | 指定用字与其位置（`first` / `last`） |

## 4. 界面（`src/ui/`、`src/App.tsx`）

| 模块 | 职责 |
|---|---|
| `App.tsx` | 四个标签页（生成 `#/`、自选 `#/compose`、收藏 `#/fav`、拉黑 `#/block`）、导入导出、复制链接、固定页头与主题三档、离线与新版本提示、打印名单、URL 初始状态、跳转链接、`aria-live` 播报、tablist 语义。切换标签页时执行 `window.scrollTo(0, 0)` |
| `Controls.tsx` | 姓氏、读音、字数、性别、典籍、叠字、每批条数、换一批、搜索、排序、笔画上限、常见度下限、避开同结构 |
| `NameCard.tsx` | 读音、出处、原句、今译、字义、字形、常见度、多音、小名与四个动作。局部变量 `shadow` 表示阴影，不要改名为 `shape`（与 `shapeTags` 冲突）。动作区与折叠详情带 `no-print`。`Source` 与 `SourceRef` 单独导出，供自选页复用 |
| `Compose.tsx` | 自选页。用 `composeName` 做读音、谐音、字形核对；出处用 `findCombo` 精确查询 Pool-B 与单字池，未命中时显示「未见此搭配」；`pairCandidates` 从 `candidates.json` 现算同句读搭配；随机池默认只含出处组合。无出处的组合不提供收藏入口（收藏按 `id` 回查） |
| `TopNav.tsx` / `ThemeControl.tsx` | 页头标签组与主题三档按钮，均为 `aria-pressed`；窄视口下只显示图标加 `aria-label` |
| `ErrorBoundary.tsx` | 根级兜底界面 |

对比表 `Compare` 定义在 `App.tsx` 内，接收 2–3 个收藏项。

### 4.1 样式令牌（`src/styles.css`）

Tailwind 4 的 CSS-first 写法：`@theme` 定义刻度，`@utility` 定义可复用的组件类。深色主题不使用 `dark:` 前缀，改由 `.dark` 覆盖同名 CSS 变量，组件只引用语义化令牌。

- 颜色：`--canvas`、`--surface`、`--surface-2`、`--line`、`--line-strong`、`--ink`、`--ink-2`、`--ink-3` 一组中性面；`--accent` 只用于主操作；性别风格用 `--cool-*`（偏男）与 `--warm-*`（偏女），卡片与筛选按钮共用（`seg-cool` / `seg-warm` 定义在 `seg-btn` 之后，避免 hover 覆盖选中态）；`--warn`、`--danger`、`--ok` 用于状态；`mark` 使用 `--mark` / `--mark-ink` 成对取值，深浅两档均满足对比度要求。
- 字号：`meta` 13（宽度小于 1024px 时为 14）、`body` 15、`title` 17、`glyph` 19、`name` 24、`name-lg` 30，各自带独立 line-height。汉字用衬线，界面文案用无衬线，数字使用 `tabular-nums`。
- 组件工具类：`card`、`field`、`lab`、`seg` / `seg-btn` / `seg-on`、`btn` / `btn-primary` / `btn-quiet` / `btn-outlined` / `btn-accent` / `btn-danger` / `btn-on`、`chip` 及 `chip-cool` / `chip-warm` / `chip-accent` / `chip-ok` / `chip-warn` / `chip-danger`、`meta-row`（两列 `dl`）、`measure`（正文上限 40em，约合每行 40 字）、`rounded-card`、`rounded-ctl`、`pb-safe`、`anchor-offset`、`no-print`。卡片内的次要动作（复制信息、分享卡、弹窗中的覆盖与取消）用 `btn-quiet`；数据导入导出那一行（导出、候选 CSV、候选 JSON、导入、复制链接、导出名单图、打印名单）用 `btn-outlined`，实线边框加正文字色，主色只用于「换一批」。
- 断点：`xs` 384（自定义，表单转两列）、`sm` 640（侧栏与一行布局、页头收成一行）、`lg` 1024、`xl` 1280。44px 触控尺寸保持到宽度 1023px，紧凑档 36px 只在 `lg` 生效，768px 平板按触摸尺寸计算。`@media print` 隐藏 `.no-print`，卡片不跨页断开。
- 可访问性约定：可见文字必须属于可访问名的一部分，因此 `aria-label` 只用于图标按钮与分组；状态按钮用 `aria-pressed` 表达，不改动文案；折叠区用 `details` / `summary` 并带 `aria-expanded`；装饰字符标记 `aria-hidden`。
- 页头为 `sticky`，因此切换标签页时回到顶部，否则第一张卡片会被页头遮挡（设计体检将此列为硬违规）。

### 4.2 设计体检（`scripts/design-audit.mjs`）

执行 `node scripts/design-audit.mjs`。若端口 5180 无响应，脚本自行启动 `vite preview`，因此可直接在 `npm run build` 之后运行。它用 Playwright 在 320×640、390×844、768×900、1024×900、1440×1000 五个视口 × 浅色与深色 × 四个页面共 40 个组合上测量：横向溢出、触控目标尺寸、文字对比度、方块字行长（用 `Range` 逐行量实际行宽）、页头是否遮挡首屏卡片、页头高度。测量前执行 `scrollTo(0, 0)`，首屏指滚动到顶部后的那一屏。

硬违规判定共五条：横向溢出超过 1px、触控目标小于 24px（复选框按整条 label 计算）、对比度低于 WCAG 要求（大字 3:1、正文 4.5:1，按字号判定）、页头压住首屏卡片、页头的主题切换控件在窄视口不可见。存在硬违规时退出码为 1。「单行方块字超过 42 字」与「窄视口目标小于 44px 但不小于 24px」各作为一段报告输出，不影响退出码；前者用于观察排版行长是否失控，后者用于观察触控舒适度，真正的下限由 24px 那条把住。`--verbose` 列出逐条结果，`--json` 输出 `design-audit.json`。CI 构建日志需要额外权限才能读取，因此脚本把违规写成 `::error::` 注解，并附带一条字体探针注解（CI 环境没有 Songti SC / PingFang SC，回退字体的字宽不同）。Playwright 侧另有 axe 扫描与 target-size 规则，见 `tests/e2e/`。

## 5. 离线与 PWA

### 5.1 应用壳

`public/manifest.webmanifest`、`public/icon.svg`、`public/icon-192.png`、`public/icon-512.png` 与 `public/sw.js`。Service Worker 注册集中在 `src/lib/pwa.ts` 的 `usePwa()`：仅在 http(s) 下注册，cache-first 缓存应用壳，暴露 `offline`、`updateReady`、`applyUpdate`。页面点击刷新时向等待中的 worker 发送 `SKIP_WAITING`，`sw.js` 在 `message` 监听中处理。站点本身不发起网络请求，Service Worker 的作用是加快二次访问并支持离线打开。

### 5.2 版本与缓存

版本号只有一个来源：`package.json` 的 `version`。`vite.config.ts` 读它并校验形态（`x.y.z`，可带预发布后缀），形态不对就地停构建，而不是让界面和 worker 拿到一个怪字符串。三个出口都由这一个值注入：

| 出口 | 注入方式 | 用途 |
|---|---|---|
| JS 常量 `APP_VERSION`（`src/engine/data.ts` 里的 `__APP_VERSION__`） | `define` | 页脚「应用版本 …」；`usePwa()` 的注册参数 |
| `index.html` 的 `<meta name="app-version">` | `transformIndexHtml` 替换占位符（`define` 不改 HTML） | 单文件版离线打开时可核对版本，也是缓存名的第二回退 |
| Service Worker 注册参数 `sw.js?v=` | `pwa.ts` 拼 URL | 版本变化时浏览器更及时去取新的 worker |

离线缓存名（`public/sw.js` 中的 `naming-app-*`）按当前部署算出，不手工维护。旧版把名字写死成 `naming-app-v5`：改一次代码要手改一次，漏改时新产物被写进旧缓存，`activate` 又把「名字不匹配」的缓存删掉，用户看到的是旧内容。现在的推导顺序：

1. `fetch('./index.html', { cache: 'no-store' })`。不能用缓存里的那一份，它可能属于旧版本。
2. 取其中的 `assets/*.js`、`assets/*.css` 文件名排序后哈希，得到 `naming-app-<hash>`。产物内容变了文件名就变，缓存名跟着变，旧缓存由 `activate` 删除。
3. 没有分包产物（单文件版）时退回 meta 中的版本号，得到 `naming-app-0.2.0` 这样的名字。
4. 连 `index.html` 都取不到（离线安装）时退回注册参数 `?v=`；都没有则 `naming-app-unreleased`。

同一个 worker 实例只解析一次（`cacheName()` 记忆结果），`install` 预取、`activate` 清理、`fetch` 回填用的是同一个名字；`activate` 只删除带 `naming-app-` 前缀且与当前名字不同的缓存，不碰其它缓存。导航请求走 network-first，带哈希的静态资源走 cache-first。`tests/e2e/app.spec.ts` 中有一条用例直接从浏览器读缓存，验证名字形态以及应用壳确实写进了这个缓存。

与版本并列的对外口径还有语料指纹：`build-data.mjs` 把 `data/raw/SHA256SUMS` 的 SHA-256 前 12 位写进 `src/data/meta.json` 的 `corpus_sha`，页脚显示「语料指纹 …（语料清单变化即变）」。语料清单里任何一份原始文件的指纹变了，这个值就变，用户能从页面判断自己拿到的是哪一份语料。`src/engine/data.ts` 的 `asMeta` 要求它是非空字符串，缺失即构建失败。

`public/manifest.webmanifest` 没有 `version` 成员：应用 manifest 规范已移除该成员，浏览器不读它；安装与「有新版本」提示走 Service Worker 这一条路径，版本信息由上面三个出口给出。

## 6. 门禁与预算

`npm run build` 依次执行 `build:data`、`verify`、`tsc --noEmit`、`eslint .`、`vitest run`、`vite build`、`size-check`。`npm run build:single` 是先完整跑一遍 `build`，再执行 `npm run single`（`SINGLE=1 vite build --outDir dist-single --emptyOutDir` 加一次针对 `dist-single/` 的体积检查）。CI 的两个构建分支都在 `build` 之后追加 `npm run single`，产物不发布，只为让单文件版的体积口径真的是门禁。

`vite.config.ts` 用 `manualChunks` 分出 `vendor`（React 等）、`data`（固化的词典 JSON）、`index`（业务代码）三块。数据块单独拆分便于长期缓存，其体积超过 Vite 默认警告阈值，因此 `chunkSizeWarningLimit` 设在其上方并注明原因；发布预算由 `size-check` 判定。单文件构建必须关掉 `manualChunks`（`viteSingleFile` 会关掉代码分割，此时 `manualChunks` 会让构建报错）。

| 门禁 | 断言 |
|---|---|
| `verify.mjs` | 原始数据指纹、白名单账目、候选出处自洽、单字名覆盖、出处今译覆盖率（唯一原句数等于释义条数、一句一译）、五部标注只落在 L0 字上、性别表规模、候选 id 前缀冲突统计与 `meta.id_prefix_stats` 对账。种子版（无 `l0-verdicts.txt`）与扩表版走不同断言分支（`SEED_MODE = !meta.L0_added`） |
| `eslint .` | 覆盖 `src/`、`scripts/`、`tests/` 与 `public/sw.js`（后者按 Service Worker 全局检查：它没有单元测试，写错了原本只能靠浏览器运行暴露）。`dist/`、`dist-single/` 与测试产物目录不检查——之前 `dist-single/` 没列入，那份产物被当作源码送去 lint |
| `size-check.mjs` | 非 HTML 资源的 gzip 合计不超过 400 KiB；HTML 自身的 gzip 不超过 400 KiB。两条判定都进退出码。多文件版这里量的是页面壳，单文件版量的是整个产物，同时打印原文件大小 |

当前实测（gzip level 9，版本 0.2.0）：

| 产物 | 原文件 | gzip | 预算 |
|---|---:|---:|---:|
| `dist/` 非 HTML 资源合计 | — | 385,587 B（376.6 KiB） | 409,600 B |
| `dist/index.html` 页面壳 | 2,921 B | 1,298 B | 409,600 B |
| `dist-single/index.html` | 1,675,319 B（1.60 MiB） | 407,880 B（398.3 KiB） | 409,600 B |

单文件产物的 gzip 距预算只剩 1,720 B（0.4%），语料或字表扩充会先撞这条线。原先文档写的「单文件目标 ≤1.5 MB」既没有脚本执行、口径也没说清是原文件还是 gzip：按原文件算当时就已经超过（1.57 MB），按 gzip 算又过于宽松。现在两条判定统一到 gzip，原文件大小只报出、不作判定。

## 7. 诊断脚本的口径一致性

`measure-funnel`、`measure-l0-curve`、`measure-gap-ladder` 原先各自用「种子 ∩ 一级字表」计算 L0，扩表后会与 `meta.pool_B` 不一致并误报口径漂移。现在统一通过 `scripts/l0-keep.mjs` 的 `buildL0()` 并入 `l0-verdicts.txt` 的保留字，与 `build-data.mjs` 同口径。修改白名单规则时需要同步这条链路。

## 8. 变更指引

| 变更 | 需要同时修改 |
|---|---|
| 增加或替换典籍 | `data/raw/` 语料与 `SHA256SUMS`、`build-data.mjs` 的取词参数、`types.ts` 的 `BOOK_ORDER`、`verify.mjs` 的语料规模与出处断言、界面文案中的典籍计数 |
| 扩充名用字白名单 | `data/raw/l0-verdicts.txt`、`verify.mjs` 账目断言、`README.md` 中的 293 字计数 |
| 增加筛选条件 | `types.ts` 的 `Opts` 与档位常量、`passesShape` 或 `universe`、`Controls.tsx` 控件、`local.ts` 的 `sanitizeOpts`、`transfer.ts` 的 URL 参数读写、单测与端到端用例 |
| 修改视觉令牌 | `src/styles.css` 单点修改；组件只引用语义化令牌，深色主题不需要逐组件改动 |
| 改动 `data/raw/` 任何文件 | `data/raw/SHA256SUMS` 指纹。指纹一变，页脚的语料指纹自动跟着变；`verify.mjs` 的规模与覆盖率断言、`README.md` 的候选池计数需要复核 |
| 发布新版本 | `package.json` 的 `version`（形态在构建期校验）与 `CHANGELOG.md` 新条目。页脚版本、页面 meta、worker 注册参数三处出口由构建注入，离线缓存名随产物自动变化，都不需要手改 |
| 修改输入收敛规则 | 只改 `local.ts` 的 `sanitizeOpts` / `sanitizeReading` 与 `engine/types.ts` 的 `cleanSurname`，三条路径共用；同步 `src/store/local.test.ts`、`src/store/transfer.test.ts` 的口径用例与本文件 3.2 的表 |
