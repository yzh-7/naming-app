import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// 夹具：一个必定抛错的子组件，用来把边界逼出来。
function Boom(): never {
  throw new Error('夹具异常');
}

describe('ErrorBoundary 组件', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('子树正常时原样渲染，边界不插手', () => {
    render(
      <ErrorBoundary>
        <p>正常内容</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('正常内容')).toBeInTheDocument();
    expect(screen.queryByText('出错了')).not.toBeInTheDocument();
  });

  it('子树抛错时换成兜底页，把错误信息写出来并保留刷新入口', () => {
    // React 会把被边界捕获的异常同时打到 console，这里静音，只断言渲染结果。
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: '出错了' })).toBeInTheDocument();
    expect(screen.getByText(/页面渲染时发生异常/)).toBeInTheDocument();
    expect(screen.getByText('夹具异常')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
  });

  it('边界只吞掉它包住的子树，同页其它部分照常渲染（局部崩溃不吞整页）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
        <p>边界外的内容</p>
      </>,
    );
    expect(screen.getByText('出错了')).toBeInTheDocument();
    expect(screen.getByText('边界外的内容')).toBeInTheDocument();
  });

  it('刷新按钮走 location.reload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
