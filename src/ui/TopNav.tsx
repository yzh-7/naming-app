import { useCallback } from 'react';

// 路由 tab：hash 形式见 App 的 tabFromHash（#/compose 与 #compose 等价）
export type Tab = 'gen' | 'compose' | 'fav' | 'block';

interface Props {
  current: Tab;
  favCount: number;
  blockCount: number;
  onNavigate?: (tab: Tab) => void;
  /** 由页头决定它在 flex 行里的位置：手机端整宽另起一行，桌面靠右 */
  className?: string;
}

const TABS: { tab: Tab; label: string; href: string }[] = [
  { tab: 'gen', label: '生成', href: '#/' },
  { tab: 'compose', label: '自选', href: '#/compose' },
  { tab: 'fav', label: '收藏', href: '#/fav' },
  { tab: 'block', label: '拉黑', href: '#/block' },
];

export default function TopNav({ current, favCount, blockCount, onNavigate, className }: Props) {
  const nav = useCallback(
    (tab: Tab) => (e: React.MouseEvent) => {
      if (!onNavigate) return;
      e.preventDefault();
      onNavigate(tab);
    },
    [onNavigate],
  );

  const count = (t: Tab) => (t === 'fav' ? favCount : t === 'block' ? blockCount : null);

  return (
    <nav aria-label="主导航" className={`seg ${className ?? ''}`}>
      {TABS.map(({ tab, label, href }) => {
        const n = count(tab);
        const text = n === null ? label : `${label} ${n}`;
        const cls = `seg-btn flex-1 sm:flex-none ${current === tab ? 'seg-on' : ''}`;
        return current === tab ? (
          <span key={tab} aria-current="page" className={`${cls} cursor-default`}>
            {text}
          </span>
        ) : (
          <a key={tab} href={href} onClick={nav(tab)} className={cls}>
            {text}
          </a>
        );
      })}
    </nav>
  );
}
