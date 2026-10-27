import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from './ui/ErrorBoundary';
import './styles.css';

// SW 注册与更新提示由 <App> 内的 usePwa 处理（便于展示「有新版本」与离线状态）
const root = createRoot(document.getElementById('root')!);

// App 连带数据模块（候选池、字表、释义，约 1.4 MB）走动态 import：
// 数据文件坏了或离线缓存坏了时，静态 import 会在渲染前抛错，页面整个空白且没有任何说明；
// 换成动态加载后至少能留下一句可操作的话和一个刷新按钮。
async function boot() {
  try {
    const { default: App } = await import('./App');
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
  } catch (e) {
    console.error('应用数据加载失败', e);
    root.render(
      <div className="mx-auto max-w-xl p-6 text-body sm:p-8">
        <h1 className="font-serif text-name">数据加载失败</h1>
        <p className="mt-2 text-ink-2">
          应用的候选池与字表没能读出来（多半是更新中断或本机缓存坏了）。先刷新试试；
          还不行就在浏览器里清掉本站的站点数据／缓存，再重新打开。收藏与设置存在本机，不会被这次刷新清掉。
        </p>
        <pre className="mt-3 overflow-auto rounded-ctl border border-line bg-surface-2 p-3 text-meta text-ink-2">
          {String((e as Error | undefined)?.message ?? e)}
        </pre>
        <button onClick={() => location.reload()} className="btn btn-primary mt-4">
          刷新
        </button>
      </div>,
    );
  }
}

boot();
