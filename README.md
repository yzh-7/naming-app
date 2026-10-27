# 取名（典籍取词）

一个离线运行的取名辅助工具。它从七部中文典籍中按固定口径取出词语，组合成单字名与双字名，并为每个结果附上出处原句、读音、字义、笔画与用字频次等信息。

在线版本：<https://yzh-7.github.io/naming-app/>

语料在构建期固化为 JSON 随包发布，页面运行时不发起任何网络请求，筛选与计算全部在浏览器内完成。站点可安装为 PWA，断网可用。

## 概述

取词口径（Pool-B）：

1. 典籍原文按 `。！？；` 分句、按 `，、：` 分句读，去标点。
2. 第一个字落在音步起点（起点位置依诗体确定），第二个字在同一句读内、与首字间隔不超过 3 字。
3. 两个字都必须在名用字白名单内；虚词、忌讳字、现代高频成词与噪声词被剔除。

七部典籍及其规模：

| 典籍 | 篇数 | 取词段数 | 取词段字符数 |
|---|---:|---:|---:|
| 诗经 | 305 | 7,260 | 29,250 |
| 楚辞 | 65 | 5,495 | 24,588 |
| 论语 | 20 | 3,682 | 15,720 |
| 水墨唐诗 | 176 | 991 | 5,832 |
| 宋词三百首 | 280 | 5,208 | 23,960 |
| 道法 | 22 行 | 68 | 321 |
| 乐府诗集 | 20 篇 | 429 | 2,134 |
| 合计 | — | 23,133 | 101,805 |

经上述口径得到的候选池：双名 1,525 条（间隔 1 / 2 / 3 字分别为 727 / 474 / 324）、单字名 217 个、名用字白名单 293 字、出处今译 1,140 句。

## 环境要求

- Node.js 22.19 或更高版本。版本约束见 `package.json` 的 `engines` 与 `.nvmrc`，CI 覆盖 22 与 24。
- 端到端测试与设计体检需要 Chromium，首次执行 `npx playwright install chromium`。
- 浏览器：支持现代 ES 模块与 CSS 自定义属性的版本。

## 快速开始

```bash
$ npm install
$ npm run dev
```

`dev` 会先生成数据再启动开发服务器。构建产物位于 `dist/`，本地预览用 `vite preview` 或 `npm run serve`。

## 命令

| 命令 | 说明 |
|---|---|
| `npm run build:data` | 将 `data/raw/` 固化为 `src/data/*.json` |
| `npm run verify` | 数据门禁：输入指纹、白名单账目、出处自洽、今译覆盖率 |
| `npm run dev` | 生成数据后启动 Vite 开发服务器 |
| `npm test` | Vitest 单元测试 |
| `npm run test:e2e` | Playwright 端到端测试与 axe 可访问性扫描，需先执行 `npm run build` |
| `npm run audit:design` | 设计体检，5 视口 × 深浅主题 × 4 页面共 40 组，需先执行 `npm run build` |
| `npm run build` | 依次执行 `format:check`、`build:data`、`verify`、`tsc --noEmit`、`eslint .`、`vitest`、`vite build`、体积检查。ESLint 覆盖 `public/sw.js`（Service Worker 全局），不检查 `dist/`、`dist-single/` 等产物目录 |
| `npm run build:single` | 先跑完 `npm run build`，再执行单文件构建（`SINGLE=1`）到 `dist-single/`，并对该产物再跑一次体积检查 |
| `npm run single` | 只执行单文件构建与体积检查，用于已经构建过的场合（CI 在 `build` 之后跑这一步） |
| `npm run serve` | 以 `python3 -m http.server` 静态伺服 `dist/`，端口 5178 |
| `npm run typecheck` / `npm run lint` / `npm run format` / `npm run format:check` | 类型检查、ESLint、把代码写成 prettier 形态、只判定不改动的形态检查（后者是 `build` 的第一环）。Markdown 文档与脚本生成的 JSON 不参与格式化，排除项见 `.prettierignore` |
| `npm run check` | `build`、`test:e2e`、`audit:design` 三项连跑 |

## 功能

### 生成

输入姓氏（支持复姓，多音姓可选择读音），输出一页候选。每页可换一批，分页不重复、不漏项。每张卡片包含：读音与声调、出处原句与今译、字义、笔画与字形结构、每个字的用字常见度、多音字提示、小名建议，以及收藏、拉黑、分享、复制四个动作。

### 自选

自行选择姓氏与一到两个字，可选任意汉字；不在名用字白名单内的字会标注出来。自选页只做读音、谐音与字形核对，不套用候选池的分数。有典籍出处的组合显示原句与今译，没有出处的组合显示「未见此搭配」，且不提供收藏入口。支持随机组合（默认只在有出处的搭配中随机）与「同句读搭配字」查询。草稿保存在本机。

### 筛选

性别风格、字数（单名／双名）、典籍开关、只看叠字、关键词搜索、排序（分数／笔画／常见度／典籍）、指定用字及其位置、禁用字（避讳字）、整名笔画上限、避开两字同结构、逐字用字常见度下限。

禁用字用于长辈名讳、家里忌讳的字：名里出现其中任意一个，这条候选整条不出现；只查名，不查姓（姓是用户自己的姓）。最多 8 个字，重复字不重复计，非汉字不进状态。它与指定用字是交集：同一个字既指定又禁用时结果为 0，页面直说没有候选，不硬凑。自选页是你自己挑字，不受禁用字筛除，但挑到禁用字时会明说。

### 收藏与拉黑

收藏支持备注、分组、分组过滤、搜索与排序。勾选 2–3 个收藏可进入对比表。拉黑名单记录需要排除的名字，并参与生成结果过滤。收藏与拉黑存在本机 `localStorage`。

### 导入、导出与链接

- 导出收藏、拉黑与筛选配置为 JSON；导入时可选择合并或覆盖，导入文件会先校验。超过 8 MiB 的文件直接拒绝并说明上限，不读进内存（本应用自己导出的一份最大的——全量候选——约 0.6 MiB）。
- 导出当前筛选命中的全部候选为 JSON 或 CSV（含出处原句与今译），不限于当前页。CSV 单元格以 `=`、`+`、`-`、`@` 打头时前置一个前导单引号，避免被 Excel／WPS 当成公式执行。
- 复制当前页面的链接。URL 只编码筛选条件（姓氏、读音、性别、是否含「疑似」一档、字数、搜索词、排序、笔画上限、常见度下限、典籍开关、禁用字 `ac` 等），不包含收藏与拉黑。链接里出现某一项，这一项就进入状态；取值不可信时回默认值，不夹到边界，也不静默丢弃。链接没有出现的项沿用本机已存的偏好。

### 分享与打印

单个名字的分享卡片图片（含原句、今译与本地生成的二维码）、收藏名单长图、打印名单。打印样式只保留卡片正文，动作区与折叠详情不打印。

### 主题

跟随系统、浅色、深色三档，保存在本机键 `naming.theme.v1`，标记加在 `<html>` 上。选择「跟随系统」时随系统偏好实时切换。四个页面以及分享卡、对比表、导入弹窗均有对应的深色配色。

### 响应式与可访问性

- 320px 宽度起无横向溢出。
- 视口宽度小于 1024px 时交互目标高度不小于 44px，平板宽度（768px）同样按触摸尺寸计算。
- 断点：`xs` 384、`sm` 640、`lg` 1024、`xl` 1280。
- 页头固定（sticky），切换页面时滚动位置回到顶部。
- 状态按钮使用 `aria-pressed`，折叠区使用 `details/summary`，装饰字符标记 `aria-hidden`。
- 界面文案无衬线，名字用衬线大字，数字使用 `tabular-nums`，正文行长上限约 40 字。

### PWA

`public/manifest.webmanifest` 与 Service Worker 支持安装与离线访问。有新版本或处于离线状态时，页面顶部给出提示。应用版本只有一个来源（`package.json`），页脚、页面 meta 与 Service Worker 注册参数三处出口都由它注入；离线缓存名按当前构建产物算出，不手工维护。口径见 `DESIGN.md`「版本与缓存」。

## 界面

对构建产物实拍（`scripts/screenshots.mjs`，Chromium，2 倍缩放）：

| 生成页（浅色） | 生成页（深色） |
|---|---|
| ![生成页浅色](docs/screenshots/generate-light.png) | ![生成页深色](docs/screenshots/generate-dark.png) |

| 自选页（组合「苏子归」，出处《诗经·江有汜》） | 生成页（390 × 844） |
|---|---|
| ![自选页](docs/screenshots/compose.png) | ![手机视图](docs/screenshots/generate-mobile.png) |

## 数据来源与许可

本仓库自己写的代码与文档按 MIT 许可，全文见 [LICENSE](LICENSE)。`data/raw/` 下的上游语料、字表与派生输入按各自上游许可，本仓库不重新授权它们；构建期用到的第三方库同样按上游许可，两者都不在 MIT 范围内。

原始语料、字表与派生输入位于 `data/raw/`，逐项上游、许可与用途见 [data/raw/LICENSES.md](data/raw/LICENSES.md)，许可全文副本位于 `data/raw/licenses/`。`data/raw/SHA256SUMS` 记录输入指纹，`npm run verify` 在构建期校验；改动原始数据必须同步更新指纹。

构建产物位于 `src/data/`，由 `scripts/build-data.mjs` 生成，不要手工编辑。出处今译（`data/raw/line_gloss.tsv`）由本项目撰写，只解释句意。

## 项目结构

```text
data/raw/          上游原始数据、派生输入、SHA256SUMS、许可全文
scripts/           构建管线、门禁与设计期诊断脚本
  build-data.mjs     data/raw → src/data/*.json
  verify.mjs         数据门禁
  size-check.mjs     体积门禁
  design-audit.mjs   设计体检
  screenshots.mjs    文档截图
  derive-dict.mjs    一次性派生三份精简输入
  measure-*.mjs      设计期实测
src/
  engine/          纯函数引擎：数据装配与运行时结构校验、取词、打分、音韵、字形、常见度
  store/           localStorage 持久化、导入导出、URL 状态编解码
  ui/              Controls、NameCard、Compose、TopNav、ThemeControl、ErrorBoundary（对比表 Compare 定义在 App.tsx 内）
  lib/             share.ts（分享卡片与名单长图）、pwa.ts（Service Worker）
  data/            构建产物，勿手改
public/            manifest、图标、service worker
tests/e2e/         Playwright 端到端与 axe 扫描
docs/screenshots/  文档截图
LICENSE            本仓库自撰代码与文档的 MIT 全文
```

## 测试

| 层 | 命令 | 覆盖内容 |
|---|---|---|
| 单元测试 | `npm test` | 9 个文件、183 个用例：取词口径、打分、音韵、字形与常见度筛选、指定字与禁用字、检索排序、持久化与导入导出往返、URL 编解码、候选与收藏 CSV 的转义与防公式、组件渲染 |
| 端到端 | `npm run test:e2e` | 28 个用例：关键路径 18 项（生成、自选、收藏与分组、篇名筛选、按拼音搜索、禁用字与带 `ac` 的链接、逐字输入的禁用字、导出、名单图、页脚版本、链接参数、Service Worker 缓存）＋ 390×844 与 320×640 两档视口各 5 项，含 axe（WCAG 2 A/AA）扫描与 target-size 规则，深浅主题均覆盖 |
| 设计体检 | `npm run audit:design` | 40 个组合：320×640、390×844、768×900、1024×900、1440×1000 五个视口 × 浅色与深色 × 四个页面，检查横向溢出、触控目标尺寸、文字对比度、方块字行长、页头是否遮挡首屏卡片 |

设计体检在硬违规出现时以退出码 1 结束。硬违规判定共五条：横向溢出超过 1px、触控目标小于 24px、文字对比度低于 WCAG 要求（大字 3:1、正文 4.5:1）、页头压住首屏第一张卡片、主题切换控件在窄视口不可见。「单行方块字超过 42 字」与「窄视口目标小于 44px 但不少于 24px」只作为报告段落输出，不影响退出码。`--verbose` 列出逐条结果，`--json` 输出 `design-audit.json`。

## 构建与体积预算

`vite.config.ts` 用 `manualChunks` 把产物分成三块：`vendor`（React 等依赖）、`data`（固化的词典与候选 JSON）、`index`（业务代码）。数据块只打包、不发起请求，单独分块便于长期缓存。

体积门禁由 `scripts/size-check.mjs` 执行，两条判定都按 gzip 计，也都进退出码：非 HTML 资源合计不超过 400 KiB；HTML 自身按产物形态取预算——站点版量的是页面壳（400 KiB），单文件版量的是整个产物（450 KiB），同时打印原文件大小与所用的压缩实现。当前实测（gzip level 9）：

| 产物 | 原文件 | gzip（CI 口径） | gzip（本机口径） | 预算 |
|---|---:|---:|---:|---:|
| 站点 `dist/` 非 HTML 资源合计 | — | 388,910 B（379.8 KiB） | 387,016 B（377.9 KiB） | 409,600 B |
| 站点 `dist/index.html` 页面壳 | 2,921 B | 1,330 B | 1,303 B | 409,600 B |
| 单文件 `dist-single/index.html` | 1,678,520 B（1.60 MiB） | 414,731 B（405.0 KiB） | 408,967 B（399.4 KiB） | 460,800 B |

gzip 的结果与压缩实现有关：CI 的官方 Node 自带 zlib-ng，同一份单文件产物压出 414,731 B，比本机系统 zlib 的 408,967 B 多 5,764 B（1.4%）。同一份产物在两种实现下都必须过门禁，所以取较大的一侧作准；单文件产物把本体与数据全部装在 HTML 里，400 KiB 这条首屏预算对它过窄，单列为 450 KiB，当前余量 46,069 B（10.0%）。语料或字表扩充会先撞这条线，扩充前先看这一行；`dist-single/` 只用于体积核对，不发布。

## 部署

推送到 `main` 分支后由 GitHub Actions 构建并发布到 GitHub Pages。

| 工作流 | 文件 | 步骤 |
|---|---|---|
| CI | `.github/workflows/ci.yml` | 构建（Node 22 与 24）；单文件版构建与体积检查；依赖漏洞审计（`npm audit --audit-level=high`，只拦 high 与 critical）；端到端与 axe 扫描；设计体检。同一分支的并发运行只保留最新一次，单个 job 20 分钟超时，工作流权限只给 `contents: read` |
| 发布 | `.github/workflows/deploy-pages.yml` | 构建并上传 Pages 产物；单个 job 20 分钟超时 |
| 依赖更新 | `.github/dependabot.yml` | 每周六 09:00（Asia/Shanghai）开 PR：npm 只提 minor 与 patch（major 留给人工决定），标题前缀 `fix(deps)`，开放 PR 上限 5；GitHub Actions 依赖前缀 `chore(ci)` |

首次配置：

1. 创建公开仓库并推送代码。
2. 在仓库 Settings → Pages → Build and deployment 中，将 Source 设为 GitHub Actions。
3. 推送后访问 `https://<用户名>.github.io/naming-app/`。

免费账户只能从公开仓库发布 Pages。本项目不含密钥与个人数据。

## 适用范围与已知限制

- 应用提供的是可核对的信息：典籍出处、原句位置、字义、笔画与结构、读音与谐音、多音字、真实用名频次。不包含五行、八字、五格、生肖宜忌、吉凶或「补缺」建议。
- 卡片上的「部首」是《康熙字典》部首归属，只覆盖木、火、水、金、土五部中查得到的字（63 字；1,525 条双名中有 553 条至少一个字可标注）。未标注不代表该字没有五行属性。
- 卡片分数由本项目自定义规则计算（音韵、谐音、字频、字形、性别风格），只用于候选池内排序，不构成对名字优劣的评价。
- 名用字白名单为 293 字。扩充方式：执行 `node scripts/l0-unlock.mjs` 生成待审表，人工判定后写回 `data/raw/l0-verdicts.txt`，再执行 `npm run build`；门禁会在扩表后切换为下界断言，已有候选不允许消失。
- 典籍范围固定为上述七部。增加典籍需要同时更新指纹与门禁断言，规则见 `DESIGN.md`。
- 出处今译为自撰内容，无第三方校订。

## 进一步阅读

- `DESIGN.md`：数据管线、引擎接口、状态与迁移、样式令牌、门禁与诊断脚本。
- `CHANGELOG.md`：版本记录。版本号来源、每版用户可见影响与门禁变化。
- `ANDROID.md`：将同一份构建产物打包为 Android 应用的方案对比与实施步骤。
