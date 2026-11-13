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
import { normalizeMobile, formatMobile } from '@/lib/auth';
import { MobileInput } from '@/components/layout/AuthLayout';
import { Moon, Sun, Globe, Trash2 } from 'lucide-react';

function PeopleCard() {
  const { toast } = useToast();
  const { data: team = [] } = useQuery<any[]>({ queryKey: ['/api/team'] });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/team'] });
  const [mobile, setMobile] = React.useState('');
  const [password, setPassword] = React.useState('');
  const add = useMutation({
    mutationFn: () => apiRequest('POST', '/api/team', { phone: normalizeMobile(mobile), password, role: 'member' }),
    onSuccess: () => { setMobile(''); setPassword(''); invalidate(); toast('Teammate added', 'good'); },
    onError: (e: any) => toast(e.status === 403 ? 'Only the owner can add teammates' : (e.message || 'Could not add'), 'warn'),
  });
  const remove = useMutation({ mutationFn: (uid: string) => apiRequest('DELETE', '/api/team/' + uid), onSuccess: invalidate, onError: (e: any) => toast(e.message || 'Could not remove', 'warn') });

  return (
    <Card className="space-y-3 p-4">
      <div className="font-medium">People</div>
      <div className="space-y-2">
        {team.map((u) => (
          <div key={u.id} className="flex items-center justify-between text-sm">
            <span>{formatMobile(u.phone)} <Badge>{u.role}</Badge></span>
            {u.role !== 'owner' && <button onClick={() => remove.mutate(u.id)} className="text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <MobileInput value={mobile} onChange={setMobile} />
        <div className="flex gap-2">
          <Input className="flex-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="temporary password" />
          <Button size="sm" variant="ghost" disabled={!mobile.trim() || !password.trim() || add.isPending} onClick={() => add.mutate()}>Add</Button>
        </div>
      </div>
    </Card>
  );
}

export function Settings() {
  const { account } = useAuth();
  const [theme, setTheme] = React.useState<Theme>(getTheme());
  const setT = (t: Theme) => { applyTheme(t); setTheme(t); };

  return (
    <div className="max-w-2xl space-y-4">
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

      <PeopleCard />

      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-2 font-medium"><Globe size={16} /> Language</div>
        <p className="text-sm text-muted-foreground">English. Hindi and Telugu are coming soon.</p>
      </Card>
    </div>
  );
}
