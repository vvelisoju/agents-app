import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest, queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/StatusPill';
import { AgentsStats } from '@/components/AgentsStats';
import { Brand } from '@/components/Brand';
import { CHANNELS, channelMeta, type ChannelMeta } from '@/config/channels';
import { Plus, ChevronRight, X } from 'lucide-react';

export function Agents() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: agents = [] } = useQuery<any[]>({ queryKey: ['/api/agents'] });
  const [picking, setPicking] = React.useState(false);
  const [selected, setSelected] = React.useState<ChannelMeta | null>(null);
  const [name, setName] = React.useState('');

  const create = useMutation({
    mutationFn: (payload: any) => apiRequest('POST', '/api/agents', payload),
    onSuccess: (a: any) => { queryClient.invalidateQueries({ queryKey: ['/api/agents'] }); navigate('/agents/' + a.id); },
    onError: (e: any) => toast(e.message || 'Could not add agent', 'warn'),
  });

  function openPicker() { setPicking(true); setSelected(null); setName(''); }
  function closePicker() { setPicking(false); setSelected(null); }
  function pick(c: ChannelMeta) { if (!c.ready) return; setSelected(c); setName('My ' + c.label); }
  function add() { if (!selected) return; create.mutate({ name: name.trim() || 'My ' + selected.label, channelType: selected.type }); }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Your agents</h1>
        <p className="text-sm text-muted-foreground">Each agent replies to customers on one channel, trained on your business.</p>
      </div>

      <AgentsStats />

      {agents.length === 0 && !picking && (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Brand size={44} glow />
          <p className="max-w-sm text-sm text-muted-foreground">No agents yet. Add your first one — it takes about a minute.</p>
          <Button onClick={openPicker} className="whitespace-nowrap"><Plus size={16} /> Add your first agent</Button>
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

      {agents.length > 0 && !picking && (
        <Button variant="ghost" className="w-full whitespace-nowrap" onClick={openPicker}>
          <Plus size={16} /> Add another agent
        </Button>
      )}

      {picking && (
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Pick a channel</div>
              <div className="text-xs text-muted-foreground">Where should this agent talk to customers?</div>
            </div>
            <button onClick={closePicker} className="-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {CHANNELS.map((c) => {
              const Icon = c.icon;
              const active = selected?.type === c.type;
              return (
                <button
                  key={c.type}
                  disabled={!c.ready}
                  onClick={() => pick(c)}
                  className={cn(
                    'relative flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all',
                    !c.ready
                      ? 'cursor-not-allowed border-border opacity-55'
                      : active
                        ? cn(c.selected, 'shadow-sm')
                        : 'border-border hover:border-foreground/20 hover:bg-muted/40',
                  )}
                >
                  <span className={cn('grid h-9 w-9 place-items-center rounded-lg', c.badge)}>
                    <Icon size={18} />
                  </span>
                  <span className="text-sm font-medium">{c.label}</span>
                  <span className="text-[11px] leading-tight text-muted-foreground">{c.blurb}</span>
                  {!c.ready && (
                    <span className="absolute right-2 top-2 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Soon
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="border-t border-border pt-3">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name this {selected.label} agent</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={'My ' + selected.label}
                  onKeyDown={(e) => e.key === 'Enter' && add()}
                  className="flex-1"
                />
                <Button disabled={create.isPending} onClick={add} className="shrink-0 whitespace-nowrap">
                  <Plus size={16} /> Add agent
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
