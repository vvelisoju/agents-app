import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest, queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { channelMeta } from '@/config/channels';
import { Sparkles, Plus, X, ChevronLeft, Wand2, AlertTriangle } from 'lucide-react';

type Channel = { type: string; label: string; blurb: string; ready: boolean };

const EXAMPLES = [
  'Reply to my salon’s WhatsApp — answer prices and opening hours, and offer to book a visit.',
  'Answer questions on my coworking space’s website chat, and flag anyone ready to tour.',
  'Handle my coaching centre’s enquiries — courses, fees, timings — and collect leads.',
];

// STU-20..23 — "describe your agent" creation: plain words -> a validated AgentSpec draft
// (POST /build) -> review -> create + apply-spec. The channel is connected afterwards in the
// agent's guided setup. Invisible-UI: one textarea, sensible defaults, a confirmable draft.
export function CreateAgent({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: channelsData } = useQuery<{ channels: Channel[] }>({ queryKey: ['/api/channels'] });
  const channels = (channelsData?.channels || []).filter((c) => c.ready);

  const [step, setStep] = React.useState<'describe' | 'review'>('describe');
  const [description, setDescription] = React.useState('');
  const [spec, setSpec] = React.useState<any>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [channelType, setChannelType] = React.useState('whatsapp-web');

  const build = useMutation({
    mutationFn: () => apiRequest('POST', '/api/agents/build', { description: description.trim(), channelType }),
    onSuccess: (r: any) => { setSpec(r.spec); setWarnings(r.warnings || []); setStep('review'); },
    onError: (e: any) => toast(e.message || 'Could not draft your agent — try rephrasing.', 'warn'),
  });

  const create = useMutation({
    mutationFn: async () => {
      const agent = await apiRequest('POST', '/api/agents', { name: spec.identity.name, channelType });
      await apiRequest('POST', `/api/agents/${agent.id}/apply-spec`, { spec: { ...spec, channel: { ...spec.channel, type: channelType } } });
      return agent;
    },
    onSuccess: (a: any) => { queryClient.invalidateQueries({ queryKey: ['/api/agents'] }); navigate('/agents/' + a.id); },
    onError: (e: any) => toast(e.message || 'Could not create the agent', 'warn'),
  });

  // Escape hatch: a blank agent for owners who prefer to train it by hand.
  const createBlank = useMutation({
    mutationFn: () => apiRequest('POST', '/api/agents', { name: 'My ' + channelMeta(channelType).label, channelType }),
    onSuccess: (a: any) => { queryClient.invalidateQueries({ queryKey: ['/api/agents'] }); navigate('/agents/' + a.id); },
    onError: (e: any) => toast(e.message || 'Could not create the agent', 'warn'),
  });

  const ChannelChips = () => (
    <div className="flex flex-wrap gap-2">
      {channels.map((c) => {
        const Icon = channelMeta(c.type).icon;
        const active = channelType === c.type;
        return (
          <button
            key={c.type}
            onClick={() => setChannelType(c.type)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              active ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50',
            )}
          >
            <Icon size={13} /> {c.label}
          </button>
        );
      })}
    </div>
  );

  if (step === 'describe') {
    return (
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Sparkles size={16} /></span>
            <div>
              <div className="text-sm font-semibold">Describe your agent</div>
              <div className="text-xs text-muted-foreground">In your own words — we’ll set it up for you.</div>
            </div>
          </div>
          <button onClick={onClose} className="-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close"><X size={16} /></button>
        </div>

        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Reply to my salon’s WhatsApp — answer prices and hours, and offer to book."
          rows={4}
          autoFocus
        />

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex, i) => (
            <button key={i} onClick={() => setDescription(ex)} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/50">
              {ex.split('—')[0].trim().slice(0, 28)}…
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Which channel?</div>
          <ChannelChips />
        </div>

        <Button className="w-full" disabled={description.trim().length < 3 || build.isPending} onClick={() => build.mutate()}>
          <Wand2 size={16} /> {build.isPending ? 'Drafting your agent…' : 'Create my agent'}
        </Button>
        <div className="text-center">
          <button onClick={() => createBlank.mutate()} disabled={createBlank.isPending} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">
            Skip — I’ll set it up myself
          </button>
        </div>
        <p className="text-center text-[11px] text-muted-foreground">It never invents prices or facts — you review everything before it goes live.</p>
      </Card>
    );
  }

  // review step
  const knowledge = spec?.knowledge || [];
  const counts = {
    fact: knowledge.filter((k: any) => k.type === 'fact').length,
    faq: knowledge.filter((k: any) => k.type === 'faq').length,
    link: knowledge.filter((k: any) => k.type === 'link').length,
  };
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <button onClick={() => setStep('describe')} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Back"><ChevronLeft size={16} /></button>
        <div className="text-sm font-semibold">Review your agent</div>
      </div>

      {warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>{warnings.join(' ')}</div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
        <Input value={spec.identity.name} onChange={(e) => setSpec({ ...spec, identity: { name: e.target.value } })} />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">How it should help customers</label>
        <Textarea
          value={spec.persona.instructions}
          onChange={(e) => setSpec({ ...spec, persona: { ...spec.persona, instructions: e.target.value } })}
          rows={3}
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        It will know <b className="text-foreground">{counts.fact}</b> fact(s), <b className="text-foreground">{counts.faq}</b> FAQ(s)
        and <b className="text-foreground">{counts.link}</b> link(s) — you can add more after it’s created.
      </div>

      <Button className="w-full" disabled={!spec.identity.name.trim() || create.isPending} onClick={() => create.mutate()}>
        <Plus size={16} /> {create.isPending ? 'Creating…' : 'Create & set up'}
      </Button>
    </Card>
  );
}
