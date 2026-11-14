import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Activity, CheckCircle2, Clock3, ShieldAlert, XCircle } from 'lucide-react';

type Step = { stepIndex: number; tool: string; outcome: string; approvalState: string | null; latencyMs: number | null };
type Exec = { executionId: string; at: string; steps: Step[] };

// TOOL-18 — recent agentic tool runs + their step trace. Read-only; empty until an agent with
// tools enabled actually runs. Outcome-named, no raw enums.
const OUTCOME: Record<string, { label: string; icon: any; cls: string }> = {
  ok: { label: 'Ran', icon: CheckCircle2, cls: 'text-good' },
  pending_approval: { label: 'Needed approval', icon: ShieldAlert, cls: 'text-amber-600 dark:text-amber-400' },
  denied: { label: 'Blocked', icon: XCircle, cls: 'text-destructive' },
  timeout: { label: 'Timed out', icon: Clock3, cls: 'text-destructive' },
  error: { label: 'Failed', icon: XCircle, cls: 'text-destructive' },
};
const meta = (o: string) => OUTCOME[o] || { label: o, icon: Activity, cls: 'text-muted-foreground' };

export function ActivityPanel({ id }: { id: string }) {
  const { data } = useQuery<{ executions: Exec[] }>({ queryKey: ['/api/agents/' + id + '/executions'], refetchInterval: 10_000 });
  const execs = data?.executions || [];
  if (!execs.length) return null; // nothing to show until the agent uses a tool

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Activity size={16} className="text-muted-foreground" /> Recent activity
      </div>
      <div className="space-y-2">
        {execs.map((e) => (
          <div key={e.executionId} className="rounded-lg border border-border p-2.5">
            <div className="mb-1.5 text-[11px] text-muted-foreground">{new Date(e.at).toLocaleString()}</div>
            <ul className="space-y-1">
              {e.steps.map((s) => {
                const m = meta(s.outcome);
                const Icon = m.icon;
                return (
                  <li key={s.stepIndex} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1.5 truncate">
                      <Icon size={13} className={cn('shrink-0', m.cls)} />
                      <span className="truncate font-medium">{s.tool}</span>
                      <span className="text-muted-foreground">· {m.label}</span>
                    </span>
                    {s.latencyMs != null && <span className="shrink-0 text-[11px] text-muted-foreground">{s.latencyMs}ms</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
