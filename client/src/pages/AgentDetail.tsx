import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { queryClient } from '@/lib/api';
import { useAgentEvents } from '@/lib/ws';
import { cn } from '@/lib/utils';
import { channelMeta } from '@/config/channels';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { StatusPill } from '@/components/StatusPill';
import { TrainingPanel } from '@/components/agent/TrainingPanel';
import { TestPanel } from '@/components/agent/TestPanel';
import { ChatsPanel } from '@/components/agent/ChatsPanel';
import { VersionsPanel } from '@/components/agent/VersionsPanel';
import { MonitorsPanel } from '@/components/agent/MonitorsPanel';
import { AvailabilityCard } from '@/components/agent/AvailabilityCard';
import { ConnectCard } from '@/components/agent/ConnectCard';
import { AlertSettingsCard } from '@/components/agent/AlertSettingsCard';
import { SetupGuide } from '@/components/agent/SetupGuide';
import { ArrowLeft, Wand2 } from 'lucide-react';

const setupKey = (id: string) => 'sa_setup_done:' + id;
const readDone = (id: string) => { try { return localStorage.getItem(setupKey(id)) === '1'; } catch { return false; } };
const writeDone = (id: string, v: boolean) => { try { v ? localStorage.setItem(setupKey(id), '1') : localStorage.removeItem(setupKey(id)); } catch { /* ignore */ } };

export function AgentDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const agentKey = ['/api/agents/' + id];
  const { data: agent } = useQuery<any>({ queryKey: agentKey });
  const { data: training } = useQuery<any>({ queryKey: ['/api/agents/' + id + '/training'] });
  const { data: me } = useQuery<any>({ queryKey: ['/api/me'] });
  const { data: config } = useQuery<any>({ queryKey: ['/api/config'] });
  const [tab, setTab] = React.useState('train');
  const [setupDone, setSetupDone] = React.useState(() => readDone(id));

  useAgentEvents(id, (type) => {
    if (type === 'status') queryClient.invalidateQueries({ queryKey: agentKey });
    else if (type === 'message' || type === 'alert') queryClient.invalidateQueries({ queryKey: ['/api/agents/' + id + '/conversations'] });
  });

  // Wait for training too, so the live-vs-setup decision is made once (no guide flash).
  if (!agent || training === undefined) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const connected = agent.status === 'connected';
  const trained = (training?.sources?.length || 0) > 0 || !!training?.profile?.instructions?.trim();
  const fullyLive = connected && trained && agent.autoSend;
  const isWhatsapp = agent.channelType === 'whatsapp-web';
  const m = channelMeta(agent.channelType);
  const ChannelIcon = m.icon;

  const finish = () => { writeDone(id, true); setSetupDone(true); };
  const resume = () => { writeDone(id, false); setSetupDone(false); };

  // A brand-new / not-yet-live agent opens straight into the guided setup, unless
  // the owner chose to skip it. Fully-live agents always get the dashboard.
  const showGuide = !fullyLive && !setupDone;

  if (showGuide) {
    return (
      <div className="space-y-5">
        <button onClick={() => navigate('/agents')} className="flex items-center gap-1 text-sm text-muted-foreground min-h-tap"><ArrowLeft size={16} /> Agents</button>
        <SetupGuide id={id} agent={agent} onFinish={finish} onSkip={finish} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/agents')} className="flex items-center gap-1 text-sm text-muted-foreground min-h-tap"><ArrowLeft size={16} /> Agents</button>

      {/* Agent hero — channel identity, status, and current mode at a glance. */}
      <Card className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full blur-3xl" style={{ background: `radial-gradient(circle, ${m.color}40, transparent 70%)` }} />
        <div className="relative flex items-center gap-4">
          <span className={cn('grid h-14 w-14 shrink-0 place-items-center rounded-2xl', m.badge)}><ChannelIcon size={26} /></span>
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

      {/* Gentle nudge back into the guide if they skipped before going live. */}
      {!fullyLive && (
        <button onClick={resume} className="flex w-full items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-primary/10">
          <Wand2 size={16} className="shrink-0 text-primary" />
          <span className="flex-1"><span className="font-medium">Finish setting up</span> <span className="text-muted-foreground">— {!connected ? 'connect your channel' : !trained ? 'teach it your business' : 'turn on auto-reply'} to go fully live.</span></span>
        </button>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4 lg:sticky lg:top-4">
          <ConnectCard id={id} agent={agent} />
          {isWhatsapp && <AlertSettingsCard id={id} agent={agent} defaultPhone={me?.phone} />}
          <AvailabilityCard id={id} agent={agent} />
        </div>

        <div className="space-y-4">
          <Tabs
            tabs={[
              { id: 'train', label: 'Train' },
              { id: 'test', label: 'Test' },
              { id: 'chats', label: 'Chats' },
              ...(config?.features?.monitor ? [{ id: 'monitors', label: 'Monitors' }] : []),
              { id: 'versions', label: 'Versions' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'train' && <TrainingPanel id={id} />}
          {tab === 'test' && <TestPanel id={id} />}
          {tab === 'chats' && <ChatsPanel id={id} />}
          {tab === 'monitors' && config?.features?.monitor && <MonitorsPanel id={id} />}
          {tab === 'versions' && <VersionsPanel id={id} />}
        </div>
      </div>
    </div>
  );
}
