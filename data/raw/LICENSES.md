# Vendored 原始数据许可与指纹

构建期输入。运行时产物（`src/data/*.json`）不含本目录原文，只含清洗后的候选与查表数据。
`scripts/verify.mjs` 会用 `SHA256SUMS` 校验本目录字节一致，语料一旦漂移，实测的 Pool-B（种子版基线 463／当前扩表版 1,525）就不可复现。

| 文件 | 上游 | 许可 | 用途 | 是否进包 |
|---|---|---|---|---|
| `shijing.json` `chuci.json` `lunyu.json` `shuimo.json` `song300.json` | chinese-poetry/chinese-poetry | MIT | 语料：诗经 305 / 楚辞 65 / 论语 20 / 水墨唐诗 176 / 宋词三百首 280 | 否。只发布清洗后的句读候选 |
| `daofa.json` | 本仓库手工录入（22 条句读行；文本核为《老子》王弼本系通行本、《周易》经＋十翼、《清静经》） | 古籍本文公共领域；录入的是原文短句，无注释无译文 | 第六本语料「道法」，贡献 34 条双名（其中 33 条为新增） | 否。这 22 行以 `candidates.json` 的 `line` 字段发布 |
| `yuefu.json` | 郭茂倩（宋）《乐府诗集》二十篇（汉乐府 13 / 北朝乐府 5 / 南朝乐府 2，卷号见每篇 `chapter` 注记），文本自中文维基文库（zh.wikisource.org）「乐府诗集」各卷页抄录，并与《四库全书》本交叉校字 | 原集公共领域；维基文库整理本（排校与句读）为 CC BY-SA 4.0（全文副本见 `licenses/wikisource-cc-by-sa-4.0.txt`） | 第七本语料「乐府」，429 段 / 2,134 字，净新增 20 条双名 | 否。只发布清洗后的句读候选与原句引文 |
| `gsc_level_1.txt` `gsc_level_2.txt` `gsc_level_3.txt` | ben-hua/general_standard_chinese | Apache-2.0 | 用字白名单分级 L1 3500 / L2 6500 / L3 8105（官方规范事实） | 分级结果进包（`chars.json` 的 `lvl`） |
| ~~`gsc_pinyin_with_tone.csv`~~ | ben-hua/general_standard_chinese | Apache-2.0 | **已评估、未使用，已从本目录删除。** 拼音/声调来自 pinyin-pro，白名单分级来自上面三份字表；CSV 的富化列（部首·笔画·五行·繁体·五笔）是爬百度汉语所得，来源不可核对，故部首/五行改由下方 Unihan 派生子集提供 | 否 |
| `cnname_attributes.json` | yyz945947732/cnname | MIT | 名用字属性表 269 字，其中 199 字在一级字表内＝L0 种子；性别倾向判定用其字表 | 是，JSON 原样保留并记指纹 |
| `jieba_dict.txt` | fxsjy/jieba 词典 | MIT | 现代词频 349,046 条，构建期生成「高频剔除表 + 同形标注表」与负面谐音词表 | 否。运行时只查两张小表，且词频**不作为正向质量凭据** |
| `unihan_krs_gsc.txt` | Unicode Unihan `kRSUnicode`（unicode.org，Unicode Terms of Use 免费使用） | Unicode | 从 Unihan.zip 抽取的派生子集：一二三级字表 8,105 字 → 康熙字典部首编号（取每条的第一个编号） | 否。构建期只把部首属 木(75)/火(86)/水(85)/金(167)/土(32) 五部的字推成卡片上的「部首」提示 |
| `dict_shape.json` `dict_gloss.json` | mapull/chinese-dictionary 的 `char_base.json` / `char_detail.json`，经 `scripts/derive-dict.mjs` 裁剪 | MIT | 派生：笔画、八类结构名、字义（优先取「本义」，去训诂括号、截断）。字义只对 L0 字进包，笔画/结构对全体 8,105 字进包 | 是：字义进 `gloss.json`，笔画/结构进 `chars.json` 的 `st`/`sx` |
| `line_gloss.tsv` | **本项目自撰**（1140 行，与候选/单字的原句逐条对应） | 本项目原创，随本仓库发布 | 出处今译：每个唯一原句一句白话释义，只解释句意，不增补典故与命理判断 | 是（`line_gloss.json`，按原句首次出现顺序的字符串数组） |
| `name_given_freq.json` | wainshine/Chinese-Names-Corpus 的 `Chinese_Names_Corpus（120W）.txt`，经 `scripts/derive-dict.mjs` 裁剪 | Apache-2.0 | 派生：把 114 万个真实姓名去掉首字（姓）后的用字计数，作为「该字在真实名字里有多常用」的**估算证据**（211 万次用字） | 是（`chars.json` 的 `gn` 字段；运行期换算成档位） |

> 部首提示陈述的是「这个字的康熙字典部首是什么」这一可核对的事实，不是「这个字五行属什么」的命理判断。民间按偏旁定五行只对这五部成立，其它部首的字没有可靠说法，因此一律留白（留白 ≠ 无五行）。本项目**不做**五行筛选、不做八字/五格、不给吉凶与「补缺」建议。笔画若日后要改用同一来源的 `kTotalStrokes`，不要重新引入那份爬取数据。

上游 LICENSE 全文副本随包发布（离线单文件版也要合规），已收在本目录 `licenses/`：

| 副本 | 上游 | 许可 |
|---|---|---|
| `licenses/chinese-poetry.txt` | chinese-poetry/chinese-poetry | MIT |
| `licenses/cnname.txt` | yyz945947732/cnname | MIT |
| `licenses/jieba.txt` | fxsjy/jieba | MIT |
| `licenses/pinyin-pro.txt` | zh-lx/pinyin-pro | MIT |
| `licenses/general_standard_chinese.txt` | ben-hua/general_standard_chinese | Apache-2.0 |
| `licenses/unihan-unicode.txt` | unicode.org（Unihan kRSUnicode） | Unicode License V3 |
| `licenses/chinese-dictionary.txt` | mapull/chinese-dictionary | MIT |
| `licenses/Chinese-Names-Corpus.txt` | wainshine/Chinese-Names-Corpus | Apache-2.0 |
| `licenses/wikisource-cc-by-sa-4.0.txt` | zh.wikisource.org（《乐府诗集》卷页整理本） | CC BY-SA 4.0 |

`licenses/` 与 `LICENSES.md` 一样是许可元数据、不是语料输入，`verify.mjs` 的输入指纹不覆盖它（否则改一句说明就会误报语料漂移）。

## 道法（第六本）为什么是逐条录入，而不是整本 vendoring

实测（`scripts/measure-daofa.mjs`，与 build-data 同一套口径）：同一副道家数据集里，道德经 5,267 字／25 对、周易 26,277 字／50 对、清静经 589 字／8 对，三本合并**净新增 63 对**（约 Pool-B 的 15%）；而庄子单本就"贡献" 479 对——这个数字是假的。

- **整本剔除三本**：`庄子.md` 实为《现代庄子》白话改写本（`思泉 ←「他那心思如喷泉」`、`天城 ←「那家伙被押送到深山老林去服刑」`），列子、黄帝阴符经夹现代注家语。取词等于引一本现代书，与 `shuimo.prologue` 同一条红线。
- **段级白话过滤器已证伪，不要用**：按现代虚词密度逐段剔除，在已知纯文言的现有五本对照组上只保留 **76.4%** 的段（阈值 0.14）；要把文言留到 94%，就只能剔掉 7.6% 的白话——它区分不了文言与文学性白话。8 字稀疏标记集更差，只剔 0.1%。结论：文言/白话只能在**整本**层面判断。
- **许可**：上游 `wobure/zhuzi-baijia-books` 的 license 标注为 unknown、内容是劝学网录入本；GitHub 上没找到许可清晰的道德经/周易纯文本数据集。古籍本文进公共领域，但现代整理本的标点是编辑成果，整本搬进包就是拿一本来源不明的录入本当"典籍"。
- **采用的路线**：只手工录入产生这 63 对里可用名字的 **22 条句读行**（逐行核对归属：象曰/彖曰/文言/系辞/说卦/章次），每对只保留一条最贴的出处行。卦标题行（`《周易》第12卦 天地否`）这类数据集脚手架一律不录，它曾贡献 7 条假新增（坤天/震坤/震泽/鼎鼎…）。`verify.mjs` 反向钉住：锐可/智慧/圣智/鼎金/坤天 等 33 个"只有整本才会出现"的名字必须在池外，语料一旦被换成 scraped 全本立刻 FAIL。

## 乐府（第七本）的取舍

- **来源分层**：《乐府诗集》本文是宋代郭茂倩辑的公共领域古籍；维基文库卷页的排校与句读是整理本（CC BY-SA 4.0）。我们只发布清洗后的候选与必要的原句引文，注释与考订一律自撰。抄录时与《四库全书》本交叉校字；维基文库个别生僻字（𪗰/䋎/䟤 等扩展区字符）按既有规则不进取词段。
- **不收《箜篌引》**：维基文库卷二十六该条正文只有唐代李贺拟作，汉古辞「公無渡河」仅见于解题引文——引文不是正文，收了就会把出处挂错，宁缺勿错。
- **《上山采蘼芜》按《玉台新咏》录入**：它不见于《乐府诗集》各卷页（已用站内搜索与卷五十八全文核对），但它是汉乐府（乐府诗类别层面无争议）。文本取自《玉台新咏》独立条目，出处标注以实际来源为准。
- **《木兰诗》只取其一**：卷二十五收两首，其二（「木兰抱杼嗟」）不取——其一即教材通行本，两首都收会让同一篇出现两套异文。
- **加书纪律**：`verify.mjs` 钉住乐府语料规模 429 段 / 2,134 字、净新增 20 条双名；全池只允许两条出处改判（依山 宋辞→乐府 gap 3→2、江可 楚辞→乐府 gap 3→2），改判必须间隔严格变小、逐条四元组断言，别的改动会直接 FAIL。

## 构建期依赖（不随包发布）

- pinyin-pro 3.29.5（MIT）：仅构建期跑，导出 8105 字全部读音/声调/带调拼写内联进 `chars.json`；运行时不打包该库，省 141 KB gzip。

## 打包工具链

Vite 8.3.4 · React / React-DOM 19.3.1 · TypeScript 5.9.3 · Tailwind 4.3.3（`@tailwindcss/vite` 4.3.3）· vite-plugin-singlefile 2.3.3 — 全部 MIT。

## 许可策略

语料与字表用 MIT / Apache-2.0 现成数据、归属保留；代码 100% 自写，不引入 gushi_namer 的源码与数据。古典诗文本身进公共领域，风险只来自现代整理本的注释与译文，故**不引入任何他人的现代译文**：`line_gloss.tsv` 是随本仓库原创撰写的逐句今译（只解释句意，不抄录古诗文网、程俊英等整理本的注释或译文），该文件为本项目原创内容，随本仓库发布；`shuimo.prologue` 是整首现代赏析短文，不参与取词，也不发布。
