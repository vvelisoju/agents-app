import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { TrendingUp, MessageSquare, Users, Clock, IndianRupee } from 'lucide-react';

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

const OUTCOME_LABEL: Record<string, string> = {
  sent: 'Auto-sent', draft: 'Drafted for you', needs_human: 'Sent to you', away: 'After-hours reply',
  error: 'Errors', ignored: 'Ignored', budget_exceeded: 'Over budget', opted_out: 'Opted out',
};

export function Insights() {
  const [days, setDays] = React.useState(7);
  const { data: s } = useQuery<Summary>({ queryKey: ['/api/analytics'] });
  const { data: m } = useQuery<Metrics>({ queryKey: ['/api/analytics/metrics?days=' + days] });

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
