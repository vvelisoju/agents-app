import { useLocation } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import { CreditCard, Settings as SettingsIcon, LogOut } from 'lucide-react';

// Avatar dropdown: account, dedicated Subscription, Settings, Sign out.
export function ProfileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { account, logout } = useAuth();
  const [, navigate] = useLocation();
  if (!open) return null;

  const go = (path: string) => { onClose(); navigate(path); };
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground';

  return (
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose} />
      <div className="fixed right-3 top-[3.75rem] z-[60] w-56 rounded-xl border border-border bg-card p-1 shadow-2xl">
        <div className="px-3 py-2">
          <div className="text-xs text-muted-foreground">Signed in as</div>
          <div className="text-sm font-medium">{account}</div>
        </div>
        <div className="my-1 h-px bg-border" />
        <button className={item} onClick={() => go('/subscription')}><CreditCard size={16} /> Subscription</button>
        <button className={item} onClick={() => go('/settings')}><SettingsIcon size={16} /> Settings</button>
        <div className="my-1 h-px bg-border" />
        <button className={item} onClick={() => { onClose(); logout(); }}><LogOut size={16} /> Sign out</button>
      </div>
    </>
  );
}
