import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NameCard, { Source } from './NameCard';
import { genderOf, scoreItem, findItem, glossOf, lineGlossOf, sameSoundPeers, shapeTags } from '../engine/name';
import { POOL, REAL_ITEMS } from '../engine/data';
import { BOOK_LABEL, BOOK_ORDER, type Opts, type Result } from '../engine/types';
import { one } from '../testing';

const opts: Opts = {
  gender: 'any',
  wordOnly: true,
  source: 'all',
  length: 2,
  books: Object.fromEntries(BOOK_ORDER.map((b) => [b, true])) as Opts['books'],
  redupOnly: false,
  exclude: [],
  count: 12,
  search: '',
  title: '',
  sort: 'score',
  strokeMax: 0,
  noMonotone: false,
  popFloor: 0,
  mustChar: '',
  mustPos: 'any',
  avoidChars: '',
};

// 挑一个两个字都有字义的名，稳定断言字义出现在卡片上
const item = POOL.find((p) => [...p.name].every((c) => glossOf(c)))!;
const r = scoreItem('苏', item, opts, 0);

describe('NameCard 组件', () => {
  it('已收藏的名字在名字那一行就标出来，不必翻到按钮那一行；未收藏时不出现', () => {
    const { container, unmount } = render(<NameCard r={r} fav blocked={false} onFav={() => {}} onBlock={() => {}} />);
    // 名字那一行里的标记（不是卡片下方那个「已收藏」按钮）
    const nameRow = container.querySelector('article h3')!.closest('div')!;
    const chip = nameRow.querySelector('.chip');
    expect(chip?.textContent).toBe('已收藏');
    expect(chip).toHaveClass('chip-accent');
    unmount();
    render(<NameCard r={r} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    expect(screen.queryByText('已收藏')).toBeNull();
  });
  it('分数合计常驻在名字那一行：不点开「分数明细」也看得见那个总分', () => {
    const { container } = render(<NameCard r={r} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    const card = container.querySelector('article')!;
    const nameRow = card.querySelector('h3')!.parentElement!;
    const text = nameRow.textContent ?? '';
    expect(text).toContain('分数合计');
    expect(text, '常驻的那个数字就是排序用的总分').toContain(String(r.total));
    expect(nameRow.querySelector('details'), '分数合计不该在折叠里').toBeNull();
    const d = card.querySelector('details[data-block="score"]')!;
    expect(d, '卡片上必须有一个「分数明细」折叠').toBeTruthy();
    expect(d.textContent).toContain('分数明细');
    expect(d.hasAttribute('open'), '分数明细照旧默认折叠').toBe(false);
  });
  it('原句与今译常驻在卡片上，不再包在 details 里（出处才是这本应用的核心凭据）', () => {
    const { container } = render(<NameCard r={r} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    const card = container.querySelector('article')!;
    const gloss = lineGlossOf(r);
    const glossEl = [...card.querySelectorAll('p')].find((p) => (p.textContent ?? '').includes(gloss));
    expect(glossEl, '卡片里找不到今译那一段').toBeTruthy();
    expect(glossEl!.closest('details'), '今译不该再藏在折叠里').toBeNull();
    const marked = card.querySelector('mark');
    expect(marked, '原句里的取词段没有高亮').toBeTruthy();
    expect(marked!.closest('details'), '原句不该再藏在折叠里').toBeNull();
    // 卡上的折叠只有两种：分数明细，与（有 alternates 时）另有出处。出处那一块是常驻 div，不是折叠。
    const details = [...card.querySelectorAll('details')];
    expect(details.map((d) => d.getAttribute('data-block')).sort()).toEqual(
      r.alts?.length ? ['alts', 'score'] : ['score'],
    );
    expect(card.querySelector('[data-block="source"]')!.closest('details'), '出处块不该包在折叠里').toBeNull();
    for (const d of details)
      expect(d.hasAttribute('open'), `「${d.getAttribute('data-block')}」默认必须折叠`).toBe(false);
  });
  it('分数明细第一行是分数合计，那个数字就是排序用的总分', () => {
    render(<NameCard r={r} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    const d = Array.from(document.querySelectorAll('details')).find((x) => (x.textContent ?? '').includes('分数明细'));
    if (!d) throw new Error('卡片里没有分数明细');
    const first = d.querySelector('li');
    if (!first) throw new Error('分数明细里没有条目');
    expect(first.textContent).toContain('分数合计');
    expect(Number((first.textContent ?? '').replace(/[^0-9]/g, ''))).toBe(r.total);
    expect(r.total).toBeGreaterThan(0);
  });
  it('渲染名字、读音、出处与字义', () => {
    render(<NameCard r={r} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    expect(screen.getByRole('heading')).toHaveTextContent(r.full);
    expect(screen.getByText(r.readings.join(' '))).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(BOOK_LABEL[r.book])).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(glossOf(one([...r.name], '测试条目名的单字列表'))!)).length).toBeGreaterThan(
      0,
    );
  });
  it('原句下方给出今译，且今译与出处同一句', () => {
    render(<NameCard r={r} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    expect(screen.getByText('今译')).toBeInTheDocument();
    expect(screen.getByText(lineGlossOf(r))).toBeInTheDocument();
    expect(lineGlossOf(r).length).toBeGreaterThan(0);
  });
  it('收藏/拉黑/分享/复制按钮回调到父级', () => {
    const onFav = vi.fn();
    const onBlock = vi.fn();
    const onShare = vi.fn();
    const onCopy = vi.fn();
    render(
      <NameCard r={r} fav={false} blocked={false} onFav={onFav} onBlock={onBlock} onShare={onShare} onCopy={onCopy} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));
    fireEvent.click(screen.getByRole('button', { name: '拉黑' }));
    fireEvent.click(screen.getByRole('button', { name: '分享卡' }));
    fireEvent.click(screen.getByRole('button', { name: '复制信息' }));
    expect(onFav).toHaveBeenCalledOnce();
    expect(onBlock).toHaveBeenCalledOnce();
    expect(onShare).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledOnce();
  });
  it('已收藏时按钮文案变化，且不伪装成未收藏', () => {
    render(<NameCard r={r} fav blocked onFav={() => {}} onBlock={() => {}} />);
    expect(screen.getByRole('button', { name: '已收藏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已拉黑' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收藏' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拉黑' })).not.toBeInTheDocument();
  });
  it('findItem 能按 id 取回同一节点（收藏持久化的前提）', () => {
    expect(findItem(r.id)?.name).toBe(item.name);
  });
});

// 警示分区需要两类旗标：同形（弱警示）与其他（醒目警示）。按数据挑，不写死条目名。
const scoredAll = POOL.map((x) => scoreItem('苏', x, opts, 0));
const shadowR = scoredAll.find((x) => x.flags.some((f) => f.startsWith('同形')));
const loudR = scoredAll.find((x) => x.flags.some((f) => !f.startsWith('同形')));
// 出处窗口需要一个长句：命中处既不贴着句首也不贴着句尾
const longR = scoredAll.find((x) => {
  const at = x.line.indexOf(x.seg);
  return x.gap === 1 && x.line.length > 60 && at > 30 && at < x.line.length - 30;
});

/** 只取出处行里属于原文的那一段（省略号、正文、高亮），不含出处信息与小字 */
function excerptOf(el: HTMLElement) {
  return Array.from(el.children)
    .filter((c) => c.tagName === 'SPAN' || c.tagName === 'MARK')
    .map((c) => c.textContent ?? '')
    .join('');
}

describe('NameCard 警示分区', () => {
  it('同形旗标走弱警示，不占醒目位', () => {
    expect(shadowR ?? null).not.toBeNull();
    render(<NameCard r={shadowR!} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    const chip = screen.getByText(/^同形：/);
    expect(chip.className).toContain('chip-warn');
    expect(chip.className).not.toContain('chip-danger');
  });

  it('拗口、生僻这类旗标走醒目警示', () => {
    expect(loudR ?? null).not.toBeNull();
    const flag = (loudR!.flags.find((f) => !f.startsWith('同形')) ?? '').trim();
    render(<NameCard r={loudR!} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    const chip = screen.getByText(flag);
    expect(chip.className).toContain('chip-danger');
  });

  it('没有旗标时整块警示不出现，不给干净名字叠警示色', () => {
    // 断言的范围是整张卡，所以选的这条还得满足「合注里没有小注」：
    // NameCard 的字形小注也是 chip-warn，note 一出现就跟旗标混在一起，语料一变就会误报。
    const clean = scoredAll.find((x) => x.flags.length === 0 && !shapeTags(x.name).note);
    expect(clean ?? null, '用例前提：语料里得有一条既没有旗标、合注里也没有小注的名').not.toBeNull();
    const { container } = render(
      <NameCard r={clean!} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />,
    );
    expect(container.querySelector('.chip-danger')).toBeNull();
    expect(container.querySelector('.chip-warn')).toBeNull();
  });
});

describe('NameCard 出处行', () => {
  it('长句只取命中处前后各一小句，两端用省略号，高亮仍是取词段的两字', () => {
    expect(longR ?? null).not.toBeNull();
    const r2 = longR!;
    const { container } = render(<Source r={r2} />);
    const root = container.firstChild as HTMLElement;
    const text = excerptOf(root);
    expect(text.startsWith('…')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThan(r2.line.length);
    // 命中前只带一小句：原文开头那句不在窗口里
    expect(text).not.toContain(r2.line.slice(0, 10));
    expect(
      Array.from(container.querySelectorAll('mark'))
        .map((m) => m.textContent)
        .join(''),
    ).toBe(r2.seg.slice(0, 2));
    expect(root.textContent).toContain('取词段第');
  });

  it('取词段跨在两句读之间时退回整句，不硬裁', () => {
    expect(longR ?? null).not.toBeNull();
    const r2 = longR!;
    const at = r2.line.indexOf(r2.seg);
    // 合成的落点：foot/gap 这两个数是手工摆出来的（语料里没有这样一条），
    // 目的是把取词段挪到「同一小句末字」与「下一小句里」两侧，让命中跨句、窗口取不到单一小句。
    const crossed = { ...r2, foot: r2.line.slice(at).indexOf('，'), gap: 3 };
    const { container } = render(<Source r={crossed} />);
    const root = container.firstChild as HTMLElement;
    const text = excerptOf(root);
    expect(text).toBe(`${r2.line}。`);
    expect(text).not.toContain('…');
    expect(root.textContent).toContain('跨字取词');
  });

  it('短句不截窗、不加省略号', () => {
    // 三个条件都是为了让这条断言咬得住东西：
    // 28 是 NameCard.tsx 里的 WINDOW_MAX（改那一处也得改这里）；小句数 >= 3 保证「整行不截」
    // 这条早退守卫真在被测的位置上——换掉这条守卫，这种多小句的短句会被截成带省略号的窗口
    //（实测白鹿 21 字 4 小句、君君 26 字 6 小句、德博 26 字 5 小句都会因此变红）。
    const short = scoredAll.find(
      (x) => x.gap === 1 && x.line.length > 0 && x.line.length <= 28 && (x.line.match(/[，、；：]/g) ?? []).length >= 3,
    );
    expect(short ?? null, '用例前提：语料里得有一条不长、但小句够多的整句').not.toBeNull();
    const { container } = render(<Source r={short!} />);
    const text = excerptOf(container.firstChild as HTMLElement);
    // 短句整句给出，末尾补一个句号，不出现省略号
    expect(text).toBe(`${short!.line}。`);
    expect(text).not.toContain('…');
  });

  it('取词段在原句里找不到时如实说明，不假装高亮成功', () => {
    // 合成的取词段：语料里不存在这种 seg，测的是防御分支，不是真实条目
    const broken = { ...r, seg: '不可能出现的取词段' };
    const { container } = render(<Source r={broken} />);
    expect(container.textContent).toContain('取词段「不可能出现的取词段」');
    expect(container.textContent).not.toContain('…');
  });
});

describe('NameCard 同音与同篇', () => {
  it('同音写法列出来并给来源说明；给了回调就出现「按拼音看」', () => {
    // 选例条件：这一条的候选至少两条。组件里的上限是 4（NameCard.tsx），当前语料里同音候选最多的
    // 一条只有 3 个（实测最多的是 焱焱），够不到那个上限，所以上限数字本身在这一层测不出来；
    // 这里钉住的是「引擎给几条就列几条」——把上限改成 1 或 2 都会红。
    const withPeers = scoredAll.find((x) => sameSoundPeers(x.name, 4).length >= 2);
    expect(withPeers ?? null, '用例前提：语料里得有一条同音候选不止一个的名').not.toBeNull();
    const peers = sameSoundPeers(withPeers!.name, 4);
    expect(peers.length, '用例前提：这一条的候选不止一个，否则「列全」这条断言咬不住东西').toBeGreaterThanOrEqual(2);
    const onSameSound = vi.fn();
    render(
      <NameCard
        r={withPeers!}
        fav={false}
        blocked={false}
        onFav={() => {}}
        onBlock={() => {}}
        onSameSound={onSameSound}
      />,
    );
    // 期望值就是引擎给出的那份候选（组件的契约是「引擎给几条列几条」），不是另写一遍名字
    expect(screen.getByText(peers.map((p) => p.name).join('、'))).toBeInTheDocument();
    expect(peers.length).toBeGreaterThan(1);
    expect(screen.getByText('去声调同音，按常用读音')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '按拼音看' }));
    expect(onSameSound).toHaveBeenCalledOnce();
  });

  it('没有同音写法时不出现空栏目', () => {
    const noPeers = scoredAll.find((x) => sameSoundPeers(x.name, 4).length === 0);
    expect(noPeers ?? null).not.toBeNull();
    render(<NameCard r={noPeers!} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />);
    expect(screen.queryByText('去声调同音，按常用读音')).not.toBeInTheDocument();
  });

  it('同一篇里还有别的候选时给出「同篇还有 N 条」，只有一条时不给', () => {
    const onTitle = vi.fn();
    const { unmount } = render(
      <NameCard
        r={r}
        fav={false}
        blocked={false}
        onFav={() => {}}
        onBlock={() => {}}
        onTitle={onTitle}
        sameTitle={3}
      />,
    );
    const btn = screen.getByRole('button', { name: '同篇还有 2 条' });
    expect(btn).toHaveAttribute('title', `《${r.title}》里还有 2 条候选`);
    fireEvent.click(btn);
    expect(onTitle).toHaveBeenCalledOnce();
    unmount();
    render(
      <NameCard
        r={r}
        fav={false}
        blocked={false}
        onFav={() => {}}
        onBlock={() => {}}
        onTitle={onTitle}
        sameTitle={1}
      />,
    );
    expect(screen.queryByRole('button', { name: /^同篇还有/ })).not.toBeInTheDocument();
  });
});
describe('成词依据：卡片直接把「是不是硬凑」的证据写出来', () => {
  const card = (it: (typeof POOL)[number]) =>
    render(
      <NameCard r={scoreItem('苏', it, opts, 0)} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />,
    );

  it('语料里挨着出现过的，标签写明出现次数', () => {
    const it = one(
      POOL.filter((p) => (p.a ?? 0) >= 3),
      '池内应有语料内多次相邻的名字',
    );
    card(it);
    expect(screen.getByText(`成词 · 语料内相邻 ${it.a ?? 0} 次`)).toBeInTheDocument();
  });
  it('没有任何依据的，标签直说「未见成词依据」，不含糊过去', () => {
    const it = one(
      POOL.filter((p) => !(p.a ?? 0) && !p.w && !p.redup),
      '池内应有无成词依据的名字',
    );
    card(it);
    expect(screen.getByText('未见成词依据')).toBeInTheDocument();
  });
  it('跨字取词把原句里相邻的词剪开了，提示里写出被剪开的是哪个词', () => {
    const it = one(
      POOL.filter((p) => p.spl),
      '池内应有被剪开原词的条目',
    );
    card(it);
    expect(screen.getByTitle(new RegExp(`拆词：原句里相邻的「${it.spl}」被剪开`))).toBeInTheDocument();
  });
  it('单名不提成词这件事（单字谈不上成词）', () => {
    const single = { ...one(POOL, '主池首条'), name: '东', char: '东' } as unknown as (typeof POOL)[number];
    card(single);
    expect(screen.queryByText(/成词/)).not.toBeInTheDocument();
  });
});

describe('真实用名标签', () => {
  it('语料里有记录的写明多少人用过；没有记录的不挂标签', () => {
    const named = one(
      POOL.filter((p) => (p.rn ?? 0) >= 10),
      '池内应有真实语料里多人用过的名字',
    );
    const bare = one(
      POOL.filter((p) => !p.rn),
      '池内应有真实语料里没记录的名字',
    );
    const first = render(
      <NameCard r={scoreItem('袁', named, opts, 0)} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />,
    );
    expect(first.getByText(`真名 · ${named.rn ?? 0} 人用过`)).toBeInTheDocument();
    first.unmount();
    const second = render(
      <NameCard r={scoreItem('袁', bare, opts, 0)} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />,
    );
    expect(second.queryByText(/真名 · /)).not.toBeInTheDocument();
  });
  it('两条证据打架时不在归属上偷偷改口径，而是在标签提示里说明', () => {
    const conflicting = POOL.find((p) => genderOf(p.name, { n: p.rn, side: p.rs }).conflict);
    const it = one(conflicting ? [conflicting] : [], '池内应有字表与真实语料判定不一致的名字');
    const tag = genderOf(it.name, { n: it.rn, side: it.rs });
    render(
      <NameCard r={scoreItem('袁', it, opts, 0)} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />,
    );
    expect(screen.getAllByTitle(new RegExp(tag.conflict as string)).length).toBeGreaterThan(0);
  });
});
describe('真实人名档的出处行', () => {
  it('不是一段空原文，而是写明「非典籍出处」与语料次数，且常驻不在折叠里', () => {
    const item = one(REAL_ITEMS, '真实人名档应有条目');
    const { container } = render(
      <NameCard r={scoreItem('袁', item, opts, 0)} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />,
    );
    const card = container.querySelector('article')!;
    const line = screen.getByText(new RegExp(`真实人名 · 语料里 ${item.rn} 人用过（非典籍出处）`));
    expect(line).toBeInTheDocument();
    expect(line.closest('details'), '这一行不该藏在折叠里').toBeNull();
    expect(screen.getByText(/这条不是典籍出处/)).toBeInTheDocument();
    // 名字那一行的「真名 · N 人用过」也常驻：真实人名档没有原句，这一行就是它的证据
    const nameRow = card.querySelector('h3')!.closest('div')!;
    expect(nameRow.textContent).toContain(`真名 · ${item.rn} 人用过`);
    expect(screen.queryByText(/未见成词依据/)).not.toBeInTheDocument();
  });
});
describe('今译待补', () => {
  it('lg = -1 的条目在卡片上明说「今译待补」，不是空着一块', () => {
    const item = one(
      POOL.filter((it) => it.lg === -1),
      '应有一条出处句还没今译',
    );
    const { container } = render(
      <NameCard r={scoreItem('袁', item, opts, 0)} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />,
    );
    const source = container.querySelector('[data-block="source"]')!;
    expect(source.textContent).toContain('今译待补');
    expect(source.textContent).toMatch(/还没有现代汉语今译/);
    expect(document.body.textContent).toContain(item.line); // 原文与取词段照引，缺的只有译文
  });
});

describe('另有 N 处出处：主出处之外的可核对出处挂在同一张卡上', () => {
  const item = one(
    POOL.filter((p) => (p.alts?.length ?? 0) > 1),
    '用例前提：池里得有在主出处之外还能核对到多处句读的名字',
  );
  const rAlt = scoreItem('林', item, opts, 0);
  const single = one(
    POOL.filter((p) => !p.alts && p.book !== 'real'),
    '用例前提：池里得有只有一处出处的典籍候选',
  );
  const rOne = scoreItem('林', single, opts, 0);
  const renderCard = (r: Result) =>
    render(<NameCard r={r} fav={false} blocked={false} onFav={() => {}} onBlock={() => {}} />).container.querySelector(
      'article',
    )!;

  it('折叠标题写的是处数；展开之后每一处一条，不许只列一部分', () => {
    const card = renderCard(rAlt);
    const d = card.querySelector('details[data-block="alts"]');
    if (!d) throw new Error(`带 ${item.alts?.length} 处 alternates 的卡必须有「另有出处」这一区`);
    expect(d.querySelector('summary')?.textContent).toBe(`另有 ${item.alts!.length} 处出处`);
    expect(d.hasAttribute('open'), '这一区默认折叠：卡上常驻的仍是主出处那一句').toBe(false);
    const items = [...d.querySelectorAll('li')];
    expect(items.length, '展开区里的条目数必须等于 alternates 处数').toBe(item.alts!.length);
    expect(d.textContent).toContain('另有出处'.slice(0, 2));
  });
  it('每一处都给出书·篇＋原句（那两个取字高亮）＋今译或「今译待补」', () => {
    const card = renderCard(rAlt);
    const items = [...card.querySelectorAll('details[data-block="alts"] li')];
    for (let i = 0; i < items.length; i++) {
      const a = item.alts![i]!;
      const li = items[i]!;
      const c1 = a.line.charAt(a.at);
      const c2 = a.line.charAt(a.at2);
      const marks = [...li.querySelectorAll('mark')].map((m) => m.textContent);
      expect(marks, `第 ${i + 1} 处必须把那两个取字高亮出来`).toEqual(a.at2 - a.at === 1 ? [`${c1}${c2}`] : [c1, c2]);
      expect(li.textContent, '每一处都要写清是哪本书的哪一篇').toContain(BOOK_LABEL[a.book]);
      expect(li.textContent).toContain(a.title);
      expect(li.textContent).toContain(a.author || '');
      expect(
        [...li.querySelectorAll('p')].some((p) => /今译/.test(p.textContent ?? '')),
        '今译或待补必须在',
      ).toBe(true);
      if (a.lg === -1) expect(li.textContent).toContain('今译待补');
      else expect(li.textContent).toContain(lineGlossOf(a));
    }
  });
  it('真实人名档与只有一处出处的典籍卡都不显示这一区（不装作有别处）', () => {
    const real = one(REAL_ITEMS, '真实人名档首条');
    const cardReal = renderCard(scoreItem('林', real, opts, 0));
    expect(cardReal.querySelector('details[data-block="alts"]'), '真实人名卡不许有这个区').toBeNull();
    const cardOne = renderCard(rOne);
    expect(cardOne.querySelector('details[data-block="alts"]'), '只有一处出处的卡不许有这个区').toBeNull();
    expect(cardOne.querySelectorAll('details')).toHaveLength(1);
  });
  it('多了这一区也不许动常驻的那一层：主原句、今译与分数合计在不点开任何折叠时都读得到', () => {
    const card = renderCard(rAlt);
    const source = card.querySelector('[data-block="source"]')!;
    expect(source.closest('details'), '主出处块不该被包进折叠').toBeNull();
    expect([...source.querySelectorAll('mark')].length, '主原句里的取词段高亮不许少').toBeGreaterThan(0);
    const gloss = lineGlossOf(rAlt);
    if (gloss) expect(source.textContent).toContain(gloss);
    const nameRow = card.querySelector('h3')!.closest('div')!;
    expect(nameRow.textContent).toContain('分数合计');
    expect(nameRow.textContent).toContain(String(rAlt.total));
    // 主出处的那句原句不许被 alternates 顶掉：卡上第一句原文就是它
    expect(source.textContent).toContain(rAlt.line.slice(0, 4));
  });
});
