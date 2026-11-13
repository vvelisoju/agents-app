import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Siren } from 'lucide-react';

// Urgent-lead alerts: when the agent spots a hot lead (someone in a hurry to get
// onboarded), it WhatsApps the owner at this number so they can jump in. Only
// meaningful for WhatsApp agents (the alert is delivered via the agent's session).
export function AlertSettingsCard({ id, agent, defaultPhone }: { id: string; agent: any; defaultPhone?: string }) {
  const { toast } = useToast();
  const key = ['/api/agents/' + id];
  const [on, setOn] = React.useState(!!agent.alertNumber);
  const [num, setNum] = React.useState<string>(agent.alertNumber || defaultPhone || '');

  React.useEffect(() => { setOn(!!agent.alertNumber); setNum(agent.alertNumber || defaultPhone || ''); }, [agent.alertNumber, defaultPhone]);

  const save = useMutation({
    mutationFn: (alertNumber: string | null) => apiRequest('PATCH', `/api/agents/${id}`, { alertNumber }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: key }); toast('Alert settings saved', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not save', 'warn'),
  });

  const onToggle = (v: boolean) => {
    setOn(v);
    if (!v) save.mutate(null); // turning off clears instantly
  };

  const dirty = on && num.trim() && num.replace(/\D/g, '') !== (agent.alertNumber || '');

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Siren size={18} className="text-primary" />
          <div>
            <div className="font-medium">Urgent-lead alerts</div>
            <div className="text-xs text-muted-foreground">
              {on && agent.alertNumber ? `Pinging you on +91 ${agent.alertNumber}` : 'Get a WhatsApp when a lead is in a hurry'}
            </div>
          </div>
        </div>
        <Switch checked={on} onCheckedChange={onToggle} label="urgent-lead alerts" />
      </div>

      {on && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            When someone clearly wants to get started <span className="font-medium text-foreground">right away</span>, your agent
            WhatsApps you here so you can jump in — once per lead, no spam.
          </p>
          <div className="flex gap-2">
            <Input
              value={num}
              onChange={(e) => setNum(e.target.value)}
              placeholder="Your WhatsApp number"
              inputMode="numeric"
              onKeyDown={(e) => e.key === 'Enter' && dirty && save.mutate(num.trim())}
            />
            <Button className="shrink-0" disabled={!dirty || save.isPending} onClick={() => save.mutate(num.trim())}>Save</Button>
          </div>
          {!agent.alertNumber && <p className="text-[11px] text-muted-foreground">Tip: use a different number from the one you connected as the agent.</p>}
        </div>
      )}
    </Card>
  );
}
