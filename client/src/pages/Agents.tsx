import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest, queryClient } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/StatusPill';
import { AgentsStats } from '@/components/AgentsStats';
import { MessageCircle, Instagram, Mail, Globe, Send, Plus, ChevronRight } from 'lucide-react';

// The agent gallery — extensible from the channel registry (AGENTS.md).
const CHANNELS = [
  { type: 'whatsapp-web', label: 'WhatsApp', icon: MessageCircle, blurb: 'Reply to WhatsApp customers', ready: true },
  { type: 'website', label: 'Website', icon: Globe, blurb: 'A chat widget on your site', ready: true },
  { type: 'telegram', label: 'Telegram', icon: Send, blurb: 'A Telegram bot', ready: true },
  { type: 'instagram', label: 'Instagram', icon: Instagram, blurb: 'Answer Instagram DMs', ready: false },
  { type: 'gmail', label: 'Email', icon: Mail, blurb: 'Auto-reply to enquiries', ready: false },
];
const iconFor = (t: string) => (CHANNELS.find((c) => c.type === t)?.icon || MessageCircle);

export function Agents() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: agents = [] } = useQuery<any[]>({ queryKey: ['/api/agents'] });
  const [picking, setPicking] = React.useState(false);
  const [selected, setSelected] = React.useState<any>(null);
  const [name, setName] = React.useState('');

  const create = useMutation({
    mutationFn: (payload: any) => apiRequest('POST', '/api/agents', payload),
    onSuccess: (a: any) => { queryClient.invalidateQueries({ queryKey: ['/api/agents'] }); navigate('/agents/' + a.id); },
    onError: (e: any) => toast(e.message || 'Could not add agent', 'warn'),
  });

  function openPicker() { setPicking(true); setSelected(null); setName(''); }
  function pick(c: any) { if (!c.ready) return; setSelected(c); setName('My ' + c.label); }
  function add() { if (!selected) return; create.mutate({ name: name.trim() || 'My ' + selected.label, channelType: selected.type }); }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Your agents</h1>
        <p className="text-sm text-muted-foreground">Each agent replies to customers on one channel, trained on your business.</p>
      </div>

      <AgentsStats />

      {agents.length === 0 && !picking && (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">No agents yet. Add your first one — it takes about a minute.</p>
          <Button onClick={openPicker}><Plus size={16} /> Add your first agent</Button>
        </Card>
      )}

      {agents.map((a) => {
        const Icon = iconFor(a.channelType);
        return (
          <Card key={a.id} className="flex cursor-pointer items-center justify-between p-4 hover:bg-muted/40" onClick={() => navigate('/agents/' + a.id)}>
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-muted"><Icon size={18} /></span>
              <div>
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground">{a.autoSend ? 'Auto-reply on' : 'Approve before sending'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2"><StatusPill status={a.status} /><ChevronRight size={16} className="text-muted-foreground" /></div>
          </Card>
        );
      })}

      {agents.length > 0 && !picking && (
        <Button variant="ghost" className="w-full" onClick={openPicker}><Plus size={16} /> Add another agent</Button>
      )}

      {picking && (
        <Card className="space-y-3 p-4">
          <div className="text-sm font-medium">Pick a channel</div>
          <div className="grid grid-cols-4 gap-2">
            {CHANNELS.map((c) => (
              <button
                key={c.type}
                disabled={!c.ready}
                onClick={() => pick(c)}
                className={'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors ' +
                  (!c.ready ? 'border-border opacity-40' : selected?.type === c.type ? 'border-primary bg-primary/10' : 'border-border hover:border-primary')}
              >
                <c.icon size={20} />
                <span className="text-xs font-medium">{c.label}</span>
                <span className="text-[10px] text-muted-foreground">{c.ready ? c.blurb : 'Soon'}</span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="pt-1">
              <label className="mb-1 block text-xs text-muted-foreground">Name this {selected.label} agent</label>
              <div className="flex gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={'My ' + selected.label} onKeyDown={(e) => e.key === 'Enter' && add()} />
                <Button disabled={create.isPending} onClick={add}>Add agent</Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
