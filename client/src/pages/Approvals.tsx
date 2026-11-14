import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ShieldCheck, Check, X, Inbox } from 'lucide-react';

type Approval = { id: string; actionType: string; payloadJson: string; agentId: string | null; createdAt: string };

// POL-16/20 — the human-in-the-loop inbox: everything the agents want to do that needs your OK
// (send a campaign, book a slot, run a write/external tool). Approving runs the gated action
// exactly once; rejecting discards it. Outcome-named, plain-language — never raw action codes.
function describe(a: Approval): string {
  let p: any = {};
  try { p = JSON.parse(a.payloadJson || '{}'); } catch { /* ignore */ }
  switch (a.actionType) {
    case 'bulk_send': return `Send a campaign to ${p.recipients ?? 'several'} people`;
    case 'booking': return 'Confirm an appointment booking';
    case 'send_reply': return `Send a message${p.input?.to ? ' to a contact' : ''}`;
    case 'web_fetch': return 'Fetch a web page';
    case 'create_lead':
    case 'update_lead': return 'Save a lead to your CRM';
    default: return a.actionType.replace(/[._]/g, ' ');
  }
}

export function Approvals() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ approvals: Approval[] }>({ queryKey: ['/api/approvals'], refetchInterval: 8_000 });
  const approvals = data?.approvals || [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['/api/approvals'] });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => apiRequest('POST', `/api/approvals/${id}/${action}`, {}),
    onSuccess: (_r, v) => { refresh(); toast(v.action === 'approve' ? 'Approved.' : 'Rejected.', v.action === 'approve' ? 'good' : 'default'); },
    onError: (e: any) => toast(e.message || 'Could not update', 'warn'),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">Actions your agents want to take that need your OK. Nothing happens until you approve.</p>
      </div>

      {approvals.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck size={22} /></span>
          <p className="max-w-sm text-sm text-muted-foreground">You’re all caught up. When an agent wants to send a campaign, book an appointment, or use a tool that needs sign-off, it’ll wait for you here.</p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {approvals.map((a) => (
            <Card key={a.id} className="flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400"><Inbox size={18} /></span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{describe(a)}</div>
                  <div className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: 'reject' })}><X size={14} /> Reject</Button>
                <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: 'approve' })}><Check size={14} /> Approve</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
