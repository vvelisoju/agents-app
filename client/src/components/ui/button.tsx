import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none min-h-tap',
  {
    variants: {
      variant: {
        default: 'brand-gradient text-white shadow-sm shadow-primary/20 hover:opacity-95',
        ghost: 'border border-border bg-transparent text-foreground hover:bg-muted',
        subtle: 'bg-muted text-foreground hover:opacity-90',
        destructive: 'bg-destructive text-white hover:opacity-90',
      },
      size: {
        default: 'px-4 py-2',
        sm: 'px-3 py-1.5 text-xs min-h-0',
        lg: 'px-5 py-3 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';
