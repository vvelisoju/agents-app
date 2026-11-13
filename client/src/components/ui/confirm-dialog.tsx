import * as React from 'react';
import { Button } from './button';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'destructive';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// A styled confirm modal — drop-in replacement for window.confirm that matches
// the app's surface (card + glass backdrop), with Esc/Enter + overlay dismissal.
export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  tone = 'default', busy, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (!open) { setShow(false); return; }
    const raf = requestAnimationFrame(() => setShow(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); };
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={cn('absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-150', show ? 'opacity-100' : 'opacity-0')}
        onClick={onCancel}
      />
      <div
        className={cn(
          'relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl shadow-black/50 transition-all duration-150',
          show ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
        )}
      >
        <div className="flex items-start gap-3">
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full',
            tone === 'destructive' ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-primary')}>
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            {message && <div className="mt-1.5 text-sm text-muted-foreground">{message}</div>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button size="sm" variant={tone === 'destructive' ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
