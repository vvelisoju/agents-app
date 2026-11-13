import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConnectCard } from './ConnectCard';
import { ALERT_CONDITION_PLACEHOLDER } from './AlertSettingsCard';
import { Check, Sparkles, Zap, HandMetal, Siren, ArrowRight, Loader2 } from 'lucide-react';

type Props = { id: string; agent: any; onFinish: () => void; onSkip: () => void };

// The guided, one-step-at-a-time setup a fresh agent opens into. The whole point:
// a non-technical owner gets to "live" without reading a manual — connect, paste
// your website, go live. Each step reveals only what's needed now and advances
// itself as the previous one completes.
export function SetupGuide({ id, agent, onFinish, onSkip }: Props) {
  const { toast } = useToast();
  const trainingKey = ['/api/agents/' + id + '/training'];
  const { data: training } = useQuery<any>({ queryKey: trainingKey });
  const { data: me } = useQuery<any>({ queryKey: ['/api/me'] });

  const connected = agent.status === 'connected';
  const trained = (training?.sources?.length || 0) > 0 || !!training?.profile?.instructions?.trim();
  const isWhatsapp = agent.channelType === 'whatsapp-web';

  const derived = !connected ? 1 : !trained ? 2 : 3;
  const [step, setStep] = React.useState(derived);
  React.useEffect(() => { setStep(derived); }, [derived]); // auto-advance as steps complete

  // ---- Step 2: learn from the website (minimal clicks: paste → one button) ----
  const [url, setUrl] = React.useState('');
  const [learnedCounts, setLearnedCounts] = React.useState<{ facts: number; faqs: number; links: number } | null>(null);
  const invalidateTraining = () => queryClient.invalidateQueries({ queryKey: trainingKey });

  const learnAndApply = useMutation({
    mutationFn: async () => {
      const r: any = await apiRequest('POST', `/api/agents/${id}/training/learn`, { url });
      const s = r?.suggestion || {};
      await apiRequest('PUT', `/api/agents/${id}/training/profile`, {
        instructions: s.instructions || '', tone: s.tone, language: s.language, restrictions: training?.profile?.restrictions || '',
      });
      for (const f of s.facts || []) await apiRequest('POST', `/api/agents/${id}/training/sources`, { type: 'fact', data: { content: f } });
      for (const q of s.faqs || []) await apiRequest('POST', `/api/agents/${id}/training/sources`, { type: 'faq', data: q });
      for (const l of s.links || []) await apiRequest('POST', `/api/agents/${id}/training/sources`, { type: 'link', data: l });
      return { facts: (s.facts || []).length, faqs: (s.faqs || []).length, links: (s.links || []).length };
    },
    onSuccess: (c) => { setLearnedCounts(c); invalidateTraining(); toast('Your agent just learned your business', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not read that link — try your website address', 'warn'),
  });

  const { data: templates = [] } = useQuery<any[]>({ queryKey: ['/api/templates'] });
  const applyTemplate = useMutation({
    mutationFn: (templateId: string) => apiRequest('POST', `/api/agents/${id}/training/apply-template`, { templateId }),
    onSuccess: () => { invalidateTraining(); toast('Set up for your business type', 'good'); },
  });

  // ---- Step 3: go live (auto-reply choice + owner-alert number & condition) ----
  const [autoReply, setAutoReply] = React.useState<boolean>(!!agent.autoSend);
  const [alertOn, setAlertOn] = React.useState<boolean>(isWhatsapp);
  const [alertNum, setAlertNum] = React.useState<string>(agent.alertNumber || me?.phone || '');
  const [alertCond, setAlertCond] = React.useState<string>(agent.alertCondition || '');
  React.useEffect(() => { if (!alertNum && me?.phone) setAlertNum(me.phone); }, [me?.phone]);

  const goLive = useMutation({
    mutationFn: async () => {
      const body: any = { autoSend: autoReply };
      if (isWhatsapp) { body.alertNumber = alertOn ? alertNum.trim() : null; if (alertOn) body.alertCondition = alertCond.trim() || null; }
      await apiRequest('PATCH', `/api/agents/${id}`, body);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/agents/' + id] }); toast("You're all set — your agent is live 🎉", 'good'); onFinish(); },
    onError: (e: any) => toast(e.message || 'Could not finish setup', 'warn'),
  });

  const steps = [
    { n: 1, title: isWhatsapp ? 'Connect WhatsApp' : agent.channelType === 'website' ? 'Turn on your widget' : 'Connect your bot', done: connected, icon: Sparkles },
    { n: 2, title: 'Teach it your business', done: trained, icon: Zap },
    { n: 3, title: 'Go live', done: false, icon: HandMetal },
  ];

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight">Let’s get {agent.name} live</h1>
        <p className="mt-1 text-sm text-muted-foreground">Three quick steps. We’ll guide you — no setup knowledge needed.</p>
        <div className="mx-auto mt-3 flex max-w-[220px] items-center gap-1.5">
          {steps.map((s) => (
            <span key={s.n} className={cn('h-1.5 flex-1 rounded-full transition-colors', s.done ? 'bg-good' : step === s.n ? 'bg-primary' : 'bg-border')} />
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        {steps.map((s) => {
          const active = step === s.n;
          const Icon = s.icon;
          const clickable = s.done || s.n < step;
          return (
            <Card key={s.n} className={cn('overflow-hidden p-0 transition-colors', active ? 'border-primary/40' : 'border-border')}>
              <button
                type="button"
                onClick={() => clickable && setStep(s.n)}
                className={cn('flex w-full items-center gap-3 p-4 text-left', clickable ? 'cursor-pointer hover:bg-muted/30' : 'cursor-default')}
              >
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold',
                  s.done ? 'bg-good text-white' : active ? 'bg-primary text-white' : 'border border-border text-muted-foreground')}>
                  {s.done ? <Check size={16} /> : s.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium"><Icon size={14} className="text-muted-foreground" /> {s.title}</span>
                  {s.done && !active && <span className="text-xs text-good">Done</span>}
                </span>
              </button>

              {active && (
                <div className="space-y-3 border-t border-border p-4">
                  {s.n === 1 && <ConnectCard id={id} agent={agent} variant="connect" />}

                  {s.n === 2 && (
                    <div className="space-y-3">
                      {trained ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 rounded-lg border border-good/40 bg-good/10 p-3 text-sm text-good">
                            <Check size={16} />
                            {learnedCounts
                              ? `Learned ${learnedCounts.facts} facts & ${learnedCounts.faqs} answers from your site.`
                              : 'Your agent knows your business.'}
                          </div>
                          <p className="text-xs text-muted-foreground">You can review and fine-tune everything later under <span className="font-medium text-foreground">Train</span>.</p>
                          <Button onClick={() => setStep(3)}>Continue <ArrowRight size={15} /></Button>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm text-muted-foreground">Paste your website (or Google / Instagram) link — your agent reads it and learns your services, prices and answers for you.</p>
                          <div className="flex gap-2">
                            <Input className="flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="your-business.com" onKeyDown={(e) => e.key === 'Enter' && url && learnAndApply.mutate()} />
                            <Button className="shrink-0 whitespace-nowrap" disabled={!url || learnAndApply.isPending} onClick={() => learnAndApply.mutate()}>
                              {learnAndApply.isPending ? <><Loader2 size={15} className="animate-spin" /> Reading…</> : 'Read my site'}
                            </Button>
                          </div>
                          <div className="border-t border-border pt-2.5">
                            <p className="mb-2 text-xs text-muted-foreground">No website? Pick your business type:</p>
                            <div className="flex flex-wrap gap-1.5">
                              {templates.map((t) => (
                                <button key={t.id} disabled={applyTemplate.isPending} onClick={() => applyTemplate.mutate(t.id)}
                                  className="rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:border-primary disabled:opacity-50">
                                  {t.emoji} {t.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {s.n === 3 && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="text-sm font-medium">How should it reply?</div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <button type="button" onClick={() => setAutoReply(true)}
                            className={cn('rounded-lg border p-3 text-left transition-colors', autoReply ? 'border-primary bg-primary/10' : 'border-border hover:border-foreground/20')}>
                            <div className="flex items-center gap-1.5 text-sm font-medium"><Zap size={14} /> Reply automatically</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">Answers customers 24/7 on its own.</div>
                          </button>
                          <button type="button" onClick={() => setAutoReply(false)}
                            className={cn('rounded-lg border p-3 text-left transition-colors', !autoReply ? 'border-primary bg-primary/10' : 'border-border hover:border-foreground/20')}>
                            <div className="flex items-center gap-1.5 text-sm font-medium"><HandMetal size={14} /> Approve first</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">You OK each reply before it sends.</div>
                          </button>
                        </div>
                      </div>

                      {isWhatsapp && (
                        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                          <label className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-1.5 text-sm font-medium"><Siren size={14} className="text-primary" /> Alert me when a chat needs me</span>
                            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={alertOn} onChange={(e) => setAlertOn(e.target.checked)} />
                          </label>
                          <p className="text-xs text-muted-foreground">Your agent WhatsApps you when a conversation matches what you care about, so you can jump in.</p>
                          {alertOn && (
                            <div className="space-y-2">
                              <Textarea value={alertCond} onChange={(e) => setAlertCond(e.target.value)} placeholder={ALERT_CONDITION_PLACEHOLDER} className="min-h-[56px]" />
                              <p className="text-[11px] text-muted-foreground">In your own words — leave blank for the default (urgent, ready-to-buy customers).</p>
                              <Input value={alertNum} onChange={(e) => setAlertNum(e.target.value)} placeholder="Your WhatsApp number" inputMode="numeric" />
                            </div>
                          )}
                        </div>
                      )}

                      <Button className="w-full" disabled={goLive.isPending || (isWhatsapp && alertOn && !alertNum.trim())} onClick={() => goLive.mutate()}>
                        {goLive.isPending ? 'Finishing…' : 'Finish — go live'} <ArrowRight size={15} />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <button onClick={onSkip} className="mx-auto block text-xs text-muted-foreground underline-offset-2 hover:underline">Skip setup — I’ll do it myself</button>
    </div>
  );
}
