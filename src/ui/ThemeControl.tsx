import type { ReactNode } from 'react';
import { THEME_LABEL, type Theme } from '../store/local';

/* 昼夜切换常驻在页头，四个页面都能切；三档直接点，不再循环。
   桌面显示文字，手机端只显示图标（44px 方块 + aria-label）。 */
const OPTS: { v: Theme; icon: ReactNode }[] = [
  {
    v: 'system',
    icon: <>
      <rect x="2.6" y="3.6" width="18.8" height="12.8" rx="1.6" />
      <path d="M8.5 20.4h7M12 16.4v4" />
    </>,
  },
  {
    v: 'light',
    icon: <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7" />
    </>,
  },
  {
    v: 'dark',
    icon: <path d="M20.2 14.6A8.6 8.6 0 1 1 9.4 3.8a7.1 7.1 0 0 0 10.8 10.8z" />,
  },
];

export default function ThemeControl({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <div className="seg shrink-0" role="group" aria-label="昼夜主题">
      {OPTS.map(({ v, icon }) => {
        const label = THEME_LABEL[v];
        return (
          <button key={v} onClick={() => setTheme(v)} aria-pressed={theme === v}
            aria-label={`${label}主题`} title={`${label}主题`}
            className={`seg-btn ${theme === v ? 'seg-on' : ''}`}>
            <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
            <span className="hidden lg:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
