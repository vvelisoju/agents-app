import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest, queryClient } from '@/lib/api';
import { useAgentEvents } from '@/lib/ws';
import { cn } from '@/lib/utils';
import { channelMeta } from '@/config/channels';
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
import { ArrowLeft, QrCode, Globe, Send, Copy } from 'lucide-react';

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

  const copySnippet = () => { navigator.clipboard?.writeText(snippet); toast('Snippet copied', 'good'); };

  const SnippetBlock = () => (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-sm text-muted-foreground">Add this one line just before <code>&lt;/body&gt;</code> on your website:</p>
      <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs">{snippet}</pre>
      <Button size="sm" variant="ghost" className="mt-2" onClick={copySnippet}><Copy size={14} /> Copy snippet</Button>
    </div>
  );

  const m = channelMeta(agent.channelType);
  const ChannelIcon = m.icon;

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/agents')} className="flex items-center gap-1 text-sm text-muted-foreground min-h-tap"><ArrowLeft size={16} /> Agents</button>

      {/* Agent hero — channel identity, status, and current mode at a glance. */}
      <Card className="relative overflow-hidden p-5">
        <div
          className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full blur-3xl"
          style={{ background: `radial-gradient(circle, ${m.color}40, transparent 70%)` }}
        />
        <div className="relative flex items-center gap-4">
          <span className={cn('grid h-14 w-14 shrink-0 place-items-center rounded-2xl', m.badge)}>
            <ChannelIcon size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">{agent.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>{m.label} agent</span>
              <span className="text-border">•</span>
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-good' : 'bg-muted-foreground/50')} />
                {agent.autoSend ? 'Auto-reply on' : 'Approve before sending'}
              </span>
            </div>
          </div>
          <div className="shrink-0 self-start"><StatusPill status={agent.status} /></div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4 lg:sticky lg:top-4">
      <Card className="space-y-4 p-4">
        {connected ? (
          <>
            {/* Live status header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-good" />
                </span>
                <div>
                  <div className="font-medium text-good">{isWebsite ? 'Widget is live' : 'Connected'}</div>
                  <div className="text-xs text-muted-foreground">{agent.autoSend ? 'Replies send automatically.' : 'Drafts wait for your approval.'}</div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>{isWebsite ? 'Turn off' : 'Disconnect'}</Button>
            </div>

            {/* Auto-reply control — state stated in words */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <div>
                <div className="text-sm font-medium">Auto-reply</div>
                <div className="text-xs text-muted-foreground">{agent.autoSend ? 'On — the agent replies on its own.' : 'Off — you approve each draft first.'}</div>
              </div>
              <Switch checked={!!agent.autoSend} onCheckedChange={(v) => toggle.mutate(v)} label="auto-reply" />
            </div>

            {isWebsite && <SnippetBlock />}
          </>
        ) : (
          <>
            {/* Not connected — one clear step to go live */}
            <div>
              <div className="font-medium">{isWebsite ? 'Turn on your website widget' : isTelegram ? 'Connect your Telegram bot' : 'Connect WhatsApp'}</div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {isWebsite ? 'Switch it on, then paste one line into your site.'
                  : isTelegram ? 'Create a bot with @BotFather, paste its token, and connect.'
                  : 'Scan a QR code with WhatsApp on your phone — about 20 seconds.'}
              </p>
            </div>

            {isTelegram && (
              <Input value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="Bot token, e.g. 123456:ABC-DEF…" />
            )}

            <div>
              {isWebsite ? (
                <Button onClick={() => connect.mutate()} disabled={connect.isPending}><Globe size={16} /> Turn on widget</Button>
              ) : isTelegram ? (
                <Button onClick={connectTelegram} disabled={!botToken.trim() || connect.isPending}><Send size={16} /> Connect bot</Button>
              ) : (
                <Button onClick={() => connect.mutate()} disabled={connect.isPending}><QrCode size={16} /> {connect.isPending ? 'Starting…' : 'Connect WhatsApp'}</Button>
              )}
            </div>

            {!isWebsite && !isTelegram && qr && (
              <div className="rounded-lg border border-border p-4 text-center">
                <p className="mb-2 text-sm text-muted-foreground">Open WhatsApp → Linked Devices → Link a device, then scan:</p>
                <img src={qr} alt="QR code" className="mx-auto h-56 w-56 rounded bg-white p-2" />
              </div>
            )}

            {isWebsite && <SnippetBlock />}
          </>
        )}
      </Card>

      <AvailabilityCard id={id} agent={agent} />
      </div>

      <div className="space-y-4">
        <Tabs
          tabs={[{ id: 'train', label: 'Train' }, { id: 'test', label: 'Test' }, { id: 'chats', label: 'Chats' }]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'train' && <TrainingPanel id={id} />}
        {tab === 'test' && <TestPanel id={id} />}
        {tab === 'chats' && <ChatsPanel id={id} />}
      </div>
      </div>
    </div>
  );
}
