// PWA 运行时：离线提示、新版本就绪提示、以及「什么时候才允许自动刷新」的判据。
// 这里用假的服务Worker替身：jsdom 不提供 navigator.serviceWorker，注册与控制权接管都要自己搭。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePwa } from './pwa';
import { APP_VERSION } from '../engine/data';

type Listener = (e: unknown) => void;

class FakeTarget {
  private map = new Map<string, Listener[]>();
  addCount = 0;
  removeCount = 0;
  addEventListener(type: string, fn: Listener) {
    this.addCount += 1;
    const list = this.map.get(type) ?? [];
    list.push(fn);
    this.map.set(type, list);
  }
  removeEventListener(type: string, fn: Listener) {
    this.removeCount += 1;
    const list = this.map.get(type) ?? [];
    this.map.set(
      type,
      list.filter((f) => f !== fn),
    );
  }
  dispatch(type: string) {
    for (const f of [...(this.map.get(type) ?? [])]) f({ type });
  }
  /** 某个事件上挂着几个监听器：卸载是否真的摘干净，看这个数 */
  listenerCount(type: string) {
    return (this.map.get(type) ?? []).length;
  }
}

class FakeWorker extends FakeTarget {
  state = 'activated';
  posted: unknown[] = [];
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
}

class FakeRegistration extends FakeTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
}

class FakeContainer extends FakeTarget {
  controller: FakeWorker | null = null;
  registered: string[] = [];
  registerPromise = Promise.resolve<FakeRegistration>(new FakeRegistration());
  register(url: string) {
    this.registered.push(url);
    return this.registerPromise;
  }
}

/** 把界面挂到一个只读 usePwa 返回值的小组件上，断言全部走界面 */
function Harness() {
  const { offline, updateReady, applyUpdate } = usePwa();
  return (
    <div>
      <span data-offline={offline ? 'yes' : 'no'}>{offline ? '当前离线' : '当前联网'}</span>
      {updateReady && <span data-ready>有新版本可用</span>}
      <button onClick={applyUpdate}>立即更新</button>
    </div>
  );
}

let container: FakeContainer;
let reload: ReturnType<typeof vi.fn>;

/** 装一次替身：http(s) 场景下 usePwa 才会去注册 */
function install(opts: { protocol?: string; controller?: FakeWorker | null; onLine?: boolean } = {}) {
  container = new FakeContainer();
  container.controller = opts.controller ?? null;
  const reg = new FakeRegistration();
  container.registerPromise = Promise.resolve(reg);
  reload = vi.fn();
  Object.defineProperty(window.navigator, 'serviceWorker', { value: container, configurable: true });
  if (opts.onLine !== undefined)
    Object.defineProperty(window.navigator, 'onLine', { value: opts.onLine, configurable: true });
  vi.stubGlobal('location', { protocol: opts.protocol ?? 'http:', reload, href: 'https://example.test/' });
  return { container, reg, reload };
}

afterEach(() => {
  cleanupStubs();
  vi.restoreAllMocks();
});

function cleanupStubs() {
  delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
  // onLine 也是 defineProperty 钉在 navigator 上的 own 属性（jsdom 原本挂在原型上），
  // 不删就会一直留到本文件结束，后面的用例都带着它跑。
  delete (window.navigator as { onLine?: unknown }).onLine;
  vi.unstubAllGlobals();
}

describe('usePwa 离线提示', () => {
  it('navigator.onLine 为假时开局报离线，为真时开局报联网', () => {
    install({ onLine: false });
    const first = render(<Harness />);
    expect(screen.getByText('当前离线')).toBeInTheDocument();
    first.unmount(); // 两份替身之间要把前一份卸掉，否则「当前离线/当前联网」在同一次用例里歧义
    cleanupStubs();
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    install();
    render(<Harness />);
    expect(screen.getByText('当前联网')).toBeInTheDocument();
  });

  it('联网与断网事件来回切，提示跟着变；卸载时把两个监听都摘掉', () => {
    install();
    const removed = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Harness />);
    expect(screen.getByText('当前联网')).toBeInTheDocument();
    fireEvent(window, new Event('offline'));
    expect(screen.getByText('当前离线')).toBeInTheDocument();
    fireEvent(window, new Event('online'));
    expect(screen.getByText('当前联网')).toBeInTheDocument();
    unmount();
    const types = removed.mock.calls.map((c) => c[0]);
    expect(types).toContain('offline');
    expect(types).toContain('online');
  });
});

describe('usePwa 注册服务Worker', () => {
  it('file:// 或单文件版静默跳过，不注册也不报错', () => {
    const { container: c } = install({ protocol: 'file:' });
    render(<Harness />);
    expect(c.registered).toEqual([]);
  });

  it('注册参数带上版本号，与页脚和 sw.js 的回退链同源', async () => {
    const { container: c } = install();
    render(<Harness />);
    await vi.waitFor(() => expect(c.registered).toHaveLength(1));
    const url = c.registered[0] ?? '';
    // 版本号挂在查询串上：版本一换，浏览器就会更及时去取新的 sw.js
    expect(url.startsWith(`${import.meta.env.BASE_URL}sw.js?v=`)).toBe(true);
    expect(url.split('?v=')[1]).toBe(encodeURIComponent(APP_VERSION));
  });

  it('注册失败只静默收口：界面照常可用，rejection 也不漏到全局', async () => {
    // 全局这一条是显式断言，不是碰运气：jsdom 不发 window 层的 unhandledrejection，
    // 所以这里直接挂 process 层的监听数它有几条。删掉 pwa.ts 里的 .catch(() => {})，
    // 这条会红（runner 自己也会报 unhandled error，但不能把门禁交给 runner 的默认行为）。
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      const { container: c } = install();
      c.registerPromise = Promise.reject(new Error('offline sandbox'));
      render(<Harness />);
      await vi.waitFor(() => expect(c.registered).toHaveLength(1));
      expect(screen.getByText('当前联网')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '立即更新' })).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 20)); // 让这一支的微任务跑完
    } finally {
      process.off('unhandledRejection', onRejection);
    }
    expect(rejections, '注册失败不该把 rejection 漏到全局').toHaveLength(0);
  });
});

describe('usePwa 新版本就绪', () => {
  it('首次访问：新装的 SW 接管一次也不刷新，免得把刚输入的姓清掉', async () => {
    const { container: c, reg } = install({ controller: null });
    render(<Harness />);
    await vi.waitFor(() => expect(reg.listenerCount('updatefound')).toBe(1));
    // 控制权变化挂在容器上，不挂在注册对象上：这里发的就是浏览器会发的那个事件
    c.dispatch('controllerchange');
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByText('有新版本可用')).toBeNull();
  });

  it('旧版已在控制、新版接管时才自动刷新', async () => {
    install({ controller: new FakeWorker() });
    render(<Harness />);
    await vi.waitFor(() => expect(container.listenerCount('controllerchange')).toBe(1));
    container.dispatch('controllerchange');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('注册返回时已有 waiting 且旧版在控制，直接给「有新版本可用」', async () => {
    const { reg } = install({ controller: new FakeWorker() });
    reg.waiting = new FakeWorker();
    render(<Harness />);
    await screen.findByText('有新版本可用');
  });

  it('注册返回时已有 waiting 但没有旧版在控制：不提示（首次访问没有可更新的对象）', async () => {
    const { reg } = install({ controller: null });
    reg.waiting = new FakeWorker();
    render(<Harness />);
    // 先确认注册真的落地了、这一支确实走到了，否则「没提示」会因为什么都没发生而空过
    await vi.waitFor(() => expect(reg.listenerCount('updatefound')).toBe(1));
    expect(screen.queryByText('有新版本可用')).toBeNull();
  });

  it('安装中的 worker 进入 installed 且旧版还在控制，才给提示', async () => {
    const { reg } = install({ controller: new FakeWorker() });
    const nw = new FakeWorker();
    reg.installing = nw;
    render(<Harness />);
    await vi.waitFor(() => expect(reg.listenerCount('updatefound')).toBe(1));
    reg.dispatch('updatefound');
    // 还没装完：不提示
    nw.state = 'installing';
    nw.dispatch('statechange');
    expect(screen.queryByText('有新版本可用')).toBeNull();
    // 装完了：提示出现
    nw.state = 'installed';
    nw.dispatch('statechange');
    await screen.findByText('有新版本可用');
  });

  it('没有旧版控制时，装完也不提示（首次访问没有可更新的对象）', async () => {
    const { reg } = install({ controller: null });
    const nw = new FakeWorker();
    reg.installing = nw;
    render(<Harness />);
    await vi.waitFor(() => expect(reg.listenerCount('updatefound')).toBe(1));
    reg.dispatch('updatefound');
    nw.state = 'installed';
    nw.dispatch('statechange');
    expect(screen.queryByText('有新版本可用')).toBeNull();
  });

  it('卸载发生在注册落地之前：不再挂 updatefound 监听，控制权监听摘掉', async () => {
    const { container: c } = install();
    let resolveRegister: (r: FakeRegistration) => void = () => {};
    const reg = new FakeRegistration();
    c.registerPromise = new Promise<FakeRegistration>((res) => {
      resolveRegister = res;
    });
    const { unmount } = render(<Harness />);
    unmount();
    expect(c.listenerCount('controllerchange')).toBe(0);
    resolveRegister(reg);
    await vi.waitFor(() => expect(c.registered).toHaveLength(1));
    expect(reg.listenerCount('updatefound')).toBe(0);
  });
});

describe('usePwa 立即更新', () => {
  it('有 waiting 时给它发 SKIP_WAITING，不靠刷新界面', async () => {
    const { reg } = install({ controller: new FakeWorker() });
    const waiting = new FakeWorker();
    reg.waiting = waiting;
    render(<Harness />);
    await screen.findByText('立即更新');
    fireEvent.click(screen.getByRole('button', { name: '立即更新' }));
    expect(waiting.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('没有 waiting（新版还没装好）时退回刷新，按按钮不会没反应', () => {
    install();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '立即更新' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
