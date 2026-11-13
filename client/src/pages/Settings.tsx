import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { getTheme, applyTheme, type Theme } from '@/lib/theme';
import { Moon, Sun, Globe, LogOut, Trash2 } from 'lucide-react';

function PlanCard() {
  const { toast } = useToast();
  const { data: sub } = useQuery<any>({ queryKey: ['/api/billing/subscription'] });
  const { data: plans = [] } = useQuery<any[]>({ queryKey: ['/api/billing/plans'] });
  const subscribe = useMutation({
    mutationFn: (planId: string) => apiRequest('POST', '/api/billing/subscribe', { planId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/billing/subscription'] }); toast('Plan updated', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not change plan', 'warn'),
  });
  if (!plans.length) return null;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="font-medium">Plan</div>
        {sub && <Badge variant="primary">{sub.plan}</Badge>}
      </div>
      <div className="space-y-2">
        {plans.map((p) => {
          const current = sub?.plan === p.id;
          return (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="text-sm font-medium capitalize">{p.label}</div>
                <div className="text-xs text-muted-foreground">{p.maxAgents} agents · {p.priceInr ? '₹' + p.priceInr + '/mo' : 'Free'}</div>
              </div>
              {current ? <Badge variant="good">Current</Badge>
                : <Button size="sm" variant="ghost" disabled={subscribe.isPending} onClick={() => subscribe.mutate(p.id)}>Choose</Button>}
            </div>
          );
        })}
      </div>
      {sub && !sub.razorpayConfigured && <p className="text-[11px] text-muted-foreground">Payments run in test mode until Razorpay is connected.</p>}
    </Card>
  );
}

function PeopleCard() {
  const { toast } = useToast();
  const { data: team = [] } = useQuery<any[]>({ queryKey: ['/api/team'] });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/team'] });
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const add = useMutation({
    mutationFn: () => apiRequest('POST', '/api/team', { email, password, role: 'member' }),
    onSuccess: () => { setEmail(''); setPassword(''); invalidate(); toast('Teammate added', 'good'); },
    onError: (e: any) => toast(e.status === 403 ? 'Only the owner can add teammates' : (e.message || 'Could not add'), 'warn'),
  });
  const remove = useMutation({ mutationFn: (uid: string) => apiRequest('DELETE', '/api/team/' + uid), onSuccess: invalidate, onError: (e: any) => toast(e.message || 'Could not remove', 'warn') });

  return (
    <Card className="space-y-3 p-4">
      <div className="font-medium">People</div>
      <div className="space-y-2">
        {team.map((u) => (
          <div key={u.id} className="flex items-center justify-between text-sm">
            <span>{u.email} <Badge>{u.role}</Badge></span>
            {u.role !== 'owner' && <button onClick={() => remove.mutate(u.id)} className="text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-[8rem] flex-1" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@email.com" />
        <Input className="min-w-[6rem] flex-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="temp password" />
        <Button size="sm" variant="ghost" disabled={!email.trim() || !password.trim() || add.isPending} onClick={() => add.mutate()}>Add</Button>
      </div>
    </Card>
  );
}

export function Settings() {
  const { account, logout } = useAuth();
  const [theme, setTheme] = React.useState<Theme>(getTheme());
  const setT = (t: Theme) => { applyTheme(t); setTheme(t); };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Signed in as</div>
        <div className="font-medium">{account}</div>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="font-medium">Appearance</div>
        <div className="flex gap-2">
          <Button variant={theme === 'dark' ? 'default' : 'ghost'} size="sm" onClick={() => setT('dark')}><Moon size={15} /> Dark</Button>
          <Button variant={theme === 'light' ? 'default' : 'ghost'} size="sm" onClick={() => setT('light')}><Sun size={15} /> Light</Button>
        </div>
      </Card>

      <PlanCard />
      <PeopleCard />

      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-2 font-medium"><Globe size={16} /> Language</div>
        <p className="text-sm text-muted-foreground">English. Hindi and Telugu are coming soon.</p>
      </Card>

      <Button variant="ghost" className="w-full" onClick={logout}><LogOut size={16} /> Log out</Button>
    </div>
  );
}
