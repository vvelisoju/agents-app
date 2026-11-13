import * as React from 'react';
import { Link } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthLayout, MobileInput } from '@/components/layout/AuthLayout';
import { emailFromMobile, isValidMobile, formatMobile } from '@/lib/auth';

export function Signup() {
  const { signup } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = React.useState<'form' | 'otp'>('form');
  const [mobile, setMobile] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  function sendCode() {
    if (!isValidMobile(mobile)) return toast('Enter your 10-digit mobile number', 'warn');
    if (password.length < 6) return toast('Use a password of at least 6 characters', 'warn');
    // Real WhatsApp/SMS OTP send is stubbed for now (coming later).
    setOtp('');
    setStep('otp');
  }

  async function verifyAndCreate() {
    if (otp.trim().length < 4) return toast('Enter the verification code', 'warn');
    setBusy(true);
    try {
      await signup(emailFromMobile(mobile), password); // creates account AND logs in (token set)
      // authed flips true → App swaps to the app automatically.
    } catch (e: any) {
      setBusy(false);
      if (e.status === 409) toast('This number already has an account — log in instead', 'warn');
      else toast(e.message || 'Could not create account', 'destructive');
    }
  }

  if (step === 'form') {
    return (
      <AuthLayout title={<>Create your account</>} subtitle="Start with your mobile number.">
        <div className="space-y-3">
          <div>
            <Label>Mobile number</Label>
            <MobileInput value={mobile} onChange={setMobile} onEnter={sendCode} />
          </div>
          <div>
            <Label>Create a password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="at least 6 characters" onKeyDown={(e) => e.key === 'Enter' && sendCode()} />
          </div>
          <Button className="w-full" onClick={sendCode}>Send verification code</Button>
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
            onKeyDown={(e) => e.key === 'Enter' && verifyAndCreate()}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">Verification is in test mode — enter any 4–6 digits for now (WhatsApp delivery comes later).</p>
        </div>
        <Button className="w-full" disabled={busy} onClick={verifyAndCreate}>{busy ? 'Creating…' : 'Verify & create account'}</Button>
        <div className="flex items-center justify-between text-sm">
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setStep('form')}>← Change number</button>
          <button className="text-primary" onClick={() => toast('Code resent', 'good')}>Resend code</button>
        </div>
      </div>
    </AuthLayout>
  );
}
