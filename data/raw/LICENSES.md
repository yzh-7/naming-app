# 原始数据来源与许可

本文档记录构建期输入的上游、许可与用途。运行时产物（`src/data/*.json`）不包含本目录原文，只包含清洗后的候选与查表数据。

`scripts/verify.mjs` 用 `data/raw/SHA256SUMS` 校验本目录的字节一致。语料一旦变化，实测的候选池规模（种子版基线 463 条，当前扩表版 1,525 条）即不可复现。

## 输入清单

| 文件 | 上游 | 许可 | 用途 | 是否进包 |
|---|---|---|---|---|
| `shijing.json` `chuci.json` `lunyu.json` `shuimo.json` `song300.json` | chinese-poetry/chinese-poetry | MIT | 语料：诗经 305 首、楚辞 65 篇、论语 20 篇、水墨唐诗 176 首、宋词三百首 280 首 | 否，只发布清洗后的句读候选 |
| `daofa.json` | 本仓库手工录入，22 条句读行，逐行核对归属（《老子》王弼本系通行本、《周易》经与十翼、《清静经》） | 古籍本文属公共领域；录入内容为原文短句，不含注释与译文 | 第六部语料「道法」，池内按书计数 39 条（`meta.per_book.daofa`），全部由这 22 行派生 | 否，这 22 行以 `candidates.json` 的 `line` 字段发布 |
| `yuefu.json` | 郭茂倩（宋）《乐府诗集》二十篇（汉乐府 13、北朝乐府 5、南朝乐府 2，卷号见每篇 `chapter` 注记），文本自中文维基文库各卷页抄录，并与《四库全书》本交叉校字 | 原集属公共领域；维基文库整理本（排校与句读）为 CC BY-SA 4.0，全文副本见 `licenses/wikisource-cc-by-sa-4.0.txt` | 第七部语料「乐府」，429 段、2,134 字，池内按书计数 22 条，其中净新增 20 条 | 否，只发布清洗后的句读候选与原句引文 |
| `gsc_level_1.txt` `gsc_level_2.txt` `gsc_level_3.txt` | ben-hua/general_standard_chinese | Apache-2.0 | 用字白名单分级：一级 3,500、二级 6,500、三级 8,105 | 分级结果进包（`chars.json` 的 `lvl`） |
| ~~`gsc_pinyin_with_tone.csv`~~ | ben-hua/general_standard_chinese | Apache-2.0 | 已评估、未使用，已从本目录删除。拼音与声调来自 pinyin-pro，白名单分级来自上述三份字表。该 CSV 的富化列（部首、笔画、五行、繁体、五笔）来自对字典站点的抓取，来源无法核对，因此部首与五行数据改由下面的 Unihan 派生子集提供 | 否 |
| `cnname_attributes.json` | yyz945947732/cnname | MIT | 名用字属性表 269 字，其中 199 字在一级字表内，构成 L0 种子；性别倾向判定使用其字表 | 是，JSON 原样保留并计入指纹 |
| `jieba_dict.txt` | fxsjy/jieba 词典 | MIT | 现代词频 349,046 条，构建期生成高频剔除表、同形标注表与负面谐音词表 | 否，运行时只查两张小表，词频不作为正向质量依据 |
| `unihan_krs_gsc.txt` | Unicode Unihan `kRSUnicode`（unicode.org） | Unicode License V3 | 从 Unihan.zip 抽取的派生子集：一二三级字表 8,105 字对应康熙字典部首编号，每条取第一个编号 | 否，构建期只把部首属木（75）、火（86）、水（85）、金（167）、土（32）五部的字推成卡片上的「部首」提示 |
| `dict_shape.json` `dict_gloss.json` | mapull/chinese-dictionary 的 `char_base.json` 与 `char_detail.json`，经 `scripts/derive-dict.mjs` 裁剪 | MIT | 派生数据：笔画、八类结构名、字义（优先取「本义」，去训诂括号并截断）。字义只对 L0 字进包，笔画与结构对全部 8,105 字进包 | 是，字义进 `gloss.json`，笔画与结构进 `chars.json` 的 `st`、`sx` |
| `line_gloss.tsv` | 本项目自撰，1,140 行，与候选及单字名的原句逐条对应 | 本项目原创，随本仓库发布 | 出处今译：每个唯一原句配一句白话释义，只解释句意，不增补典故与命理判断 | 是，进 `line_gloss.json`，按原句首次出现顺序的字符串数组 |
| `name_given_freq.json` | wainshine/Chinese-Names-Corpus 的 `Chinese_Names_Corpus（120W）.txt`，经 `scripts/derive-dict.mjs` 裁剪 | Apache-2.0 | 派生数据：对 114 万条真实姓名去掉首字后的用字计数（共 211 万次用字），用作字在真实姓名中常见程度的估算 | 是，进 `chars.json` 的 `gn` 字段，运行时换算为档位 |

## 关于部首与笔画

部首提示陈述的是「该字的《康熙字典》部首属于哪一部」这一可核对的事实，不是五行归属判断。民间按偏旁定五行的做法只对木、火、水、金、土五部成立，其它部首没有可靠对应，因此一律不标注；未标注不代表该字没有五行属性。本项目不提供五行筛选、八字与五格计算、吉凶或「补缺」建议。

若日后笔画改用同一来源的 `kTotalStrokes`，也不要重新引入已删除的抓取数据。

## 道法语料的录入方式

该部语料采用手工录入 22 条句读行，而不是整本 vendoring。依据如下（`scripts/measure-daofa.mjs` 实测，与 `build-data.mjs` 同一口径）：

- 同一道家数据集内，道德经 5,267 字贡献 25 对、周易 26,277 字贡献 50 对、清静经 589 字贡献 8 对，三本合并净新增 63 对，约占候选池的 15%。
- 庄子单本名义上贡献 479 对，但该文本实为《现代庄子》白话改写本（例如「思泉」出自「他那心思如喷泉」、「天城」出自「那家伙被押送到深山老林去服刑」）；列子、黄帝阴符经夹带现代注家语。以整本取词等同于引用现代整理本，与 `shuimo.prologue` 的排除理由相同。
- 段级白话过滤器不可用。按现代虚词密度逐段剔除，阈值 0.14 时在已知纯文言的其余五部对照语料上只保留 76.4% 的段；若要把文言保留率提高到 94%，就只能剔除 7.6% 的白话，该指标无法区分文言与文学性白话。改用 8 字稀疏标记集效果更差，只剔除 0.1%。文言与白话的判定只能在整本层面进行。
- 许可方面：上游 `wobure/zhuzi-baijia-books` 的许可标注为 unknown，内容为录入本。未找到许可清晰的道德经、周易纯文本数据集。古籍本文属公共领域，但现代整理本的标点属于编辑成果，整本进包会引入来源不明的录入本。
- 采用路线：只录入产生这 63 对中可用名字所需的 22 条句读行，逐行核对归属（象曰、彖曰、文言、系辞、说卦、章次），每一对只保留一条最贴近的出处行。数据集脚手架行（如「《周易》第12卦 天地否」）一律不录，此类行曾贡献 7 条无效新增（坤天、震坤、震泽、鼎鼎等）。
- `verify.mjs` 反向断言：锐可、智慧、圣智、鼎金、坤天等 33 个只在整本语料中才会出现的名字必须位于池外。语料被替换为整本抓取文本时门禁直接失败。

## 乐府语料的取舍

- 来源分层：《乐府诗集》本文是宋代郭茂倩辑的公共领域古籍，维基文库卷页的排校与句读属于整理本（CC BY-SA 4.0）。本仓库只发布清洗后的候选与必要的原句引文，注释与考订自行撰写。抄录时与《四库全书》本交叉校字；个别扩展区生僻字符（𪗰、䋎、䟤 等）按既有规则不进取词段。
- 不收《箜篌引》：维基文库卷二十六该条正文只有唐代李贺拟作，汉古辞「公無渡河」仅见于解题引文。引文不属于正文，收录会导致出处标注错误。
- 《上山采蘼芜》按《玉台新咏》录入：该诗不见于《乐府诗集》各卷页（已用站内搜索与卷五十八全文核对），类别上属汉乐府。文本取自《玉台新咏》独立条目，出处标注以实际来源为准。
- 《木兰诗》只取其一：卷二十五收两首，其二（「木兰抱杼嗟」）不取。其一即通行教材本，两首都收会在同一篇内引入两套异文。
- 加书纪律：`verify.mjs` 钉住乐府语料规模 429 段、2,134 字与按书新增 22 条；全池只允许两条出处改判，即「依山」挂到乐府《琅琊王歌辞》「猛虎依深山」、「江可」挂到乐府《江南》「江南可采莲」，两条的间隔都必须从 3 缩短为 2，并按名字、典籍、篇名、原句、音步下标、间隔逐条断言。其它改动直接失败。

## 许可元数据的范围

`licenses/` 目录与本文件属于许可元数据，不属于语料输入，`verify.mjs` 的输入指纹不覆盖它们，否则修改一句说明就会被误判为语料漂移。

上游许可全文副本随包发布（离线单文件版同样需要满足归属要求），位于本目录 `licenses/`：

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

## 构建期依赖

- pinyin-pro 3.29.5（MIT）：仅在构建期运行，导出 8,105 字的读音、声调与带调拼写并内联进 `chars.json`。运行时不打包该库，节省 141 KB gzip。

## 构建工具链

Vite 8.3.4、React 与 React-DOM 19.3.1、TypeScript 5.9.3、Tailwind 4.3.3（`@tailwindcss/vite` 4.3.3）、vite-plugin-singlefile 2.3.3，均为 MIT。

## 许可策略

语料与字表使用 MIT 或 Apache-2.0 的现成数据并保留归属。代码全部自行编写，不引入 gushi_namer 的源码与数据。古典诗文本身属公共领域，许可风险来自现代整理本的注释与译文，因此不引入任何他人的现代译文：`line_gloss.tsv` 是本项目原创撰写的逐句今译，只解释句意，不引用古诗文网、程俊英等整理本的注释或译文；`shuimo.prologue` 是现代赏析短文，不参与取词，也不发布。
