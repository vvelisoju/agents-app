import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest, queryClient } from '@/lib/api';
import { useAgentEvents } from '@/lib/ws';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Tabs } from '@/components/ui/tabs';
import { StatusPill } from '@/components/StatusPill';
import { TrainingPanel } from '@/components/agent/TrainingPanel';
import { TestPanel } from '@/components/agent/TestPanel';
import { ChatsPanel } from '@/components/agent/ChatsPanel';
import { AvailabilityCard } from '@/components/agent/AvailabilityCard';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ArrowLeft, QrCode, Globe, Send } from 'lucide-react';

const WIDGET_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:4001';

export function AgentDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const agentKey = ['/api/agents/' + id];
  const { data: agent } = useQuery<any>({ queryKey: agentKey });
  const [qr, setQr] = React.useState('');
  const [tab, setTab] = React.useState('train');
  const [botToken, setBotToken] = React.useState('');

  useAgentEvents(id, (type, payload) => {
    if (type === 'qr') setQr(payload.dataUrl);
    else if (type === 'status') {
      if (payload.status === 'connected') setQr('');
      queryClient.invalidateQueries({ queryKey: agentKey });
    } else if (type === 'message') {
      queryClient.invalidateQueries({ queryKey: ['/api/agents/' + id + '/conversations'] });
    }
  });

  const connect = useMutation({ mutationFn: () => apiRequest('POST', `/api/agents/${id}/connect`), onSuccess: () => queryClient.invalidateQueries({ queryKey: agentKey }) });
  const disconnect = useMutation({ mutationFn: () => apiRequest('POST', `/api/agents/${id}/disconnect`), onSuccess: () => { setQr(''); queryClient.invalidateQueries({ queryKey: agentKey }); } });
  const toggle = useMutation({ mutationFn: (v: boolean) => apiRequest('PATCH', `/api/agents/${id}`, { autoSend: v }), onSuccess: () => queryClient.invalidateQueries({ queryKey: agentKey }) });

  const { toast } = useToast();
  if (!agent) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const connected = agent.status === 'connected';
  const isWebsite = agent.channelType === 'website';
  const isTelegram = agent.channelType === 'telegram';
  const snippet = `<script src="${WIDGET_BASE}/widget.js" data-agent="${id}"></script>`;
  const connectTelegram = async () => {
    try { await apiRequest('PATCH', `/api/agents/${id}`, { channelConfig: { botToken: botToken.trim() } }); connect.mutate(); }
    catch (e: any) { toast(e.message || 'Could not save the bot token', 'warn'); }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/agents')} className="flex items-center gap-1 text-sm text-muted-foreground min-h-tap"><ArrowLeft size={16} /> Agents</button>
        <StatusPill status={agent.status} />
      </div>
      <h1 className="text-xl font-semibold">{agent.name}</h1>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {connected ? (
            <Button variant="ghost" onClick={() => disconnect.mutate()}>{isWebsite ? 'Turn off' : 'Disconnect'}</Button>
          ) : isWebsite ? (
            <Button onClick={() => connect.mutate()} disabled={connect.isPending}><Globe size={16} /> Turn on widget</Button>
          ) : isTelegram ? (
            <Button onClick={connectTelegram} disabled={!botToken.trim() || connect.isPending}><Send size={16} /> Connect bot</Button>
          ) : (
            <Button onClick={() => connect.mutate()} disabled={connect.isPending}><QrCode size={16} /> Connect / show QR</Button>
          )}
          <label className="ml-auto flex items-center gap-2 text-sm">
            <Switch checked={!!agent.autoSend} onCheckedChange={(v) => toggle.mutate(v)} label="auto-reply" />
            Auto-reply
          </label>
        </div>

        {!connected && isTelegram && (
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-sm text-muted-foreground">Create a bot with <b>@BotFather</b> on Telegram, then paste its token:</p>
            <Input value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456:ABC-DEF…" />
          </div>
        )}

        {!connected && !isWebsite && !isTelegram && qr && (
          <div className="rounded-lg border border-border p-4 text-center">
            <p className="mb-2 text-sm text-muted-foreground">Open WhatsApp → Linked Devices → Link a device, then scan:</p>
            <img src={qr} alt="QR code" className="mx-auto h-56 w-56 rounded bg-white p-2" />
          </div>
        )}

        {isWebsite && (
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-sm text-muted-foreground">Paste this just before <code>&lt;/body&gt;</code> on your website:</p>
            <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs">{snippet}</pre>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => { navigator.clipboard?.writeText(snippet); toast('Snippet copied', 'good'); }}>Copy snippet</Button>
          </div>
        )}

        {connected && (
          <p className="text-sm text-good">{isWebsite ? 'Your widget is live' : 'Connected'} — replies go out{agent.autoSend ? ' automatically.' : ' once you approve each draft.'}</p>
        )}
      </Card>

      <AvailabilityCard id={id} agent={agent} />

      <Tabs
        tabs={[{ id: 'train', label: 'Train' }, { id: 'test', label: 'Test' }, { id: 'chats', label: 'Chats' }]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'train' && <TrainingPanel id={id} />}
      {tab === 'test' && <TestPanel id={id} />}
      {tab === 'chats' && <ChatsPanel id={id} />}
    </div>
  );
}
