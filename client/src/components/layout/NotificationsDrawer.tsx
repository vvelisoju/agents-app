import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { cn, displayContact } from '@/lib/utils';
import { X, Bell, UserPlus } from 'lucide-react';

// Right-to-left slide-in notifications drawer. Derives real items from new leads.
export function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { data: leads = [] } = useQuery<any[]>({ queryKey: ['/api/leads'], enabled: open });
  const items = leads.filter((l) => l.leadStatus === 'new').slice(0, 25);

  return (
    <div className={cn('fixed inset-0 z-[60]', open ? '' : 'pointer-events-none')}>
      <div className={cn('absolute inset-0 bg-black/50 transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
      <aside
        className={cn('absolute right-0 top-0 flex h-full w-80 max-w-[86vw] flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300', open ? 'translate-x-0' : 'translate-x-full')}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-semibold">Notifications</span>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="grid h-full place-items-center p-8 text-center">
              <div className="text-sm text-muted-foreground"><Bell className="mx-auto mb-2 opacity-30" size={28} /> You're all caught up.</div>
            </div>
          ) : (
            items.map((l) => (
              <button key={l.id} onClick={() => { onClose(); navigate('/leads'); }} className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left hover:bg-muted">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><UserPlus size={15} /></span>
                <span className="min-w-0 text-sm">
                  <span className="font-medium">New lead</span> · {l.contactName || displayContact(l.contactNumber)}
                  <span className="block truncate text-xs text-muted-foreground">{l.agentName}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
