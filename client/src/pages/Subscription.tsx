import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { loadRazorpay } from '@/lib/razorpay';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check } from 'lucide-react';

export function Subscription() {
  const { toast } = useToast();
  const { data: sub } = useQuery<any>({ queryKey: ['/api/billing/subscription'] });
  const { data: plans = [] } = useQuery<any[]>({ queryKey: ['/api/billing/plans'] });
  const [busy, setBusy] = React.useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['/api/billing/subscription'] });

  // Dev / free fallback: apply immediately (works until Razorpay keys are live in prod).
  const devSubscribe = useMutation({
    mutationFn: (planId: string) => apiRequest('POST', '/api/billing/subscribe', { planId }),
    onSuccess: () => { refresh(); toast('Plan updated', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not change plan', 'warn'),
  });

  async function choose(plan: any) {
    const paid = !!plan.priceInr;
    // Free plan, or Razorpay not configured → immediate apply.
    if (!paid || !sub?.razorpayConfigured) { devSubscribe.mutate(plan.id); return; }

    setBusy(plan.id);
    try {
      const ok = await loadRazorpay();
      if (!ok) throw new Error("Couldn't load the payment window — check your connection.");
      const order = await apiRequest('POST', '/api/billing/checkout', { planId: plan.id });
      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Secure Agents',
        description: `${plan.label} plan`,
        theme: { color: '#8b5cf6' },
        handler: async (resp: any) => {
          try {
            const updated = await apiRequest('POST', '/api/billing/verify', {
              orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature, planId: plan.id,
            });
            refresh();
            toast(`Upgraded to ${updated.plan} plan`, 'good');
          } catch (e: any) {
            toast(e.code === 'invalid_signature' ? 'Payment could not be verified' : (e.message || 'Could not confirm payment'), 'destructive');
          }
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.open();
    } catch (e: any) {
      toast(e.code === 'billing_unconfigured' ? 'Billing is not set up yet' : (e.message || 'Could not start checkout'), 'warn');
    } finally {
      setBusy(null);
    }
  }

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
          const paid = !!p.priceInr;
          const label = current ? 'Current plan' : paid ? (sub?.razorpayConfigured ? 'Upgrade' : 'Choose') : 'Choose Free';
          return (
            <Card key={p.id} className={current ? 'border-primary p-4' : 'p-4'}>
              <div className="text-sm font-medium capitalize">{p.label}</div>
              <div className="mt-1 text-2xl font-semibold">{paid ? '₹' + p.priceInr : 'Free'}<span className="text-xs font-normal text-muted-foreground">{paid ? '/mo' : ''}</span></div>
              <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2"><Check size={14} className="text-good" /> Up to {p.maxAgents} agents</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-good" /> All channels & training</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-good" /> Leads & analytics</div>
              </div>
              <div className="mt-4">
                <Button
                  variant={current ? 'default' : 'ghost'}
                  className="w-full"
                  disabled={current || busy === p.id || devSubscribe.isPending}
                  onClick={() => choose(p)}
                >
                  {busy === p.id ? 'Opening…' : label}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {sub && !sub.razorpayConfigured && <p className="text-xs text-muted-foreground">Payments run in test mode until Razorpay is connected — plan changes apply immediately for now.</p>}
    </div>
  );
}
