import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Library, RefreshCw } from 'lucide-react';

type Knowledge = { chunks: number; embedded: number; embeddings: { configured: boolean; provider: string | null; model: string | null } };

// Shows the RAG index for an agent (document chunks + whether they're vector-embedded) and a
// re-index action to embed older documents after an embeddings key is added. Hidden when nothing
// is indexed, so it never adds noise to a fresh agent.
export function KnowledgeStatus({ id }: { id: string }) {
  const { toast } = useToast();
  const key = ['/api/agents/' + id + '/knowledge'];
  const { data } = useQuery<Knowledge>({ queryKey: key });

  const reindex = useMutation({
    mutationFn: () => apiRequest('POST', `/api/agents/${id}/knowledge/reindex`, {}),
    onSuccess: (r: any) => { queryClient.invalidateQueries({ queryKey: key }); toast(`Re-indexed ${r.embedded} chunk(s).`, 'good'); },
    onError: (e: any) => toast(e.message || 'Could not re-index', 'warn'),
  });

  if (!data || data.chunks === 0) return null;

  const vector = data.embeddings.configured;
  const canReindex = vector && data.embedded < data.chunks;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs">
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <Library size={14} className="shrink-0 text-primary" />
        <span>
          <b className="text-foreground">{data.chunks}</b> document chunk(s) indexed · search:{' '}
          {vector ? <span className="text-good">Vector ({data.embeddings.provider})</span> : <span>Keyword</span>}
          {vector && ` · ${data.embedded}/${data.chunks} embedded`}
        </span>
      </div>
      {canReindex && (
        <Button size="sm" variant="ghost" className="shrink-0" disabled={reindex.isPending} onClick={() => reindex.mutate()}>
          <RefreshCw size={13} /> {reindex.isPending ? 'Indexing…' : 'Embed all'}
        </Button>
      )}
    </div>
  );
}
