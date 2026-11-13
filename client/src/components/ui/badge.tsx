import * as React from 'react';
import { cn } from '@/lib/utils';

const tone: Record<string, string> = {
  default: 'border-border text-muted-foreground',
  good: 'border-good text-good',
  warn: 'border-warn text-warn',
  primary: 'border-primary text-primary',
};

export function Badge({ className, variant = 'default', ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof tone }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', tone[variant], className)}
      {...props}
    />
  );
}
