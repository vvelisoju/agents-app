import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/StatusPill';
import { AgentsStats } from '@/components/AgentsStats';
import { Brand } from '@/components/Brand';
import { CreateAgent } from '@/components/agent/CreateAgent';
import { channelMeta } from '@/config/channels';
import { Plus, ChevronRight } from 'lucide-react';

export function Agents() {
  const [, navigate] = useLocation();
  const { data: agents = [] } = useQuery<any[]>({ queryKey: ['/api/agents'] });
  const [creating, setCreating] = React.useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Your agents</h1>
        <p className="text-sm text-muted-foreground">Describe what you need in a sentence — your agent is set up and trained for you.</p>
      </div>

      <AgentsStats />

      {agents.length === 0 && !creating && (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Brand size={44} glow />
          <p className="max-w-sm text-sm text-muted-foreground">No agents yet. Describe your first one — it takes about a minute.</p>
          <Button onClick={() => setCreating(true)} className="whitespace-nowrap"><Plus size={16} /> Create your first agent</Button>
        </Card>
      )}

      {agents.length > 0 && (
        <div className="space-y-2.5">
          {agents.map((a) => {
            const m = channelMeta(a.channelType);
            const Icon = m.icon;
            return (
              <Card
                key={a.id}
                className="group flex cursor-pointer items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/40"
                onClick={() => navigate('/agents/' + a.id)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', m.badge)}>
                    <Icon size={20} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {m.label} · {a.autoSend ? 'Auto-reply on' : 'Approve before sending'}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill status={a.status} />
                  <ChevronRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creating ? (
        <CreateAgent onClose={() => setCreating(false)} />
      ) : (
        agents.length > 0 && (
          <Button variant="ghost" className="w-full whitespace-nowrap" onClick={() => setCreating(true)}>
            <Plus size={16} /> Add another agent
          </Button>
        )
      )}
    </div>
  );
}
