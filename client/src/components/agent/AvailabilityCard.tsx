import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const hourLabel = (h: number) => `${(h % 12) || 12}${h < 12 ? 'am' : 'pm'}`;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Per-agent business hours + after-hours message (PATCH /agents/:id).
export function AvailabilityCard({ id, agent }: { id: string; agent: any }) {
  const { toast } = useToast();
  const key = ['/api/agents/' + id];
  const [limited, setLimited] = React.useState(agent.hoursStart != null);
  const [start, setStart] = React.useState<number>(agent.hoursStart ?? 9);
  const [end, setEnd] = React.useState<number>(agent.hoursEnd ?? 20);
  const [away, setAway] = React.useState<string>(agent.awayMessage ?? '');

  const save = useMutation({
    mutationFn: () => apiRequest('PATCH', `/api/agents/${id}`, limited
      ? { hoursStart: start, hoursEnd: end, awayMessage: away.trim() || null }
      : { hoursStart: null, hoursEnd: null, awayMessage: null }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: key }); toast('Availability saved', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not save', 'warn'),
  });

  const sel = 'rounded-md border border-input bg-background/60 px-2 py-1.5 text-sm';

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">Availability</div>
          <div className="text-xs text-muted-foreground">{limited ? `Replies ${hourLabel(start)}–${hourLabel(end)}` : 'Replies 24/7'}</div>
        </div>
        <Switch checked={limited} onCheckedChange={setLimited} label="business hours" />
      </div>
      {limited && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">From</span>
            <select className={sel} value={start} onChange={(e) => setStart(Number(e.target.value))}>{HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
            <span className="text-muted-foreground">to</span>
            <select className={sel} value={end} onChange={(e) => setEnd(Number(e.target.value))}>{HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
          </div>
          <Textarea value={away} onChange={(e) => setAway(e.target.value)} placeholder="After-hours reply, e.g. We're closed now — we'll get back to you in the morning." />
        </>
      )}
      <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save availability</Button>
    </Card>
  );
}
