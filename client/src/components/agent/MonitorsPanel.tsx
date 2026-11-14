import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Eye, Plus, Pause, Play, Trash2, ExternalLink, Clock } from 'lucide-react';

type Watch = {
  id: string;
  url: string;
  label: string | null;
  cronExpr: string;
  active: boolean;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  lastChangeNote: string | null;
};

const CADENCES = [
  { value: 'hourly', label: 'Every hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: 'daily', label: 'Once a day' },
];

// SCN-30 — "Watch a page for changes": paste a link → cadence → notify me. Invisible-UI:
// zero-decision defaults (hourly), one primary action, outcome-named controls.
export function MonitorsPanel({ id }: { id: string }) {
  const { toast } = useToast();
  const key = ['/api/agents/' + id + '/watches'];
  const { data } = useQuery<{ watches: Watch[] }>({ queryKey: key, refetchInterval: 15_000 });
  const watches = data?.watches || [];

  const [url, setUrl] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [cadence, setCadence] = React.useState('hourly');
  const [removing, setRemoving] = React.useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () => apiRequest('POST', `/api/agents/${id}/watches`, { url: url.trim(), label: label.trim() || undefined, cadence }),
    onSuccess: () => { setUrl(''); setLabel(''); refresh(); toast('Now watching that page.', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not add that watch', 'warn'),
  });
  const toggle = useMutation({
    mutationFn: (w: Watch) => apiRequest('PATCH', `/api/agents/${id}/watches/${w.id}`, { active: !w.active }),
    onSuccess: refresh,
    onError: (e: any) => toast(e.message || 'Could not update', 'warn'),
  });
  const remove = useMutation({
    mutationFn: (watchId: string) => apiRequest('DELETE', `/api/agents/${id}/watches/${watchId}`),
    onSuccess: () => { setRemoving(null); refresh(); },
    onError: (e: any) => { setRemoving(null); toast(e.message || 'Could not remove', 'warn'); },
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Eye size={16} /></span>
          <div>
            <div className="text-sm font-semibold">Watch a page for changes</div>
            <div className="text-xs text-muted-foreground">Paste a link — your agent pings you when the price or offer changes.</div>
          </div>
        </div>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://competitor.com/pricing" />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What is it? (optional)" className="sm:flex-1" />
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <Button className="w-full" disabled={url.trim().length < 8 || add.isPending} onClick={() => add.mutate()}>
          <Plus size={16} /> {add.isPending ? 'Adding…' : 'Watch this page'}
        </Button>
      </Card>

      {watches.length > 0 && (
        <div className="space-y-2">
          {watches.map((w) => (
            <Card key={w.id} className={cn('p-3.5', !w.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{w.label || hostOf(w.url)}</div>
                  <a href={w.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-primary">
                    {hostOf(w.url)} <ExternalLink size={11} />
                  </a>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => toggle.mutate(w)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" title={w.active ? 'Pause' : 'Resume'}>
                    {w.active ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button onClick={() => setRemoving(w.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" title="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Clock size={11} /> {w.lastCheckedAt ? `Checked ${timeAgo(w.lastCheckedAt)}` : 'Not checked yet'}</span>
                {w.lastChangedAt && <span className="text-good">Changed {timeAgo(w.lastChangedAt)}</span>}
              </div>
              {w.lastChangeNote && (
                <div className="mt-2 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">{w.lastChangeNote}</div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Stop watching this page?"
        message="You’ll no longer be notified when it changes."
        confirmLabel="Remove"
        tone="destructive"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
function timeAgo(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
