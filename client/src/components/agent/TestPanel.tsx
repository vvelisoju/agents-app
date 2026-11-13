import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// "Ask your agent anything" — verify training by chatting, nothing is sent.
export function TestPanel({ id }: { id: string }) {
  const [message, setMessage] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const test = useMutation({
    mutationFn: () => apiRequest('POST', `/api/agents/${id}/test`, { message }),
    onSuccess: (r: any) => setDraft(r.draft || '(no reply)'),
    onError: (e: any) => setDraft('Error: ' + (e.message || 'failed')),
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="font-medium">Ask your agent anything</div>
      <p className="text-sm text-muted-foreground">See how it would reply to a customer. Nothing is sent.</p>
      <div className="flex gap-2">
        <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What are your prices?" onKeyDown={(e) => e.key === 'Enter' && message.trim() && test.mutate()} />
        <Button disabled={!message.trim() || test.isPending} onClick={() => test.mutate()}>{test.isPending ? 'Thinking…' : 'Test'}</Button>
      </div>
      {draft && <div className="whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-3 text-sm">{draft}</div>}
    </Card>
  );
}
