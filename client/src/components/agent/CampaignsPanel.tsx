import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest, queryClient } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Megaphone, AlertTriangle, ShieldCheck, Send, Clock } from 'lucide-react';

type Conn = { active: boolean; riskAckAt: string | null; dailyCap: number; windowStart: number; windowEnd: number; hasToken: boolean } | null;

// SCN-16/17 — outbound campaign console. Accepted-risk consent → activate → start a campaign
// (which requires owner approval before a single message is sent) → live progress. Invisible-UI:
// zero-decision defaults, the risk acknowledgement is explicit, 'Start sending' is one tap.
export function CampaignsPanel({ id }: { id: string }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const connKey = ['/api/agents/' + id + '/outbound/connection'];
  const { data } = useQuery<{ connection: Conn }>({ queryKey: connKey });
  const conn = data?.connection || null;

  const [promo, setPromo] = React.useState('');
  const [recipientsText, setRecipientsText] = React.useState('');
  const [startedRunId, setStartedRunId] = React.useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: connKey });

  const enable = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', `/api/agents/${id}/outbound/connection`, { acceptRisk: true });
      await apiRequest('POST', `/api/agents/${id}/outbound/connection/active`, { active: true });
    },
    onSuccess: () => { refresh(); toast('Outbound enabled. Campaigns still need your approval before sending.', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not enable outbound', 'warn'),
  });

  const start = useMutation({
    mutationFn: () => apiRequest('POST', `/api/agents/${id}/outbound/campaigns`, {
      promo: promo.trim(),
      recipients: recipientsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).map((phone) => ({ phone })),
    }),
    onSuccess: (r: any) => { setStartedRunId(r.runId); setPromo(''); setRecipientsText(''); toast('Campaign created — approve it to start sending.', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not start the campaign', 'warn'),
  });

  // Not yet consented/active → show the accepted-risk gate.
  if (!conn || !conn.active) {
    return (
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Megaphone size={16} /></span>
          <div className="text-sm font-semibold">Send a campaign</div>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Please read before enabling.</p>
            <p className="mt-1">Sending unsolicited WhatsApp messages carries a real risk of your number being banned. We keep it safe with low volume, random timing, a send window, and a STOP opt-out — but the risk is yours. Use a <span className="font-medium">secondary number</span>, not your main business line.</p>
          </div>
        </div>
        <Button className="w-full" disabled={enable.isPending} onClick={() => enable.mutate()}>
          <ShieldCheck size={16} /> {enable.isPending ? 'Enabling…' : 'I understand — enable outbound'}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Megaphone size={16} /></span>
          <div>
            <div className="text-sm font-semibold">New campaign</div>
            <div className="text-xs text-muted-foreground">~{conn.dailyCap}/day, {conn.windowStart}:00–{conn.windowEnd}:00, with random spacing and a STOP footer.</div>
          </div>
        </div>
        <Textarea value={promo} onChange={(e) => setPromo(e.target.value)} rows={3} placeholder="Your promo message. A 'Reply STOP to unsubscribe' line is added automatically." />
        <Textarea value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)} rows={4} placeholder="Phone numbers — one per line (10-digit mobile)." />
        <Button className="w-full" disabled={promo.trim().length < 3 || recipientsText.trim().length < 10 || start.isPending} onClick={() => start.mutate()}>
          <Send size={16} /> {start.isPending ? 'Creating…' : 'Create campaign (needs your approval)'}
        </Button>
        <p className="text-center text-[11px] text-muted-foreground">Nothing is sent until you approve it in Automations.</p>
      </Card>

      {startedRunId && <CampaignProgress id={id} runId={startedRunId} onOpen={() => navigate('/automations')} />}
    </div>
  );
}

function CampaignProgress({ id, runId, onOpen }: { id: string; runId: string; onOpen: () => void }) {
  const { data } = useQuery<any>({ queryKey: ['/api/agents/' + id + '/outbound/campaigns/' + runId], refetchInterval: 6_000 });
  if (!data) return null;
  const c = data.counts || {};
  const statusLabel: Record<string, string> = {
    awaiting_approval: 'Waiting for your approval', running: 'Sending', sleeping: 'Scheduled',
    paused: 'Paused', completed: 'Done', failed: 'Failed', canceled: 'Canceled',
  };
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Latest campaign</div>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock size={12} /> {statusLabel[data.status] || data.status}</span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        {[['Sent', c.sent || 0], ['Delivered', c.delivered || 0], ['Failed', c.failed || 0], ['Opted out', c.opted_out || 0]].map(([label, n]) => (
          <div key={label as string} className="rounded-lg border border-border bg-muted/30 p-2">
            <div className="text-lg font-semibold">{n as number}</div>
            <div className="text-[10px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">of {data.total} recipients</div>
      <Button variant="ghost" className="w-full" onClick={onOpen}>Manage in Automations</Button>
    </Card>
  );
}
