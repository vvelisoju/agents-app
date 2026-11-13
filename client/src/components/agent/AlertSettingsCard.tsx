import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Siren } from 'lucide-react';

// Short hint shown as the placeholder — the owner can describe ANY trigger.
export const ALERT_CONDITION_PLACEHOLDER =
  'e.g. someone wants to book or visit urgently, asks about bulk/large orders, mentions a complaint or refund, or a VIP/known client messages';

// Owner alerts: when a chat matches the owner's OWN condition, the agent WhatsApps
// them so they can jump in. Only meaningful for WhatsApp agents (delivered via the
// agent's own session). The trigger is free text — generic across businesses.
export function AlertSettingsCard({ id, agent, defaultPhone }: { id: string; agent: any; defaultPhone?: string }) {
  const { toast } = useToast();
  const key = ['/api/agents/' + id];
  const [on, setOn] = React.useState(!!agent.alertNumber);
  const [num, setNum] = React.useState<string>(agent.alertNumber || defaultPhone || '');
  const [cond, setCond] = React.useState<string>(agent.alertCondition || '');

  React.useEffect(() => {
    setOn(!!agent.alertNumber);
    setNum(agent.alertNumber || defaultPhone || '');
    setCond(agent.alertCondition || '');
  }, [agent.alertNumber, agent.alertCondition, defaultPhone]);

  const save = useMutation({
    mutationFn: (body: { alertNumber: string | null; alertCondition?: string | null }) => apiRequest('PATCH', `/api/agents/${id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: key }); toast('Alert settings saved', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not save', 'warn'),
  });

  const onToggle = (v: boolean) => { setOn(v); if (!v) save.mutate({ alertNumber: null }); };

  const numChanged = num.replace(/\D/g, '') !== (agent.alertNumber || '');
  const condChanged = cond.trim() !== (agent.alertCondition || '');
  const dirty = on && num.trim() && (numChanged || condChanged);
  const saveNow = () => save.mutate({ alertNumber: num.trim(), alertCondition: cond.trim() || null });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Siren size={18} className="text-primary" />
          <div>
            <div className="font-medium">Owner alerts</div>
            <div className="text-xs text-muted-foreground">
              {on && agent.alertNumber ? `Pinging you on +91 ${agent.alertNumber}` : 'Get a WhatsApp when a chat needs you'}
            </div>
          </div>
        </div>
        <Switch checked={on} onCheckedChange={onToggle} label="owner alerts" />
      </div>

      {on && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Alert me when…</div>
            <Textarea value={cond} onChange={(e) => setCond(e.target.value)} placeholder={ALERT_CONDITION_PLACEHOLDER} className="min-h-[64px]" />
            <p className="text-[11px] text-muted-foreground">Describe it in your own words — your agent decides when to ping you. Leave blank to use the default (urgent, ready-to-buy customers).</p>
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Send the alert to</div>
            <div className="flex gap-2">
              <Input value={num} onChange={(e) => setNum(e.target.value)} placeholder="Your WhatsApp number" inputMode="numeric" onKeyDown={(e) => e.key === 'Enter' && dirty && saveNow()} />
              <Button className="shrink-0" disabled={!dirty || save.isPending} onClick={saveNow}>Save</Button>
            </div>
            {!agent.alertNumber && <p className="text-[11px] text-muted-foreground">Tip: use a different number from the one you connected as the agent.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}
