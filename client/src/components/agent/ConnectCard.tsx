import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { useAgentEvents } from '@/lib/ws';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { QrCode, Globe, Send, Copy, CheckCircle2 } from 'lucide-react';

const WIDGET_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:4001';

// The one place that connects an agent to its channel (QR / widget / bot token)
// and, in the full dashboard, exposes disconnect + the auto-reply toggle.
// `variant='connect'` is the slim version used inside the guided setup: just
// get it connected, nothing else.
export function ConnectCard({ id, agent, variant = 'full' }: { id: string; agent: any; variant?: 'full' | 'connect' }) {
  const { toast } = useToast();
  const agentKey = ['/api/agents/' + id];
  const [qr, setQr] = React.useState('');
  const [botToken, setBotToken] = React.useState('');

  useAgentEvents(id, (type, payload) => {
    if (type === 'qr') setQr(payload.dataUrl);
    else if (type === 'status') { if (payload.status === 'connected') setQr(''); queryClient.invalidateQueries({ queryKey: agentKey }); }
  });

  const connect = useMutation({ mutationFn: () => apiRequest('POST', `/api/agents/${id}/connect`), onSuccess: () => queryClient.invalidateQueries({ queryKey: agentKey }) });
  const disconnect = useMutation({ mutationFn: () => apiRequest('POST', `/api/agents/${id}/disconnect`), onSuccess: () => { setQr(''); queryClient.invalidateQueries({ queryKey: agentKey }); } });
  const toggle = useMutation({ mutationFn: (v: boolean) => apiRequest('PATCH', `/api/agents/${id}`, { autoSend: v }), onSuccess: () => queryClient.invalidateQueries({ queryKey: agentKey }) });

  const connected = agent.status === 'connected';
  const isWebsite = agent.channelType === 'website';
  const isTelegram = agent.channelType === 'telegram';
  const snippet = `<script src="${WIDGET_BASE}/widget.js" data-agent="${id}"></script>`;
  const copySnippet = () => { navigator.clipboard?.writeText(snippet); toast('Snippet copied', 'good'); };
  const connectTelegram = async () => {
    try { await apiRequest('PATCH', `/api/agents/${id}`, { channelConfig: { botToken: botToken.trim() } }); connect.mutate(); }
    catch (e: any) { toast(e.message || 'Could not save the bot token', 'warn'); }
  };

  const SnippetBlock = () => (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-sm text-muted-foreground">Add this one line just before <code>&lt;/body&gt;</code> on your website:</p>
      <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs">{snippet}</pre>
      <Button size="sm" variant="ghost" className="mt-2" onClick={copySnippet}><Copy size={14} /> Copy snippet</Button>
    </div>
  );

  // Connected view. In the slim 'connect' variant we only confirm success.
  if (connected) {
    if (variant === 'connect') {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 rounded-lg border border-good/40 bg-good/10 p-3">
            <CheckCircle2 size={18} className="text-good" />
            <div className="text-sm font-medium text-good">{isWebsite ? 'Your widget is live.' : 'Connected to WhatsApp.'}</div>
          </div>
          {isWebsite && <SnippetBlock />}
        </div>
      );
    }
    return (
      <Card className="space-y-4 p-4">
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

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div>
            <div className="text-sm font-medium">Auto-reply</div>
            <div className="text-xs text-muted-foreground">{agent.autoSend ? 'On — the agent replies on its own.' : 'Off — you approve each draft first.'}</div>
          </div>
          <Switch checked={!!agent.autoSend} onCheckedChange={(v) => toggle.mutate(v)} label="auto-reply" />
        </div>

        {isWebsite && <SnippetBlock />}
      </Card>
    );
  }

  // Not connected — one clear step to go live. The guide wraps this without a Card.
  const Body = (
    <>
      <div>
        <div className="font-medium">{isWebsite ? 'Turn on your website widget' : isTelegram ? 'Connect your Telegram bot' : 'Connect WhatsApp'}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {isWebsite ? 'Switch it on, then paste one line into your site.'
            : isTelegram ? 'Create a bot with @BotFather, paste its token, and connect.'
            : 'Open WhatsApp on your phone, then scan the code — about 20 seconds.'}
        </p>
      </div>

      {isTelegram && <Input value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="Bot token, e.g. 123456:ABC-DEF…" />}

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
          <p className="mb-2 text-sm text-muted-foreground">WhatsApp → Linked Devices → Link a device, then scan:</p>
          <img src={qr} alt="QR code" className="mx-auto h-56 w-56 rounded bg-white p-2" />
        </div>
      )}
      {!isWebsite && !isTelegram && !qr && connect.isPending && (
        <p className="text-xs text-muted-foreground">Generating your QR code…</p>
      )}

      {isWebsite && <SnippetBlock />}
    </>
  );

  return variant === 'connect' ? <div className="space-y-3">{Body}</div> : <Card className="space-y-4 p-4">{Body}</Card>;
}
