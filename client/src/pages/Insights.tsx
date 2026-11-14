import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { TrendingUp, MessageSquare, Users, Clock, IndianRupee, ChevronRight, Gauge } from 'lucide-react';

type Metrics = {
  total: number;
  byOutcome: Record<string, number>;
  costMicros: number;
  latencyP50: number;
  latencyP95: number;
  successRate: number;
  interventionRate: number;
};
type Summary = { agents: number; conversations: number; repliesTotal: number; repliesToday: number; leadsByStatus: Record<string, number> };
type Usage = { used: number; cap: number; remaining: number; pct: number; allowed: boolean; nearCap: boolean };
type Execution = { id: string; executionId: string | null; agentId: string; outcome: string; model: string | null; costMicros: number | null; latencyMs: number | null; approvalState: string | null; at: string };
type Step = { stepIndex: number; tool: string; outcome: string; approvalState: string | null; latencyMs: number | null; at: string; input: Record<string, unknown> };

const OUTCOME_LABEL: Record<string, string> = {
  sent: 'Auto-sent', draft: 'Drafted for you', needs_human: 'Sent to you', away: 'After-hours reply',
  error: 'Errors', ignored: 'Ignored', budget_exceeded: 'Over budget', opted_out: 'Opted out',
};

export function Insights() {
  const [days, setDays] = React.useState(7);
  const { data: s } = useQuery<Summary>({ queryKey: ['/api/analytics'] });
  const { data: m } = useQuery<Metrics>({ queryKey: ['/api/analytics/metrics?days=' + days] });
  const { data: usage } = useQuery<Usage>({ queryKey: ['/api/analytics/usage'] });
  // OBS-19: recent execution traces (owner-only endpoint; members get 403 and the card hides).
  const { data: exec } = useQuery<{ executions: Execution[] }>({ queryKey: ['/api/analytics/executions?limit=20'], retry: false });

  const outcomes = Object.entries(m?.byOutcome || {}).sort((a, b) => b[1] - a[1]);
  const maxOutcome = outcomes.reduce((mx, [, n]) => Math.max(mx, n), 1);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground">How your agents are performing.</p>
        </div>
        <div className="flex rounded-lg border border-border p-0.5 text-xs">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={cn('rounded-md px-2.5 py-1 font-medium transition-colors', days === d ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}>{d}d</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon={Users} label="Agents" value={s?.agents ?? '—'} />
        <Tile icon={MessageSquare} label="Conversations" value={s?.conversations ?? '—'} />
        <Tile icon={TrendingUp} label="Replies today" value={s?.repliesToday ?? '—'} />
        <Tile icon={MessageSquare} label="Replies total" value={s?.repliesTotal ?? '—'} />
      </div>

      {usage && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-semibold"><Gauge size={14} /> Today's usage</span>
            <span className={cn('text-xs', usage.nearCap ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
              {usage.used} / {usage.cap} replies · {usage.remaining} left
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full transition-all', usage.allowed ? (usage.nearCap ? 'bg-amber-500' : 'bg-primary') : 'bg-destructive')} style={{ width: `${usage.pct}%` }} />
          </div>
          {usage.nearCap && usage.allowed && <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">You're close to today's limit — replies pause when it's reached and resume tomorrow.</p>}
          {!usage.allowed && <p className="mt-1.5 text-[11px] text-destructive">Daily limit reached — new replies resume tomorrow. Upgrade your plan to raise it.</p>}
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile icon={TrendingUp} label="Handled without you" value={m ? `${Math.round(m.successRate * 100)}%` : '—'} hint="Replies sent or drafted automatically" />
        <Tile icon={Clock} label="Typical speed" value={m ? `${Math.round(m.latencyP50)}ms` : '—'} hint={m ? `95th percentile ${Math.round(m.latencyP95)}ms` : undefined} />
        <Tile icon={IndianRupee} label={`AI cost (${days}d)`} value={m ? `₹${(m.costMicros / 1_000_000 * 83).toFixed(2)}` : '—'} hint="Approximate, at current rates" />
      </div>

      <Card className="p-4">
        <div className="mb-3 text-sm font-semibold">What your agents did ({days} days)</div>
        {outcomes.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No activity yet in this window.</p>
        ) : (
          <div className="space-y-2.5">
            {outcomes.map(([outcome, n]) => (
              <div key={outcome}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>{OUTCOME_LABEL[outcome] || outcome}</span>
                  <span className="text-muted-foreground">{n}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((n / maxOutcome) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* OBS-19/20: recent executions with an expandable step trace. Hidden for non-owners. */}
      {exec?.executions && exec.executions.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold">Recent activity</div>
          <div className="divide-y divide-border">
            {exec.executions.map((e) => <ExecutionRow key={e.id} e={e} />)}
          </div>
        </Card>
      )}
    </div>
  );
}

const OUTCOME_TONE: Record<string, string> = {
  sent: 'text-emerald-600 dark:text-emerald-400', draft: 'text-primary', needs_human: 'text-amber-600 dark:text-amber-400',
  error: 'text-destructive', budget_exceeded: 'text-destructive', ok: 'text-emerald-600 dark:text-emerald-400',
  pending_approval: 'text-amber-600 dark:text-amber-400', denied: 'text-destructive',
};
const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

function ExecutionRow({ e }: { e: Execution }) {
  const [open, setOpen] = React.useState(false);
  // OBS-20: fetch the full step trace only when expanded (per-agent, org-scoped endpoint).
  const { data: detail } = useQuery<{ steps: Step[] }>({
    queryKey: ['/api/agents/' + e.agentId + '/executions/' + e.executionId],
    enabled: open && !!e.executionId,
    retry: false,
  });
  return (
    <div className="py-2">
      <button
        onClick={() => e.executionId && setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        disabled={!e.executionId}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight size={14} className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className={cn('text-xs font-medium', OUTCOME_TONE[e.outcome] || 'text-foreground')}>{OUTCOME_LABEL[e.outcome] || e.outcome}</span>
          {e.model && <span className="truncate text-[11px] text-muted-foreground">{e.model}</span>}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {e.latencyMs != null && <span>{e.latencyMs}ms · </span>}
          {e.costMicros != null && <span>₹{(e.costMicros / 1_000_000 * 83).toFixed(3)} · </span>}
          {fmtTime(e.at)}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
          {!detail && <p className="text-[11px] text-muted-foreground">Loading trace…</p>}
          {detail && detail.steps.length === 0 && <p className="text-[11px] text-muted-foreground">No tool steps — a single reply.</p>}
          {detail?.steps.map((st) => (
            <div key={st.stepIndex} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className="rounded bg-muted px-1 font-mono">{st.stepIndex}</span>
                <span className="font-medium">{st.tool}</span>
                <span className={cn(OUTCOME_TONE[st.outcome] || 'text-muted-foreground')}>{st.outcome}</span>
                {st.approvalState && st.approvalState !== 'inline' && <span className="text-muted-foreground">({st.approvalState})</span>}
              </span>
              {st.latencyMs != null && <span className="text-muted-foreground">{st.latencyMs}ms</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ icon: Icon, label, value, hint }: { icon: any; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon size={13} /> {label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}
