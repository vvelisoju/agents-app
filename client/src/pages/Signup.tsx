import * as React from 'react';
import { Link } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthLayout, MobileInput } from '@/components/layout/AuthLayout';
import { normalizeMobile, isValidMobile, formatMobile } from '@/lib/auth';

export function Signup() {
  const { setSession } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = React.useState<'form' | 'otp'>('form');
  const [mobile, setMobile] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [otp, setOtp] = React.useState('');

  const start = useMutation({
    mutationFn: () => apiRequest('POST', '/api/auth/signup/start', { phone: normalizeMobile(mobile) }),
    onSuccess: (r: any) => {
      if (r?.devOtp) { setOtp(r.devOtp); toast('Dev code auto-filled', 'good'); }
      else toast(`Code sent to ${formatMobile(mobile)} on WhatsApp`, 'good');
      setStep('otp');
    },
    onError: (e: any) => {
      if (e.status === 409) toast('This number already has an account — log in instead', 'warn');
      else if (e.status === 429) toast('Too many codes requested. Try again in a bit.', 'warn');
      else toast(e.message || 'Could not send a code', 'destructive');
    },
  });

  const verify = useMutation({
    mutationFn: () => apiRequest('POST', '/api/auth/signup/verify', { phone: normalizeMobile(mobile), otp, password }),
    onSuccess: (r: any) => { setSession(r.token, r.phone); }, // authed flips → App swaps to the app
    onError: (e: any) => {
      if (e.code === 'invalid_otp' || e.status === 400) toast('That code is wrong or expired', 'warn');
      else toast(e.message || 'Could not create account', 'destructive');
    },
  });

  function onSend() {
    if (!isValidMobile(mobile)) return toast('Enter your 10-digit mobile number', 'warn');
    if (password.length < 6) return toast('Use a password of at least 6 characters', 'warn');
    start.mutate();
  }
  function onVerify() {
    if (otp.trim().length < 4) return toast('Enter the verification code', 'warn');
    verify.mutate();
  }

  if (step === 'form') {
    return (
      <AuthLayout title={<>Create your account</>} subtitle="Start with your mobile number.">
        <div className="space-y-3">
          <div>
            <Label>Mobile number</Label>
            <MobileInput value={mobile} onChange={setMobile} onEnter={onSend} />
          </div>
          <div>
            <Label>Create a password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="at least 6 characters" onKeyDown={(e) => e.key === 'Enter' && onSend()} />
          </div>
          <Button className="w-full" disabled={start.isPending} onClick={onSend}>{start.isPending ? 'Sending…' : 'Send verification code'}</Button>
          <p className="pt-1 text-center text-sm text-muted-foreground">
            Already have an account? <Link href="/login"><a className="font-medium text-primary">Log in</a></Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={<>Verify your number</>} subtitle={`We sent a code to ${formatMobile(mobile)} on WhatsApp.`}>
      <div className="space-y-3">
        <div>
          <Label>Verification code</Label>
          <Input
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            placeholder="● ● ● ● ● ●"
            className="text-center text-lg tracking-[0.5em]"
            onKeyDown={(e) => e.key === 'Enter' && onVerify()}
          />
        </div>
        <Button className="w-full" disabled={verify.isPending} onClick={onVerify}>{verify.isPending ? 'Creating…' : 'Verify & create account'}</Button>
        <div className="flex items-center justify-between text-sm">
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setStep('form')}>← Change number</button>
          <button className="text-primary disabled:opacity-50" disabled={start.isPending} onClick={() => start.mutate()}>Resend code</button>
        </div>
      </div>
    </AuthLayout>
  );
}
