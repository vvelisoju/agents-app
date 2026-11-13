import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Trash2, Plus, X } from 'lucide-react';

// The heart: train-from-link (no typing) + optional manual enrichment.
export function TrainingPanel({ id }: { id: string }) {
  const { toast } = useToast();
  const key = ['/api/agents/' + id + '/training'];
  const { data } = useQuery<any>({ queryKey: key });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const { data: templates = [] } = useQuery<any[]>({ queryKey: ['/api/templates'] });
  const applyTemplate = useMutation({
    mutationFn: (templateId: string) => apiRequest('POST', `/api/agents/${id}/training/apply-template`, { templateId }),
    onSuccess: () => { invalidate(); toast('Set up for your business — tweak anything below', 'good'); },
  });

  const [url, setUrl] = React.useState('');
  // The reviewable draft: a local, editable copy of what the agent read, so the
  // owner can drop a wrong fact/FAQ or tweak the instructions BEFORE it goes live.
  const [review, setReview] = React.useState<any>(null);
  const [instructions, setInstructions] = React.useState('');
  const [restrictions, setRestrictions] = React.useState('');
  React.useEffect(() => {
    if (data?.profile) { setInstructions(data.profile.instructions || ''); setRestrictions(data.profile.restrictions || ''); }
  }, [data?.profile?.instructions, data?.profile?.restrictions]);

  const learn = useMutation({
    mutationFn: () => apiRequest('POST', `/api/agents/${id}/training/learn`, { url }),
    onSuccess: (r: any) => {
      const s = r?.suggestion || {};
      setReview({
        summary: s.summary || '',
        instructions: s.instructions || '',
        tone: s.tone,
        language: s.language,
        facts: [...(s.facts || [])],
        faqs: [...(s.faqs || [])],
        links: [...(s.links || [])],
      });
    },
    onError: (e: any) => toast(e.message || 'Could not read that link', 'warn'),
  });

  const applyDraft = useMutation({
    mutationFn: async () => {
      const s = review;
      await apiRequest('PUT', `/api/agents/${id}/training/profile`, {
        instructions: s.instructions, tone: s.tone, language: s.language, restrictions: data?.profile?.restrictions || '',
      });
      for (const f of s.facts) await apiRequest('POST', `/api/agents/${id}/training/sources`, { type: 'fact', data: { content: f } });
      for (const q of s.faqs) await apiRequest('POST', `/api/agents/${id}/training/sources`, { type: 'faq', data: q });
      for (const l of s.links) await apiRequest('POST', `/api/agents/${id}/training/sources`, { type: 'link', data: l });
    },
    onSuccess: () => { setReview(null); setUrl(''); invalidate(); toast('Added to your agent — it already knows this', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not save', 'destructive'),
  });

  const upd = (patch: any) => setReview((r: any) => ({ ...r, ...patch }));
  const dropAt = (keyName: 'facts' | 'faqs' | 'links', idx: number) =>
    setReview((r: any) => ({ ...r, [keyName]: r[keyName].filter((_: any, j: number) => j !== idx) }));

  const saveProfile = useMutation({
    mutationFn: () => apiRequest('PUT', `/api/agents/${id}/training/profile`, { instructions, restrictions, tone: data?.profile?.tone, language: data?.profile?.language }),
    onSuccess: () => { invalidate(); toast('Saved — applies to the next message', 'good'); },
  });

  const addSource = useMutation({
    mutationFn: (p: any) => apiRequest('POST', `/api/agents/${id}/training/sources`, p),
    onSuccess: invalidate,
  });
  const delSource = useMutation({
    mutationFn: (sid: string) => apiRequest('DELETE', `/api/agents/${id}/training/sources/${sid}`),
    onSuccess: invalidate,
  });

  const [fact, setFact] = React.useState('');
  const [linkName, setLinkName] = React.useState('');
  const [linkUrl, setLinkUrl] = React.useState('');
  const addFact = () => { if (fact.trim()) { addSource.mutate({ type: 'fact', data: { content: fact.trim() } }); setFact(''); } };
  const addLink = () => { if (linkName.trim() && linkUrl.trim()) { addSource.mutate({ type: 'link', data: { name: linkName.trim(), url: linkUrl.trim() } }); setLinkName(''); setLinkUrl(''); } };

  return (
    <div className="space-y-4">
      {/* Fastest path: paste a link, the agent reads it. */}
      <Card className="space-y-3 border-primary/30 p-4">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-primary" />
          <span className="font-medium">Set up from your website</span>
        </div>
        <p className="text-sm text-muted-foreground">Paste a link — website, Google, Instagram or Facebook — and the agent reads it for you. This is the quickest way to get started.</p>
        <div className="flex gap-2">
          <Input className="flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="your-business.com" onKeyDown={(e) => e.key === 'Enter' && url && learn.mutate()} />
          <Button className="shrink-0 whitespace-nowrap" disabled={!url || learn.isPending} onClick={() => learn.mutate()}>{learn.isPending ? 'Reading…' : 'Read & set up'}</Button>
        </div>

        {review && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            {review.summary && <p className="text-sm font-medium">{review.summary}</p>}

            <div>
              <Label className="text-xs text-muted-foreground">How it should reply</Label>
              <Textarea rows={3} value={review.instructions} onChange={(e) => upd({ instructions: e.target.value })} placeholder="How the agent should greet and help customers" />
            </div>

            {review.facts.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Facts &amp; prices ({review.facts.length})</Label>
                <div className="flex flex-wrap gap-1.5">
                  {review.facts.map((f: string, i: number) => (
                    <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs">
                      <span className="truncate">{f}</span>
                      <button aria-label="Remove fact" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => dropAt('facts', i)}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {review.faqs.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Questions it can answer ({review.faqs.length})</Label>
                <div className="space-y-1.5">
                  {review.faqs.map((q: any, i: number) => (
                    <div key={i} className="flex items-start justify-between gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
                      <span className="min-w-0">
                        <span className="font-medium">{q.question}</span>
                        {q.answer && <span className="mt-0.5 block text-muted-foreground">{q.answer}</span>}
                      </span>
                      <button aria-label="Remove question" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => dropAt('faqs', i)}><X size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {review.links.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Links</Label>
                <div className="flex flex-wrap gap-1.5">
                  {review.links.map((l: any, i: number) => (
                    <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                      <span className="truncate">{l.name}</span>
                      <button aria-label="Remove link" className="shrink-0 hover:text-destructive" onClick={() => dropAt('links', i)}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" disabled={applyDraft.isPending} onClick={() => applyDraft.mutate()}>{applyDraft.isPending ? 'Adding…' : 'Add these to the agent'}</Button>
              <Button size="sm" variant="ghost" onClick={() => setReview(null)}>Discard</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Remove anything that's off and tweak the instructions before adding — you can edit all of it later too.</p>
          </div>
        )}

        {/* No website? One-tap persona by business type. */}
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-sm text-muted-foreground">No link handy? Pick your business type instead:</p>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button key={t.id} onClick={() => {
                // Business-type setup is a STARTER for a blank agent — never wipe
                // instructions the owner already saved. Replace only when empty;
                // if they exist, confirm so an intentional switch is still possible.
                const hasInstr = !!((instructions || '').trim() || (data?.profile?.instructions || '').trim());
                if (hasInstr && !window.confirm(`You already have saved instructions. Replace them with the standard "${t.label}" setup?`)) return;
                applyTemplate.mutate(t.id);
              }} disabled={applyTemplate.isPending}
                className="rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary disabled:opacity-50">
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* What it knows + manual enrichment */}
      <Card className="space-y-3 p-4">
        <div className="font-medium">What your agent knows</div>
        <p className="text-sm text-muted-foreground">{data?.summary || '…'}</p>

        <div>
          <Label>Instructions</Label>
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Greet warmly, keep replies short, always offer a free tour." />
        </div>
        <div>
          <Label>Never do this</Label>
          <Textarea value={restrictions} onChange={(e) => setRestrictions(e.target.value)} placeholder="Never quote a final price. Never promise delivery dates." />
        </div>
        <Button size="sm" disabled={saveProfile.isPending} onClick={() => saveProfile.mutate()}>Save instructions</Button>

        {(data?.sources || []).length > 0 && (
          <div className="space-y-2 pt-2">
            {(data?.sources || []).map((s: any) => (
              <div key={s.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge variant={s.type === 'link' ? 'primary' : 'default'}>{s.type}</Badge>
                  <span className="truncate text-muted-foreground">{s.type === 'fact' ? s.data.content : s.type === 'link' ? `${s.data.name}: ${s.data.url}` : `${s.data.question}`}</span>
                </span>
                <button aria-label="Remove" onClick={() => delSource.mutate(s.id)} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <Label>Add a fact</Label>
          <div className="flex gap-2">
            <Input className="flex-1" value={fact} onChange={(e) => setFact(e.target.value)} placeholder="e.g. Open desk ₹3,999/mo" onKeyDown={(e) => e.key === 'Enter' && addFact()} />
            <Button size="sm" variant="ghost" className="shrink-0" disabled={!fact.trim()} onClick={addFact}><Plus size={15} /> Add</Button>
          </div>
          <Label>Add a shareable link</Label>
          <div className="flex flex-wrap gap-2">
            <Input className="w-full sm:w-1/3" value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="Link name, e.g. Pricing" />
            <Input className="min-w-0 flex-1" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" onKeyDown={(e) => e.key === 'Enter' && addLink()} />
            <Button size="sm" variant="ghost" className="shrink-0" disabled={!linkName.trim() || !linkUrl.trim()} onClick={addLink}><Plus size={15} /> Add</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
