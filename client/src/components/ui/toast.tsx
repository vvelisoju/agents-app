import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'good' | 'warn' | 'destructive';
interface Toast { id: number; msg: string; tone: Tone }

const ToastCtx = React.createContext<{ toast: (msg: string, tone?: Tone) => void }>({ toast: () => {} });
export const useToast = () => React.useContext(ToastCtx);

const toneClass: Record<Tone, string> = {
  default: 'border-border',
  good: 'border-good text-good',
  warn: 'border-warn text-warn',
  destructive: 'border-destructive text-destructive',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const toast = React.useCallback((msg: string, tone: Tone = 'default') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2 px-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {items.map((t) => (
          <div key={t.id} className={cn('rounded-lg border bg-card px-4 py-2.5 text-sm shadow-lg', toneClass[t.tone])}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
