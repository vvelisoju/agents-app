import { Router, raw as rawBody } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { transcribeAudio } from '../../lib/transcribe';

const router = Router();

// Content-types the browser's MediaRecorder can produce (Opus in webm/ogg, AAC in mp4),
// plus a few common uploads. `octet-stream` is a fallback some browsers send. The raw parser
// matches on the base media type, so `audio/webm;codecs=opus` matches `audio/webm`.
const AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/flac',
  'application/octet-stream',
];

// POST /api/transcribe — proxy a short voice recording to the ASR service and return its text.
// Raw audio bytes in the body (route-level parser owns them; express.json skips non-JSON types).
// Optional ?language=<BCP-47> hint (omit to auto-detect). The upstream key stays server-side.
router.post(
  '/',
  rawBody({ type: AUDIO_TYPES, limit: '25mb' }),
  asyncHandler(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ error: 'No audio received. Hold the mic, speak, then stop.' });
    }
    const contentType = String(req.headers['content-type'] || 'audio/webm');
    const language = typeof req.query.language === 'string' && req.query.language.trim()
      ? req.query.language.trim()
      : undefined;
    try {
      const result = await transcribeAudio(buf, { contentType, language });
      if (!result.text) {
        return res.status(422).json({ error: 'Could not make out any speech. Try again, closer to the mic.' });
      }
      res.json(result);
    } catch (e: any) {
      const status = typeof e?.status === 'number' ? e.status : 502;
      res.status(status).json({ error: e?.message || 'Could not transcribe the audio.' });
    }
  }),
);

export default router;
