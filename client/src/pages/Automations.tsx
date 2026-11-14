import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Zap, ChevronRight, Pause, Play, X, Check, Clock } from 'lucide-react';

type Run = {
  id: string;
  agentId: string | null;
  workflowName: string;
  status: string;
  currentStep: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};
type Step = { id: string; stepName: string; result: string; detailJson: string; createdAt: string };

// EWS-24 — outcome-named statuses (never raw enums), per UX_PRINCIPLES.
const STATUS: Record<string, { label: string; dot: string; chip: string }> = {
  running: { label: 'Running', dot: 'bg-good', chip: 'text-good bg-good/10' },
  sleeping: { label: 'Scheduled', dot: 'bg-primary', chip: 'text-primary bg-primary/10' },
  awaiting_approval: { label: 'Waiting for your OK', dot: 'bg-amber-500', chip: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  paused: { label: 'Paused', dot: 'bg-muted-foreground/60', chip: 'text-muted-foreground bg-muted' },
  completed: { label: 'Done', dot: 'bg-good', chip: 'text-good bg-good/10' },
  failed: { label: 'Failed', dot: 'bg-destructive', chip: 'text-destructive bg-destructive/10' },
  canceled: { label: 'Canceled', dot: 'bg-muted-foreground/60', chip: 'text-muted-foreground bg-muted' },
};
const meta = (s: string) => STATUS[s] || { label: s, dot: 'bg-muted-foreground/60', chip: 'text-muted-foreground bg-muted' };

export function Automations() {
  const { data, isLoading } = useQuery<{ runs: Run[] }>({ queryKey: ['/api/workflows'], refetchInterval: 8_000 });
  const runs = data?.runs || [];
  const [openId, setOpenId] = React.useState<string | null>(null);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Automations</h1>
        <p className="text-sm text-muted-foreground">Your scheduled and proactive work — what each agent is doing on its own.</p>
      </div>

      {runs.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Zap size={22} /></span>
          <p className="max-w-sm text-sm text-muted-foreground">
            No automations yet. When an agent follows up with a lead, watches a page for changes, or books an appointment, it’ll show up here.
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {runs.map((r) => (
            <RunRow key={r.id} run={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunRow({ run, open, onToggle }: { run: Run; open: boolean; onToggle: () => void }) {
  const m = meta(run.status);
  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/40">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', m.dot)} />
          <div className="min-w-0">
            <div className="truncate font-medium">{prettyName(run.workflowName)}</div>
            <div className="truncate text-xs text-muted-foreground">Updated {timeAgo(run.updatedAt)}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', m.chip)}>{m.label}</span>
          <ChevronRight size={16} className={cn('text-muted-foreground transition-transform', open && 'rotate-90')} />
        </div>
      </button>
      {open && <RunDetail runId={run.id} />}
    </Card>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const { toast } = useToast();
  const key = ['/api/workflows/' + runId];
  const { data } = useQuery<{ run: Run; steps: Step[] }>({ queryKey: key, refetchInterval: 5_000 });

  const control = useMutation({
    mutationFn: (action: string) => apiRequest('POST', `/api/workflows/${runId}/${action}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
    },
    onError: (e: any) => toast(e.message || 'Could not update the automation', 'warn'),
  });

  if (!data) return <div className="border-t border-border p-4 text-sm text-muted-foreground">Loading…</div>;
  const { run, steps } = data;
  const s = run.status;
  const active = s === 'running' || s === 'sleeping';

  return (
    <div className="space-y-4 border-t border-border p-4">
      {/* Controls — only the ones that apply to this status; awaiting-approval leads with Approve. */}
      <div className="flex flex-wrap gap-2">
        {s === 'awaiting_approval' && (
          <Button size="sm" disabled={control.isPending} onClick={() => control.mutate('approve')}><Check size={14} /> Approve</Button>
        )}
        {active && (
          <Button size="sm" variant="ghost" disabled={control.isPending} onClick={() => control.mutate('pause')}><Pause size={14} /> Pause</Button>
        )}
        {s === 'paused' && (
          <Button size="sm" disabled={control.isPending} onClick={() => control.mutate('resume')}><Play size={14} /> Resume</Button>
        )}
        {(active || s === 'paused' || s === 'awaiting_approval') && (
          <Button size="sm" variant="ghost" disabled={control.isPending} onClick={() => control.mutate('cancel')}><X size={14} /> Cancel</Button>
        )}
        {(s === 'completed' || s === 'failed' || s === 'canceled') && (
          <span className="text-xs text-muted-foreground">This automation has finished.</span>
        )}
      </div>

      {/* Plain-language step timeline from WorkflowStepLog. */}
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Clock size={12} /> Timeline</div>
        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">No steps recorded yet.</p>
        ) : (
          <ol className="space-y-2">
            {steps.map((st) => (
              <li key={st.id} className="flex items-start gap-2.5">
                <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', meta(mapStepToStatus(st.result)).dot)} />
                <div className="min-w-0">
                  <div className="text-sm">{st.stepName}</div>
                  <div className="text-[11px] text-muted-foreground">{new Date(st.createdAt).toLocaleString()}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function prettyName(name: string): string {
  // "outbound.drip" / "scheduled-monitor" → "Outbound drip" / "Scheduled monitor"
  const words = name.replace(/[._-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
function mapStepToStatus(result: string): string {
  if (result === 'fail') return 'failed';
  if (result === 'awaitApproval') return 'awaiting_approval';
  if (result === 'sleep') return 'sleeping';
  if (result === 'complete') return 'completed';
  return 'running';
}
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
