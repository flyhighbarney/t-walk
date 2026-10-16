import type { ReactNode } from 'react';
import { navigate, type Tab } from '../lib/router.ts';
import { BookmarkIcon, MapIcon, NowIcon, RouteIcon, WalkIcon } from './icons.tsx';

export function AppHeader({ title, children, overlay = false }: { title: string; children?: ReactNode; overlay?: boolean }) {
  return (
    <header
      className={`${overlay ? 'bg-chrome backdrop-blur' : 'bg-bg'} sticky top-0 z-20 px-4 pb-2`}
      style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
    >
      {/* Lined up with the content column (max-w-xl less its px-4), which is centred on a tablet. */}
      <div className={`flex min-h-11 items-center justify-between gap-3 ${overlay ? '' : 'mx-auto max-w-[34rem]'}`}>
        <div className="flex items-center gap-2">
          {/* The app's mark, small: the tab bar already says where you are. */}
          <WalkIcon className="text-muted size-5" />
          <h1 className="font-serif text-2xl font-bold tracking-tight">
            {title}
            <span className="visually-hidden"> · T-Walk</span>
          </h1>
        </div>
        {children}
      </div>
    </header>
  );
}

const TABS: { tab: Tab; path: string; label: string; Icon: typeof NowIcon }[] = [
  { tab: 'now', path: '/', label: 'Now', Icon: NowIcon },
  { tab: 'map', path: '/map', label: 'Map', Icon: MapIcon },
  { tab: 'trips', path: '/trips', label: 'Trips', Icon: RouteIcon },
  { tab: 'saved', path: '/saved', label: 'Saved', Icon: BookmarkIcon },
];

export function TabBar({ current }: { current: Tab }) {
  return (
    <nav
      aria-label="Main"
      className="bg-chrome border-line fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-xl justify-around px-2 py-1.5">
        {TABS.map(({ tab, path, label, Icon }) => {
          const active = tab === current;
          return (
            <li key={tab}>
              <a
                href={path}
                aria-current={active ? 'page' : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  navigate(path);
                }}
                className={`flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 rounded-xl px-3 text-xs ${
                  active ? 'text-brand-text font-extrabold' : 'text-muted font-semibold'
                }`}
              >
                {/* The pill marks the current tab as well as the colour does. */}
                <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? 'bg-brand text-on-brand' : ''}`}>
                  <Icon />
                </span>
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
