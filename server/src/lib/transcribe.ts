// Speech-to-text proxy to the Transcribe ASR service (transcribe.codevel.com).
// The upstream API key lives ONLY here (server-side env) — it is never shipped to the
// browser. Business/agent dictation is not patient data, so we classify as `standard`.
// Engine is faster-whisper (ffmpeg-backed), so it decodes the browser's Opus/webm/ogg/mp4
// recordings directly — no transcoding needed on our side.

const BASE = (process.env.TRANSCRIBE_API_URL || 'https://transcribe.codevel.com').replace(/\/+$/, '');
const KEY = process.env.TRANSCRIBE_API_KEY || '';
const MODEL = process.env.TRANSCRIBE_MODEL || 'auto';

// Map incoming recording content-types to a filename extension for the upstream form part.
const EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
};

export function transcribeConfigured(): boolean {
  return !!KEY;
}

export type TranscriptionResult = { text: string; language?: string; duration?: number };

class TranscribeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function transcribeAudio(
  buf: Buffer,
  opts: { contentType: string; language?: string },
): Promise<TranscriptionResult> {
  if (!KEY) throw new TranscribeError('Transcription is not configured on the server.', 503);

  const baseType = (opts.contentType || 'audio/webm').split(';')[0].trim().toLowerCase();
  const ext = EXT[baseType] || 'webm';

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)], { type: baseType }), `recording.${ext}`);
  form.append('model', MODEL);
  form.append('response_format', 'json');
  if (opts.language) form.append('language', opts.language);

  // ASR can take a few seconds; cap it so a hung upstream doesn't pin the request.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);

  let res: Response;
  try {
    res = await fetch(`${BASE}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { 'X-Api-Key': KEY, 'X-Classification': 'standard' },
      body: form,
      signal: ctrl.signal,
    });
  } catch {
    throw new TranscribeError('Could not reach the transcription service. Try again.', 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // A bad/expired key is a server-config problem, not the caller's — surface it as 503
    // so the client never mistakes it for an auth-session failure.
    if (res.status === 401 || res.status === 403) {
      throw new TranscribeError('Transcription service rejected the server API key.', 503);
    }
    let msg = `Transcription failed (${res.status}).`;
    try {
      const j: any = await res.json();
      msg = j?.detail || j?.error || j?.title || j?.message || msg;
    } catch {
      /* non-JSON error body */
    }
    const status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw new TranscribeError(msg, status === 413 ? 413 : status);
  }

  const data: any = await res.json().catch(() => ({}));
  return {
    text: String(data?.text || '').trim(),
    language: typeof data?.language === 'string' ? data.language : undefined,
    duration: typeof data?.duration === 'number' ? data.duration : undefined,
  };
}
