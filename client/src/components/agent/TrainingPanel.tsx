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
import { Sparkles, Trash2, Plus } from 'lucide-react';

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
  const [draft, setDraft] = React.useState<any>(null);
  const [instructions, setInstructions] = React.useState('');
  const [restrictions, setRestrictions] = React.useState('');
  React.useEffect(() => {
    if (data?.profile) { setInstructions(data.profile.instructions || ''); setRestrictions(data.profile.restrictions || ''); }
  }, [data?.profile?.instructions, data?.profile?.restrictions]);

  const learn = useMutation({
    mutationFn: () => apiRequest('POST', `/api/agents/${id}/training/learn`, { url }),
    onSuccess: (r: any) => setDraft(r),
    onError: (e: any) => toast(e.message || 'Could not read that link', 'warn'),
  });

  const applyDraft = useMutation({
    mutationFn: async () => {
      const s = draft.suggestion;
      await apiRequest('PUT', `/api/agents/${id}/training/profile`, {
        instructions: s.instructions, tone: s.tone, language: s.language, restrictions: data?.profile?.restrictions || '',
      });
      for (const f of s.facts) await apiRequest('POST', `/api/agents/${id}/training/sources`, { type: 'fact', data: { content: f } });
      for (const q of s.faqs) await apiRequest('POST', `/api/agents/${id}/training/sources`, { type: 'faq', data: q });
      for (const l of s.links) await apiRequest('POST', `/api/agents/${id}/training/sources`, { type: 'link', data: l });
    },
    onSuccess: () => { setDraft(null); setUrl(''); invalidate(); toast('Added to your agent — it already knows this', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not save', 'destructive'),
  });

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

  return (
    <div className="space-y-4">
      {/* Quick setup by business type — one tap pre-fills the persona */}
      <Card className="space-y-2 p-4">
        <div className="font-medium">Quick setup by business type</div>
        <p className="text-sm text-muted-foreground">Pick the closest — it sets a good starting persona in one tap.</p>
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <button key={t.id} onClick={() => applyTemplate.mutate(t.id)} disabled={applyTemplate.isPending}
              className="rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary disabled:opacity-50">
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Train from a link — the default, no-typing path */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2"><Sparkles size={16} className="text-primary" /><span className="font-medium">Set up from a link</span></div>
        <p className="text-sm text-muted-foreground">Paste your website, Google, Instagram or Facebook link — the agent reads it for you.</p>
        <div className="flex gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="your-business.com" onKeyDown={(e) => e.key === 'Enter' && url && learn.mutate()} />
          <Button disabled={!url || learn.isPending} onClick={() => learn.mutate()}>{learn.isPending ? 'Reading…' : 'Read it'}</Button>
        </div>

        {draft && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{draft.suggestion.summary || 'Here’s what I found'}</p>
            {draft.suggestion.instructions && <p className="text-xs text-muted-foreground">{draft.suggestion.instructions}</p>}
            <div className="flex flex-wrap gap-1.5">
              {draft.suggestion.facts.map((f: string, i: number) => <Badge key={i}>{f}</Badge>)}
              {draft.suggestion.links.map((l: any, i: number) => <Badge key={'l' + i} variant="primary">{l.name}</Badge>)}
              {draft.suggestion.faqs.map((_: any, i: number) => <Badge key={'q' + i}>FAQ</Badge>)}
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" disabled={applyDraft.isPending} onClick={() => applyDraft.mutate()}>Add these to the agent</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
            </div>
          </div>
        )}
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

        <div className="space-y-2 pt-2">
          {(data?.sources || []).map((s: any) => (
            <div key={s.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 text-sm">
              <span className="flex items-center gap-2">
                <Badge variant={s.type === 'link' ? 'primary' : 'default'}>{s.type}</Badge>
                <span className="text-muted-foreground">{s.type === 'fact' ? s.data.content : s.type === 'link' ? `${s.data.name}: ${s.data.url}` : `${s.data.question}`}</span>
              </span>
              <button onClick={() => delSource.mutate(s.id)} className="text-muted-foreground hover:text-destructive"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Input value={fact} onChange={(e) => setFact(e.target.value)} placeholder="Add a fact, e.g. Open desk ₹3,999/mo" onKeyDown={(e) => { if (e.key === 'Enter' && fact.trim()) { addSource.mutate({ type: 'fact', data: { content: fact.trim() } }); setFact(''); } }} />
          <Button size="sm" variant="ghost" disabled={!fact.trim()} onClick={() => { addSource.mutate({ type: 'fact', data: { content: fact.trim() } }); setFact(''); }}><Plus size={15} /></Button>
        </div>
        <div className="flex gap-2">
          <Input className="w-1/3" value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="Link name" />
          <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
          <Button size="sm" variant="ghost" disabled={!linkName.trim() || !linkUrl.trim()} onClick={() => { addSource.mutate({ type: 'link', data: { name: linkName.trim(), url: linkUrl.trim() } }); setLinkName(''); setLinkUrl(''); }}><Plus size={15} /></Button>
        </div>
      </Card>
    </div>
  );
}
