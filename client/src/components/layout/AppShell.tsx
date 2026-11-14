import * as React from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { Wordmark, Brand } from '@/components/Brand';
import { NotificationsDrawer } from './NotificationsDrawer';
import { ProfileMenu } from './ProfileMenu';
import { cn } from '@/lib/utils';
import { Bot, Inbox, Users, Settings, Menu, Bell, User, Zap, ShieldCheck, BarChart3, Database, ScrollText } from 'lucide-react';

// POL-20: `ownerOnly` items are hidden for members. `badge` names a nav item that shows a live
// count (currently the pending-approvals count on Approvals).
const NAV: { path: string; label: string; icon: any; ownerOnly?: boolean; badge?: 'approvals' }[] = [
  { path: '/agents', label: 'Agents', icon: Bot },
  { path: '/inbox', label: 'Inbox', icon: Inbox },
  { path: '/automations', label: 'Automations', icon: Zap },
  { path: '/approvals', label: 'Approvals', icon: ShieldCheck, badge: 'approvals' },
  { path: '/insights', label: 'Insights', icon: BarChart3 },
  { path: '/leads', label: 'Leads', icon: Users },
  { path: '/connectors', label: 'Connectors', icon: Database },
  { path: '/audit', label: 'Audit', icon: ScrollText, ownerOnly: true },
  { path: '/settings', label: 'Settings', icon: Settings },
];
const COLLAPSE_KEY = 'sa_sidebar_collapsed';

function Footer() {
  const { account } = useAuth();
  const { data } = useQuery<any>({ queryKey: ['/api/analytics'] });
  return (
    <footer className="hidden h-10 shrink-0 items-center justify-between gap-4 border-t border-border px-4 text-xs text-muted-foreground md:flex">
      <span className="flex items-center gap-1.5"><Brand size={16} /> Secure Agents</span>
      <span className="font-medium text-foreground/80">
        {data
          ? <>⚡ {data.agents ?? 0} agents · {data.repliesTotal ?? 0} replies · {data.leadsByStatus?.won ?? 0} leads won</>
          : 'AI agents replying for your business, 24/7'}
      </span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-good" /> {account} · active</span>
    </footer>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { authed } = useAuth();
  const [loc] = useLocation();
  const [collapsed, setCollapsed] = React.useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const [notif, setNotif] = React.useState(false);
  const [profile, setProfile] = React.useState(false);
  // POL-20: role drives nav gating; the pending-approvals count drives the live badge. Both are
  // cheap cached reads (the approvals key is shared with the Approvals page, refreshed every 15s).
  const { data: me } = useQuery<{ role?: string }>({ queryKey: ['/api/me'], enabled: authed });
  const { data: appr } = useQuery<{ approvals: unknown[] }>({ queryKey: ['/api/approvals'], enabled: authed, refetchInterval: 15_000 });
  if (!authed) return <>{children}</>;

  const isOwner = me?.role === 'owner';
  const nav = NAV.filter((n) => !n.ownerOnly || isOwner);
  const pendingApprovals = appr?.approvals?.length || 0;
  const badgeFor = (n: { badge?: string }) => (n.badge === 'approvals' ? pendingApprovals : 0);
  const toggleSidebar = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem(COLLAPSE_KEY, n ? '1' : '0'); } catch {} return n; });
  const isActive = (p: string) => (p === '/agents' ? loc.startsWith('/agents') : loc === p || loc.startsWith(p + '/'));

  return (
    <div className="flex h-[100dvh] justify-center overflow-hidden">
      {/* App frame fills the viewport edge-to-edge (no side borders/gaps); on very
          large monitors it caps to a comfortable fixed width and centres. */}
      <div className="flex h-full w-full max-w-[1920px] flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border glass px-3 md:px-4" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <button className="hidden rounded-md p-2 text-muted-foreground hover:bg-muted md:block" onClick={toggleSidebar} aria-label="Toggle sidebar"><Menu size={20} /></button>
        <Wordmark size={28} />
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded-md p-2 text-muted-foreground hover:bg-muted" onClick={() => { setProfile(false); setNotif(true); }} aria-label="Notifications"><Bell size={18} /></button>
          <button className="grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-primary/20" onClick={() => { setNotif(false); setProfile((p) => !p); }} aria-label="Account"><User size={16} /></button>
        </div>
      </header>

      {/* Body: desktop sidebar + content */}
      <div className="flex min-h-0 flex-1">
        <aside className={cn('hidden shrink-0 flex-col overflow-y-auto border-r border-border py-3 transition-[width] duration-200 md:flex', collapsed ? 'w-16 px-2' : 'w-60 px-3')}>
          <nav className="space-y-1">
            {nav.map((n) => {
              const count = badgeFor(n);
              return (
              <Link key={n.path} href={n.path}>
                <a title={n.label} className={cn('relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center px-0' : 'px-3',
                  isActive(n.path) ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                  <span className="relative">
                    <n.icon size={18} className={isActive(n.path) ? 'text-primary' : ''} />
                    {count > 0 && collapsed && <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  {!collapsed && <span className="flex-1">{n.label}</span>}
                  {!collapsed && count > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{count}</span>}
                </a>
              </Link>
            );})}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="w-full p-4 pb-24 md:p-6 md:pb-6">{children}</div>
        </main>
      </div>

      <Footer />
      </div>

      {/* Mobile native bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border glass md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {nav.filter((n) => !n.ownerOnly || isOwner).slice(0, 5).map((n) => {
          const count = badgeFor(n);
          return (
          <Link key={n.path} href={n.path}>
            <a className={cn('relative flex min-h-tap flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium', isActive(n.path) ? 'text-primary' : 'text-muted-foreground')}>
              <span className="relative">
                <n.icon size={20} />
                {count > 0 && <span className="absolute -right-2 -top-1 rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">{count}</span>}
              </span>
              {n.label}
            </a>
          </Link>
        );})}
      </nav>

      <NotificationsDrawer open={notif} onClose={() => setNotif(false)} />
      <ProfileMenu open={profile} onClose={() => setProfile(false)} />
    </div>
  );
}
