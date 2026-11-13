import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check } from 'lucide-react';

export function Subscription() {
  const { toast } = useToast();
  const { data: sub } = useQuery<any>({ queryKey: ['/api/billing/subscription'] });
  const { data: plans = [] } = useQuery<any[]>({ queryKey: ['/api/billing/plans'] });
  const subscribe = useMutation({
    mutationFn: (planId: string) => apiRequest('POST', '/api/billing/subscribe', { planId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/billing/subscription'] }); toast('Plan updated', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not change plan', 'warn'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Subscription</h1>
          <p className="text-sm text-muted-foreground">Choose the plan that fits your business.</p>
        </div>
        {sub && <Badge variant="primary">{sub.plan} plan</Badge>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((p) => {
          const current = sub?.plan === p.id;
          return (
            <Card key={p.id} className={current ? 'border-primary p-4' : 'p-4'}>
              <div className="text-sm font-medium capitalize">{p.label}</div>
              <div className="mt-1 text-2xl font-semibold">{p.priceInr ? '₹' + p.priceInr : 'Free'}<span className="text-xs font-normal text-muted-foreground">{p.priceInr ? '/mo' : ''}</span></div>
              <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2"><Check size={14} className="text-good" /> Up to {p.maxAgents} agents</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-good" /> All channels & training</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-good" /> Leads & analytics</div>
              </div>
              <div className="mt-4">
                {current
                  ? <Button className="w-full" disabled>Current plan</Button>
                  : <Button variant="ghost" className="w-full" disabled={subscribe.isPending} onClick={() => subscribe.mutate(p.id)}>Choose {p.label}</Button>}
              </div>
            </Card>
          );
        })}
      </div>

      {sub && !sub.razorpayConfigured && <p className="text-xs text-muted-foreground">Payments run in test mode until Razorpay is connected — plan changes apply immediately for now.</p>}
    </div>
  );
}
