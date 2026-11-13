import * as React from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import { Wordmark } from '@/components/Brand';
import { cn } from '@/lib/utils';
import { Bot, Inbox, Users, Settings, Menu, X, Bell, LogOut, User } from 'lucide-react';

const NAV = [
  { path: '/agents', label: 'Agents', icon: Bot },
  { path: '/inbox', label: 'Inbox', icon: Inbox },
  { path: '/leads', label: 'Leads', icon: Users },
  { path: '/settings', label: 'Settings', icon: Settings },
];

// Standard app layout (ClassPe/clinIQ): fixed top header + left sidebar
// (drawer on mobile) + bottom footer; content fills the main area, left-aligned.
export function AppShell({ children }: { children: React.ReactNode }) {
  const { authed, account, logout } = useAuth();
  const [loc] = useLocation();
  const [drawer, setDrawer] = React.useState(false);
  React.useEffect(() => { setDrawer(false); }, [loc]);
  if (!authed) return <>{children}</>;

  const isActive = (p: string) => (p === '/agents' ? loc.startsWith('/agents') : loc === p || loc.startsWith(p + '/'));

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="space-y-1">
      {NAV.map((n) => (
        <Link key={n.path} href={n.path}>
          <a onClick={onNavigate} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isActive(n.path) ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
            <n.icon size={18} className={isActive(n.path) ? 'text-primary' : ''} /> {n.label}
          </a>
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border glass px-3 md:px-4" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <button className="rounded-md p-2 text-muted-foreground hover:bg-muted md:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={20} /></button>
        <Wordmark size={28} />
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label="Notifications"><Bell size={18} /></button>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground"><User size={16} /></span>
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border p-3 md:block">
          <NavLinks />
        </aside>

        {/* Mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
            <aside className="absolute left-0 top-0 flex h-full w-72 flex-col glass border-r border-border p-3" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
              <div className="mb-4 flex items-center justify-between">
                <Wordmark size={28} />
                <button onClick={() => setDrawer(false)} className="p-1 text-muted-foreground" aria-label="Close menu"><X size={20} /></button>
              </div>
              <NavLinks onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>

      {/* Footer */}
      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-border px-4 text-xs text-muted-foreground" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <span className="truncate">{account} · Session active</span>
        <button onClick={logout} className="flex shrink-0 items-center gap-1 hover:text-foreground"><LogOut size={13} /> Sign out</button>
      </footer>
    </div>
  );
}
