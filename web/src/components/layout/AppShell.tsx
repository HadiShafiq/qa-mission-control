import { useQuery } from '@tanstack/react-query';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, type Settings } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { BUILT_PHASE, NAV } from '@/nav';

export function AppShell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 z-30 bg-[#0b1216]/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-line bg-surface transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <NavLink to="/" className="flex items-center gap-2.5 font-semibold text-ink">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="leading-tight">
              QA Mission Control
            </span>
          </NavLink>
          <button className="rounded p-1 text-ink-3 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation">
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-2 pb-1 text-[12px] font-medium text-ink-3">{group.label}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      className={({ isActive }) =>
                        cn(
                          'group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] text-ink-2 hover:bg-surface-2 hover:text-ink',
                          isActive && 'bg-signal-soft font-medium text-signal hover:bg-signal-soft hover:text-signal',
                        )
                      }
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.phase > BUILT_PHASE && (
                        <span className="text-[11px] text-ink-3" title={`Built in phase ${item.phase}`}>
                          P{item.phase}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <SidebarFooter />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
          <button className="rounded p-1.5 text-ink-2 hover:bg-surface-2" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <span className="font-semibold">QA Mission Control</span>
        </header>
        <main id="main" className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarFooter() {
  const { theme, toggle } = useTheme();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings'), staleTime: 60_000 });
  const aiOk = settings.data?.ai.configured;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-[12.5px]">
      <NavLink to="/settings" className="flex items-center gap-2 text-ink-2 hover:text-ink">
        <span
          className={cn('size-2 rounded-full', settings.isError ? 'bg-fail' : aiOk ? 'bg-pass' : 'bg-line-strong')}
          aria-hidden
        />
        {settings.isError ? 'Server offline' : aiOk ? 'AI key configured' : 'AI not connected'}
      </NavLink>
      <button
        onClick={toggle}
        className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        data-testid="theme-toggle"
      >
        {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    </div>
  );
}
