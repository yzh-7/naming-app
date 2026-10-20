import { useCallback } from 'react';

// 路由 tab：hash 形式见 App 的 tabFromHash（#/compose 与 #compose 等价）
export type Tab = 'gen' | 'compose' | 'fav' | 'block';

interface Props {
  current: Tab;
  favCount: number;
  blockCount: number;
  onNavigate?: (tab: Tab) => void;
}

const linkCls = 'whitespace-nowrap rounded px-3 py-1.5 transition-colors';
const activeCls = `${linkCls} bg-neutral-900 text-white`;
const idleCls = `${linkCls} text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800`;

export default function TopNav({ current, favCount, blockCount, onNavigate }: Props) {
  const nav = useCallback((tab: Tab) => (e: React.MouseEvent) => {
    if (!onNavigate) return;
    e.preventDefault();
    onNavigate(tab);
  }, [onNavigate]);

  return (
    <nav role="navigation" aria-label="主导航" className="flex flex-wrap gap-1 text-sm">
      {current === 'gen'
        ? <span aria-current="page" className={activeCls}>生成</span>
        : <a href="#/" onClick={nav('gen')} className={idleCls}>生成</a>}
      {current === 'compose'
        ? <span aria-current="page" className={activeCls}>自选</span>
        : <a href="#/compose" onClick={nav('compose')} className={idleCls}>自选</a>}
      {current === 'fav'
        ? <span aria-current="page" className={activeCls}>收藏 {favCount}</span>
        : <a href="#/fav" onClick={nav('fav')} className={idleCls}>收藏 {favCount}</a>}
      {current === 'block'
        ? <span aria-current="page" className={activeCls}>拉黑 {blockCount}</span>
        : <a href="#/block" onClick={nav('block')} className={idleCls}>拉黑 {blockCount}</a>}
    </nav>
  );
}
