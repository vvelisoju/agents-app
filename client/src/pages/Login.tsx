import * as React from 'react';
import { Link } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthLayout, MobileInput } from '@/components/layout/AuthLayout';
import { emailFromMobile, isValidMobile } from '@/lib/auth';

export function Login() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [mobile, setMobile] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function go() {
    if (!isValidMobile(mobile)) return toast('Enter your 10-digit mobile number', 'warn');
    if (!password) return toast('Enter your password', 'warn');
    setBusy(true);
    try { await login(emailFromMobile(mobile), password); }
    catch (e: any) { toast(e.status === 401 ? 'Wrong mobile number or password' : (e.message || 'Login failed'), 'destructive'); }
    finally { setBusy(false); }
  }

  return (
    <AuthLayout title={<>Welcome back</>} subtitle="Log in to your AI agents.">
      <div className="space-y-3">
        <div>
          <Label>Mobile number</Label>
          <MobileInput value={mobile} onChange={setMobile} onEnter={go} />
        </div>
        <div>
          <Label>Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" onKeyDown={(e) => e.key === 'Enter' && go()} />
        </div>
        <Button className="w-full" disabled={busy} onClick={go}>Log in</Button>
        <p className="pt-1 text-center text-sm text-muted-foreground">
          New here? <Link href="/signup"><a className="font-medium text-primary">Create an account</a></Link>
        </p>
      </div>
    </AuthLayout>
  );
}
