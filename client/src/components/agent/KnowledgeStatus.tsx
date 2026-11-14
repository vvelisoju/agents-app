import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Library, RefreshCw, FileText, Trash2 } from 'lucide-react';

type KnowledgeSource = { label: string; chunks: number; embedded: number };
type Knowledge = { chunks: number; embedded: number; sources?: KnowledgeSource[]; embeddings: { configured: boolean; provider: string | null; model: string | null } };

// Shows the RAG index for an agent (document chunks + whether they're vector-embedded), the list of
// uploaded documents with a remove action (MK-23/MK-19), and a re-index action to embed older
// documents after an embeddings key is added. Hidden when nothing is indexed.
export function KnowledgeStatus({ id }: { id: string }) {
  const { toast } = useToast();
  const key = ['/api/agents/' + id + '/knowledge'];
  const { data } = useQuery<Knowledge>({ queryKey: key });

  const reindex = useMutation({
    mutationFn: () => apiRequest('POST', `/api/agents/${id}/knowledge/reindex`, {}),
    onSuccess: (r: any) => { queryClient.invalidateQueries({ queryKey: key }); toast(`Re-indexed ${r.embedded} chunk(s).`, 'good'); },
    onError: (e: any) => toast(e.message || 'Could not re-index', 'warn'),
  });

  const remove = useMutation({
    mutationFn: (label: string) => apiRequest('DELETE', `/api/agents/${id}/knowledge/sources?label=${encodeURIComponent(label)}`),
    onSuccess: (r: any) => { queryClient.invalidateQueries({ queryKey: key }); toast(`Removed ${r.removed} chunk(s) from this document.`, 'good'); },
    onError: (e: any) => toast(e.message || 'Could not remove', 'warn'),
  });

  if (!data || data.chunks === 0) return null;

  const vector = data.embeddings.configured;
  const canReindex = vector && data.embedded < data.chunks;
  const sources = data.sources || [];

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
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

      {sources.length > 0 && (
        <ul className="space-y-1 border-t border-border pt-2">
          {sources.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <FileText size={12} className="shrink-0" />
                <span className="truncate text-foreground">{s.label}</span>
                <span className="shrink-0">· {s.chunks} chunk(s)</span>
              </span>
              <button
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                title="Remove this document from the agent's knowledge"
                disabled={remove.isPending}
                onClick={() => { if (window.confirm(`Remove "${s.label}" from this agent's knowledge? Its ${s.chunks} chunk(s) will stop being used in answers.`)) remove.mutate(s.label); }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
