import { Brand } from '@/components/Brand';
import { Link2, Clock, ShieldCheck } from 'lucide-react';

const FEATURES = [
  { icon: Link2, text: 'Trains from a link' },
  { icon: Clock, text: 'Replies 24/7' },
  { icon: ShieldCheck, text: 'You stay in control' },
];

// Full-screen auth shell (login / signup). Centered is correct for auth only.
export function AuthLayout({ title, subtitle, children }: { title: React.ReactNode; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <Brand size={56} glow className="mb-4" />
          <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="glass rounded-xl border border-border p-4 shadow-xl">{children}</div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {FEATURES.map((f) => (
            <span key={f.text} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <f.icon size={14} className="text-accent" /> {f.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// A reusable +91 mobile input.
export function MobileInput({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter?: () => void }) {
  return (
    <div className="flex items-center rounded-md border border-input bg-background/60 focus-within:ring-2 focus-within:ring-ring">
      <span className="pl-3 pr-1 text-sm text-muted-foreground">+91</span>
      <input
        className="min-h-tap flex-1 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
        inputMode="numeric"
        maxLength={10}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        placeholder="98765 43210"
      />
    </div>
  );
}
