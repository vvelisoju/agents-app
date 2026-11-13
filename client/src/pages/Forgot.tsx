import * as React from 'react';
import { Link, useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthLayout, MobileInput } from '@/components/layout/AuthLayout';
import { emailFromMobile, isValidMobile, formatMobile } from '@/lib/auth';

export function Forgot() {
  const { toast } = useToast();
  const { setSession } = useAuth();
  const [, navigate] = useLocation();
  const [step, setStep] = React.useState<'form' | 'reset'>('form');
  const [mobile, setMobile] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [password, setPassword] = React.useState('');

  const sendCode = useMutation({
    mutationFn: () => apiRequest('POST', '/api/auth/forgot', { email: emailFromMobile(mobile) }),
    onSuccess: (r: any) => {
      if (r?.devOtp) { setOtp(r.devOtp); toast('Dev code auto-filled', 'good'); } // dev only
      else toast('If that number has an account, a code was sent to WhatsApp', 'good');
      setStep('reset');
    },
    onError: (e: any) => toast(e.message || 'Could not send a code', 'warn'),
  });

  const reset = useMutation({
    mutationFn: () => apiRequest('POST', '/api/auth/reset', { email: emailFromMobile(mobile), otp, password }),
    onSuccess: (r: any) => { setSession(r.token, r.email); navigate('/agents'); }, // auto-login
    onError: (e: any) => {
      if (e.code === 'invalid_otp') toast('That code is wrong or expired', 'warn');
      else if (e.status === 404) toast('No account found with this number', 'warn');
      else toast(e.message || 'Could not reset password', 'destructive');
    },
  });

  function onSend() {
    if (!isValidMobile(mobile)) return toast('Enter your 10-digit mobile number', 'warn');
    sendCode.mutate();
  }
  function onReset() {
    if (otp.trim().length < 4) return toast('Enter the verification code', 'warn');
    if (password.length < 6) return toast('Use a password of at least 6 characters', 'warn');
    reset.mutate();
  }

  if (step === 'form') {
    return (
      <AuthLayout title={<>Reset your password</>} subtitle="Enter your mobile number to get a reset code.">
        <div className="space-y-4">
          <div>
            <Label>Mobile number</Label>
            <MobileInput value={mobile} onChange={setMobile} onEnter={onSend} />
          </div>
          <Button className="w-full" disabled={sendCode.isPending} onClick={onSend}>{sendCode.isPending ? 'Sending…' : 'Send reset code'}</Button>
          <p className="text-center text-sm text-muted-foreground">
            Remembered it? <Link href="/login"><a className="font-medium text-primary">Log in</a></Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={<>Set a new password</>} subtitle={`We sent a code to ${formatMobile(mobile)}.`}>
      <div className="space-y-4">
        <div>
          <Label>Verification code</Label>
          <Input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="● ● ● ● ● ●" className="text-center text-lg tracking-[0.5em]" />
        </div>
        <div>
          <Label>New password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="at least 6 characters" onKeyDown={(e) => e.key === 'Enter' && onReset()} />
        </div>
        <Button className="w-full" disabled={reset.isPending} onClick={onReset}>{reset.isPending ? 'Resetting…' : 'Reset password & log in'}</Button>
        <button className="mx-auto block text-sm text-muted-foreground hover:text-foreground" onClick={() => setStep('form')}>← Change number</button>
      </div>
    </AuthLayout>
  );
}
