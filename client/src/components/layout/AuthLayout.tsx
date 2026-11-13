import { Brand } from '@/components/Brand';
import { Link2, Clock, ShieldCheck, Sparkles } from 'lucide-react';

const FEATURES = [
  { icon: Link2, title: 'Trains from a link', body: 'Paste your website — your agent learns your business.' },
  { icon: Clock, title: 'Replies 24/7', body: 'WhatsApp, Instagram, web chat and more, always on.' },
  { icon: ShieldCheck, title: 'You stay in control', body: 'Approve replies, take over any chat, set your hours.' },
];

// Impressive split layout: a brand panel on the left (desktop), the form on the right.
export function AuthLayout({ title, subtitle, children }: { title: React.ReactNode; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh]">
      {/* Brand panel (desktop) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r border-border p-10 lg:flex xl:p-14">
        <div className="brand-gradient pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-20 blur-3xl" />
        <div className="brand-gradient pointer-events-none absolute -bottom-24 -left-16 h-80 w-80 rounded-full opacity-10 blur-3xl" />
        <div className="relative z-10 flex items-center gap-2.5">
          <Brand size={34} />
          <span className="text-lg font-semibold brand-text">Secure Agents</span>
        </div>
        <div className="relative z-10 max-w-md">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground">
            <Sparkles size={13} className="text-accent" /> AI customer replies for Indian businesses
          </div>
          <h2 className="text-3xl font-semibold leading-tight xl:text-4xl">AI agents that reply to your customers — on WhatsApp, 24/7.</h2>
          <ul className="mt-8 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><f.icon size={18} /></span>
                <span>
                  <span className="block text-sm font-medium">{f.title}</span>
                  <span className="block text-sm text-muted-foreground">{f.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative z-10 text-xs text-muted-foreground">WhatsApp-first · trains from a link · you stay in control</div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex flex-col items-center text-center lg:items-start lg:text-left">
            <Brand size={48} glow className="mb-4 lg:hidden" />
            <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

// A reusable +91 mobile input matching the form field surface.
export function MobileInput({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter?: () => void }) {
  return (
    <div className="flex items-center overflow-hidden rounded-md border border-input bg-muted/50 focus-within:ring-2 focus-within:ring-ring">
      <span className="border-r border-input py-2 pl-3 pr-2.5 text-sm text-muted-foreground">+91</span>
      <input
        className="min-h-tap flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
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
