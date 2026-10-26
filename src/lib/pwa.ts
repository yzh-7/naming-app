// PWA 运行时状态：离线提示 + 新版本就绪提示。SW 只在 http(s) 下注册，file:// 或单文件版静默跳过。
import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '../engine/data';

export function usePwa() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine);
  const [updateReady, setUpdateReady] = useState(false);
  const regRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    let cancelled = false;
    const sw = navigator.serviceWorker;
    // 版本随注册参数一起给出去，版本变化时浏览器更及时去取新的 sw.js；
    // 版本号与界面页脚、sw.js 的回退链同源（engine/data.ts 的 APP_VERSION）
    sw.register(`${import.meta.env.BASE_URL}sw.js?v=${encodeURIComponent(APP_VERSION)}`).then((reg) => {
      if (cancelled) return;
      regRef.current = reg;
      if (reg.waiting && sw.controller) setUpdateReady(true);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && sw.controller) setUpdateReady(true);
        });
      });
    }).catch(() => {});
    // 只有「旧版 SW 已在控制、新版接管」时才自动刷新。首次访问时新装 SW 也会接管一次，
    // 那时刷新会把用户刚输入的姓和候选清掉，所以不刷。
    const hadController = sw.controller !== null;
    const onController = () => { if (hadController) location.reload(); };
    sw.addEventListener('controllerchange', onController);
    return () => { cancelled = true; sw.removeEventListener('controllerchange', onController); };
  }, []);

  const applyUpdate = useCallback(() => {
    const waiting = regRef.current?.waiting;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  }, []);

  return { offline, updateReady, applyUpdate };
}
