import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NameCard, { Source } from './NameCard';
import { scoreItem, findItem, glossOf, lineGlossOf, sameSoundPeers, shapeTags } from '../engine/name';
import { POOL } from '../engine/data';
import { BOOK_LABEL, BOOK_ORDER, type Opts } from '../engine/types';
import { one } from '../testing';

const opts: Opts = {
  gender: 'any',
  genderWeak: false,
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
