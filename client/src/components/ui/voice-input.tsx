import * as React from 'react';
import { Mic, Square, Loader2, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getToken } from '@/lib/api';
import { useToast } from '@/components/ui/toast';

// Reusable voice-to-text control: a mic button that records a short clip, posts it to the
// server's /api/transcribe proxy (the ASR key stays server-side), and hands the text back
// via onTranscript. Drop it next to any textarea/input. Self-contained — owns mic permission,
// recording state, an optional language picker, and all error toasts.

export type TranscribeLang = { code?: string; label: string };

// Telugu-first business (Warangal); auto-detect can confuse Telugu/Hindi, so we expose a picker.
export const TRANSCRIBE_LANGS: TranscribeLang[] = [
  { label: 'English', code: 'en-IN' },
  { label: 'తెలుగు', code: 'te-IN' },
  { label: 'हिन्दी', code: 'hi-IN' },
  { label: 'Auto-detect', code: undefined },
];

const LANG_STORE_KEY = 'sa_voice_lang';
const MAX_SECONDS = 120; // hard cap so a forgotten recording can't run forever

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* isTypeSupported can throw on some browsers */
    }
  }
  return '';
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Props = {
  onTranscript: (text: string) => void;
  /** Initial language code (BCP-47), or null/undefined for auto-detect. Default en-IN. */
  defaultLang?: string | null;
  /** Show the inline language picker. Default true. */
  showLanguage?: boolean;
  languages?: TranscribeLang[];
  disabled?: boolean;
  className?: string;
  title?: string;
};

export function VoiceInput({
  onTranscript,
  defaultLang = 'en-IN',
  showLanguage = true,
  languages = TRANSCRIBE_LANGS,
  disabled,
  className,
  title = 'Dictate with your voice',
}: Props) {
  const { toast } = useToast();
  const [state, setState] = React.useState<'idle' | 'recording' | 'working'>('idle');
  const [elapsed, setElapsed] = React.useState(0);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [lang, setLang] = React.useState<string | undefined>(() => {
    try {
      const saved = localStorage.getItem(LANG_STORE_KEY);
      if (saved === null) return defaultLang || undefined;
      return saved || undefined; // '' means auto-detect
    } catch {
      return defaultLang || undefined;
    }
  });

  const recRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const mimeRef = React.useRef<string>('');
  const timerRef = React.useRef<number | undefined>(undefined);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const supported =
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  };

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
  };

  // Stop + release everything on unmount.
  React.useEffect(() => {
    return () => {
      clearTimer();
      try {
        if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      } catch {
        /* ignore */
      }
      releaseMic();
    };
  }, []);

  // Close the language menu on outside click.
  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const upload = React.useCallback(async () => {
    const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
    chunksRef.current = [];
    releaseMic();
    if (!blob.size) {
      setState('idle');
      setElapsed(0);
      toast('No audio captured — try again.', 'warn');
      return;
    }
    try {
      const base = (import.meta as any).env?.VITE_API_URL || '';
      const qs = lang ? `?language=${encodeURIComponent(lang)}` : '';
      const contentType = (mimeRef.current || blob.type || 'audio/webm').split(';')[0] || 'audio/webm';
      const res = await fetch(`${base}/api/transcribe${qs}`, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
        },
        body: blob,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not transcribe that.');
      const text = String(body?.text || '').trim();
      if (text) onTranscript(text);
      else toast('Didn’t catch any speech — try again.', 'warn');
    } catch (e: any) {
      toast(e?.message || 'Could not transcribe that.', 'warn');
    } finally {
      setState('idle');
      setElapsed(0);
    }
  }, [lang, onTranscript, toast]);

  const stop = React.useCallback(() => {
    clearTimer();
    setState('working');
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop(); // fires onstop -> upload()
        return;
      } catch {
        /* fall through to manual upload */
      }
    }
    void upload();
  }, [upload]);

  const start = async () => {
    if (!supported) {
      toast('Voice input isn’t supported in this browser.', 'warn');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMimeType();
      mimeRef.current = mime || 'audio/webm';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => void upload();
      rec.start();
      recRef.current = rec;
      setElapsed(0);
      setState('recording');
      timerRef.current = window.setInterval(() => {
        setElapsed((s) => {
          const n = s + 1;
          if (n >= MAX_SECONDS) stop();
          return n;
        });
      }, 1000);
    } catch (e: any) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError' || e?.name === 'PermissionDeniedError';
      toast(
        denied
          ? 'Microphone blocked. Allow mic access in your browser, then try again.'
          : 'Could not start the microphone.',
        'warn',
      );
      releaseMic();
      setState('idle');
    }
  };

  const chooseLang = (code: string | undefined) => {
    setLang(code);
    try {
      localStorage.setItem(LANG_STORE_KEY, code || '');
    } catch {
      /* ignore */
    }
    setMenuOpen(false);
  };

  if (!supported) return null;

  const activeLabel = languages.find((l) => l.code === lang)?.label ?? 'Auto-detect';
  const busy = state === 'working';
  const recording = state === 'recording';

  return (
    <div ref={wrapRef} className={cn('inline-flex items-center gap-1', className)}>
      {showLanguage && state === 'idle' && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            disabled={disabled}
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            title="Dictation language"
            aria-label={`Dictation language: ${activeLabel}`}
          >
            {activeLabel}
            <ChevronDown size={11} className="opacity-70" />
          </button>
          {menuOpen && (
            <div className="absolute bottom-full right-0 z-30 mb-1 min-w-[132px] overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg">
              {languages.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  onClick={() => chooseLang(l.code)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                >
                  {l.label}
                  {l.code === lang && <Check size={13} className="text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {recording && (
        <span className="inline-flex items-center gap-1 tabular-nums text-[11px] font-medium text-red-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          {fmt(elapsed)}
        </span>
      )}

      <button
        type="button"
        onClick={recording ? stop : busy ? undefined : start}
        disabled={disabled || busy}
        title={recording ? 'Stop & transcribe' : busy ? 'Transcribing…' : title}
        aria-label={recording ? 'Stop recording and transcribe' : 'Start voice dictation'}
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors disabled:opacity-60',
          recording
            ? 'border-red-500/40 bg-red-500/15 text-red-500 hover:bg-red-500/25'
            : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : recording ? <Square size={14} className="fill-current" /> : <Mic size={15} />}
      </button>
    </div>
  );
}
