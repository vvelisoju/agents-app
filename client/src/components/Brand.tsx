import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// The AI mark — a gradient "spark" orb. Used in the shell, login, loading.
export function Brand({ size = 28, glow = false, className }: { size?: number; glow?: boolean; className?: string }) {
  return (
    <span
      className={cn('relative grid shrink-0 place-items-center rounded-xl brand-gradient text-white', glow && 'glow', className)}
      style={{ width: size, height: size }}
    >
      <Sparkles size={Math.round(size * 0.52)} strokeWidth={2.2} />
    </span>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Brand size={size} />
      <span className="font-semibold tracking-tight brand-text">Secure Agents</span>
    </span>
  );
}
