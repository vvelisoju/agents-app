import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest, queryClient, getToken } from '@/lib/api';
import { cn, displayContact, timeAgo } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { channelMeta } from '@/config/channels';
import { Download, ChevronRight } from 'lucide-react';

const STAGES = ['new', 'qualified', 'won', 'lost'] as const;
const stageTone: Record<string, 'default' | 'primary' | 'good' | 'warn'> = {
  new: 'primary', qualified: 'warn', won: 'good', lost: 'default',
};

function LeadCard({ lead, navigate }: { lead: any; navigate: (to: string) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [notes, setNotes] = React.useState(lead.leadNotes || '');

  const patch = useMutation({
    mutationFn: (body: any) => apiRequest('PATCH', `/api/leads/${lead.id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/leads'] }),
    onError: (e: any) => toast(e.message || 'Could not update', 'destructive'),
  });

  const m = channelMeta(lead.channelType);
  const ChannelIcon = m.icon;

  return (
    <Card className="overflow-hidden">
      <button className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-muted/40" onClick={() => setOpen((v) => !v)}>
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md', m.badge)}><ChannelIcon size={15} /></span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{lead.contactName || displayContact(lead.contactNumber)}</span>
              {lead.alertedAt && <span title="Urgent lead — you were alerted">🔥</span>}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{lead.agentName} · {timeAgo(lead.lastMessageAt)}</span>
          </span>
        </span>
        <Badge variant={stageTone[lead.leadStatus] || 'default'}>{lead.leadStatus}</Badge>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <button
                key={s}
                onClick={() => patch.mutate({ leadStatus: s })}
                className={cn('rounded-full border px-2.5 py-1 text-xs capitalize transition-colors',
                  lead.leadStatus === s ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:border-primary')}
              >
                {s}
              </button>
            ))}
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes about this lead…" className="min-h-[56px]" />
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => patch.mutate({ leadNotes: notes })}>Save notes</Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => navigate('/agents/' + lead.agentId)}>Open chat <ChevronRight size={14} /></Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function Leads() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: leads = [], isLoading } = useQuery<any[]>({ queryKey: ['/api/leads'] });
  const [filter, setFilter] = React.useState<string>('all');

  const shown = filter === 'all' ? leads : leads.filter((l) => l.leadStatus === filter);

  async function exportCsv() {
    try {
      const res = await fetch('/api/leads/export', { headers: { Authorization: 'Bearer ' + getToken() } });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'leads.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast(e.message || 'Export failed', 'destructive'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">Everyone your agents captured, across all channels.</p>
        </div>
        {leads.length > 0 && <Button size="sm" variant="ghost" onClick={exportCsv}><Download size={15} /> Export</Button>}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {['all', ...STAGES].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn('shrink-0 rounded-full border px-3 py-1 text-xs capitalize transition-colors',
              filter === s ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground')}
          >
            {s}{s !== 'all' ? ` (${leads.filter((l) => l.leadStatus === s).length})` : ''}
          </button>
        ))}
      </div>

      {isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
      {!isLoading && leads.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">No leads yet. When customers chat with your agents, they show up here.</Card>
      )}
      <div className="space-y-2">
        {shown.map((l) => <LeadCard key={l.id} lead={l} navigate={navigate} />)}
      </div>
    </div>
  );
}
