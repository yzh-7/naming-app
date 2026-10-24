import { Component, type ReactNode } from 'react';

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl p-6 text-body sm:p-8">
        <h1 className="font-serif text-name">出错了</h1>
        <p className="mt-2 text-ink-2">页面渲染时发生异常。收藏与设置都保存在本机，刷新一般即可恢复；下面是错误信息。</p>
        <pre className="mt-3 overflow-auto rounded-ctl border border-line bg-surface-2 p-3 text-meta text-ink-2">{String(this.state.error?.message ?? this.state.error)}</pre>
        <button onClick={() => location.reload()} className="btn btn-primary mt-4">刷新</button>
      </div>
    );
  }
}
