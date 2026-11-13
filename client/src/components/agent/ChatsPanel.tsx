import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { cn, displayContact, timeAgo } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ChevronRight, Hand, BellOff, Bell, ArrowLeft, Send } from 'lucide-react';

export function ChatsPanel({ id }: { id: string }) {
  const { toast } = useToast();
  const convKey = ['/api/agents/' + id + '/conversations'];
  const { data: convs = [] } = useQuery<any[]>({ queryKey: convKey });
  const [openCid, setOpenCid] = React.useState<string | null>(null);
  const msgKey = ['/api/agents/' + id + '/conversations/' + openCid + '/messages'];
  const { data: msgs = [] } = useQuery<any[]>({ queryKey: msgKey, enabled: !!openCid });
  const conv = convs.find((c) => c.id === openCid);

  const refetchAll = () => { queryClient.invalidateQueries({ queryKey: msgKey }); queryClient.invalidateQueries({ queryKey: convKey }); };
  const approve = useMutation({ mutationFn: (mid: string) => apiRequest('POST', `/api/agents/${id}/messages/${mid}/approve`), onSuccess: refetchAll });
  const skip = useMutation({ mutationFn: (mid: string) => apiRequest('POST', `/api/agents/${id}/messages/${mid}/skip`), onSuccess: refetchAll });
  const patchConv = useMutation({ mutationFn: (body: any) => apiRequest('PATCH', `/api/agents/${id}/conversations/${openCid}`, body), onSuccess: refetchAll });

  const [reply, setReply] = React.useState('');
  const sendReply = useMutation({
    mutationFn: () => apiRequest('POST', `/api/agents/${id}/conversations/${openCid}/reply`, { text: reply }),
    onSuccess: () => { setReply(''); refetchAll(); },
    onError: (e: any) => toast(e.message || 'Could not send', 'destructive'),
  });

  if (convs.length === 0) {
    return <Card className="p-6 text-center text-sm text-muted-foreground">No conversations yet. When someone messages this agent, it shows here.</Card>;
  }

  if (openCid && conv) {
    return (
      <Card className="flex flex-col p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <button onClick={() => setOpenCid(null)} className="flex items-center gap-1 text-sm text-muted-foreground min-h-tap"><ArrowLeft size={16} /> {conv.contactName || displayContact(conv.contactNumber)}</button>
          <div className="flex gap-1.5">
            <Button size="sm" variant={conv.takenOver ? 'default' : 'ghost'} onClick={() => patchConv.mutate({ takenOver: !conv.takenOver })}>
              <Hand size={14} /> {conv.takenOver ? 'You' : 'Take over'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => patchConv.mutate({ muted: !conv.muted })}>
              {conv.muted ? <BellOff size={14} /> : <Bell size={14} />}
            </Button>
          </div>
        </div>

        {conv.takenOver && <div className="bg-warn/10 px-3 py-1.5 text-xs text-warn">You're handling this chat — the agent won't auto-reply.</div>}

        <div className="max-h-[50vh] space-y-2 overflow-y-auto p-3">
          {msgs.map((m) => (
            <div key={m.id} className={cn('flex flex-col gap-1', m.direction === 'inbound' ? 'items-start' : 'items-end')}>
              <div className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm', m.direction === 'inbound' ? 'bg-muted' : 'brand-gradient text-white')}>{m.body}</div>
              {m.status === 'draft' && (
                <div className="flex gap-1"><Button size="sm" onClick={() => approve.mutate(m.id)}>Send</Button><Button size="sm" variant="ghost" onClick={() => skip.mutate(m.id)}>Skip</Button></div>
              )}
              {m.status !== 'draft' && m.direction === 'outbound' && <span className="text-[10px] text-muted-foreground">{m.status}</span>}
            </div>
          ))}
        </div>

        {conv.takenOver && (
          <div className="flex gap-2 border-t border-border p-3">
            <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your reply…" onKeyDown={(e) => e.key === 'Enter' && reply.trim() && sendReply.mutate()} />
            <Button disabled={!reply.trim() || sendReply.isPending} onClick={() => sendReply.mutate()}><Send size={15} /></Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {convs.map((c) => (
        <Card key={c.id} className="flex cursor-pointer items-center justify-between gap-2 p-3 hover:bg-muted/40" onClick={() => setOpenCid(c.id)}>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{c.contactName || displayContact(c.contactNumber)}</span>
              {c.alertedAt && <span title="You were alerted about this chat">🔔</span>}
            </span>
            <span className="text-xs text-muted-foreground">{timeAgo(c.lastMessageAt)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            {c.alertedAt && <Badge variant="primary">Alerted</Badge>}
            {c.takenOver && <Badge variant="warn">You</Badge>}
            {c.muted && <BellOff size={13} className="text-muted-foreground" />}
            <ChevronRight size={16} className="text-muted-foreground" />
          </span>
        </Card>
      ))}
    </div>
  );
}
