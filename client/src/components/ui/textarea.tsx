import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow to fit content (up to max-height, then scroll) instead of a fixed height. */
  autoResize?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoResize, value, onChange, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const setRefs = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    };
    const resize = React.useCallback(() => {
      const el = innerRef.current;
      if (!el || !autoResize) return;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }, [autoResize]);
    // Re-fit on value changes (incl. programmatic ones) and on mount.
    React.useLayoutEffect(() => { resize(); }, [resize, value]);

    return (
      <textarea
        ref={setRefs}
        value={value}
        onChange={(e) => { onChange?.(e); resize(); }}
        className={cn(
          'flex w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm min-h-[72px]',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          autoResize && 'resize-none overflow-y-auto max-h-[70vh]',
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
