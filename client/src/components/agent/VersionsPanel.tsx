import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest, queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { History, RotateCcw, Save, Copy, Check } from 'lucide-react';

type Version = { id: string; version: number; note: string | null; status: string; createdAt: string };

// STU-36..40 — version history: snapshot the live agent, restore any earlier
// snapshot, or duplicate the agent. Invisible-UI: one "Save a version" button,
// an optional note, and a one-tap confirmed restore. Backend endpoints:
// GET/POST /versions, POST /rollback, POST /clone (policy-gated + audited).
export function VersionsPanel({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const key = ['/api/agents/' + id + '/versions'];
  const { data } = useQuery<{ versions: Version[]; currentVersionId: string | null }>({ queryKey: key });
  const versions = data?.versions || [];

  const [note, setNote] = React.useState('');
  const [restoring, setRestoring] = React.useState<number | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const publish = useMutation({
    mutationFn: () => apiRequest('POST', `/api/agents/${id}/versions`, { note: note.trim() || undefined }),
    onSuccess: (r: any) => { setNote(''); refresh(); toast(`Saved version ${r.version}.`, 'good'); },
    onError: (e: any) => toast(e.message || 'Could not save a version', 'warn'),
  });

  const rollback = useMutation({
    mutationFn: (version: number) => apiRequest('POST', `/api/agents/${id}/rollback`, { version }),
    onSuccess: (r: any) => {
      setRestoring(null);
      refresh();
      // The live spec changed — refresh the agent + its training surfaces.
      queryClient.invalidateQueries({ queryKey: ['/api/agents/' + id] });
      queryClient.invalidateQueries({ queryKey: ['/api/agents/' + id + '/training'] });
      toast(`Restored version ${r.version}.`, 'good');
    },
    onError: (e: any) => { setRestoring(null); toast(e.message || 'Could not restore', 'warn'); },
  });

  const clone = useMutation({
    mutationFn: () => apiRequest('POST', `/api/agents/${id}/clone`, {}),
    onSuccess: (a: any) => { queryClient.invalidateQueries({ queryKey: ['/api/agents'] }); navigate('/agents/' + a.id); },
    onError: (e: any) => toast(e.message || 'Could not duplicate this agent', 'warn'),
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Save size={16} /></span>
          <div>
            <div className="text-sm font-semibold">Save a version</div>
            <div className="text-xs text-muted-foreground">Snapshot how your agent works right now, so you can always come back to it.</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What changed? (optional)"
            maxLength={200}
            onKeyDown={(e) => e.key === 'Enter' && !publish.isPending && publish.mutate()}
          />
          <Button disabled={publish.isPending} onClick={() => publish.mutate()} className="whitespace-nowrap">
            <Save size={15} /> {publish.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <History size={16} className="text-muted-foreground" /> Version history
        </div>

        {versions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No saved versions yet. Save one above to keep a restore point.</p>
        ) : (
          <ul className="space-y-1.5">
            {versions.map((v) => {
              const current = v.id === data?.currentVersionId;
              return (
                <li key={v.id} className={cn('flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5', current ? 'border-primary/40 bg-primary/5' : 'border-border')}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-semibold', current ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
                      v{v.version}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm">{v.note || <span className="text-muted-foreground">No note</span>}</div>
                      <div className="text-[11px] text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                  {current ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary"><Check size={13} /> Current</span>
                  ) : (
                    <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setRestoring(v.version)}>
                      <RotateCcw size={13} /> Restore
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <button
        onClick={() => clone.mutate()}
        disabled={clone.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
      >
        <Copy size={15} /> {clone.isPending ? 'Duplicating…' : 'Duplicate this agent'}
      </button>

      <ConfirmDialog
        open={restoring !== null}
        title={`Restore version ${restoring ?? ''}?`}
        message="Your agent will go back to exactly how it worked in this version. You can re-save your current setup first if you want to keep it."
        confirmLabel="Restore"
        busy={rollback.isPending}
        onConfirm={() => restoring !== null && rollback.mutate(restoring)}
        onCancel={() => setRestoring(null)}
      />
    </div>
  );
}
