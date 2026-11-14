import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CalendarCheck, Clock, X } from 'lucide-react';

type Booking = { id: string; contactNumber: string; contactName: string | null; startAt: string; endAt: string; status: string; note: string | null };

// SCN-24 — bookings view: upcoming + past, cancel in one tap. Outcome-named, not a form.
export function BookingsPanel({ id }: { id: string }) {
  const { toast } = useToast();
  const key = ['/api/agents/' + id + '/bookings'];
  const { data } = useQuery<{ upcoming: Booking[]; past: Booking[] }>({ queryKey: key });
  const [cancelId, setCancelId] = React.useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: (bookingId: string) => apiRequest('POST', `/api/agents/${id}/bookings/${bookingId}/cancel`),
    onSuccess: () => { setCancelId(null); queryClient.invalidateQueries({ queryKey: key }); toast('Booking cancelled.', 'good'); },
    onError: (e: any) => { setCancelId(null); toast(e.message || 'Could not cancel', 'warn'); },
  });

  const upcoming = data?.upcoming || [];
  const past = data?.past || [];

  const Row = ({ b, canCancel }: { b: Booking; canCancel: boolean }) => (
    <Card className={cn('flex items-center justify-between gap-3 p-3.5', b.status === 'cancelled' && 'opacity-60')}>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{b.contactName || b.contactNumber}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock size={11} /> {fmt(b.startAt)}</div>
        {b.note && <div className="mt-1 truncate text-xs text-muted-foreground">{b.note}</div>}
      </div>
      {b.status === 'cancelled' ? (
        <span className="shrink-0 text-xs text-muted-foreground">Cancelled</span>
      ) : canCancel ? (
        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setCancelId(b.id)}><X size={13} /> Cancel</Button>
      ) : null}
    </Card>
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><CalendarCheck size={16} className="text-primary" /> Upcoming</div>
        {upcoming.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">No upcoming bookings. When your agent books an appointment (after your approval), it shows here.</Card>
        ) : (
          <div className="space-y-2">{upcoming.map((b) => <Row key={b.id} b={b} canCancel />)}</div>
        )}
      </div>

      {past.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold text-muted-foreground">Past & cancelled</div>
          <div className="space-y-2">{past.map((b) => <Row key={b.id} b={b} canCancel={false} />)}</div>
        </div>
      )}

      <ConfirmDialog
        open={cancelId !== null}
        title="Cancel this booking?"
        message="The slot will be freed up. The customer is not notified automatically."
        confirmLabel="Cancel booking"
        tone="destructive"
        busy={cancel.isPending}
        onConfirm={() => cancelId && cancel.mutate(cancelId)}
        onCancel={() => setCancelId(null)}
      />
    </div>
  );
}

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}
