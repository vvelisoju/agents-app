// PXD-34 — Idempotency-Key middleware. A client that may retry a mutating request (flaky network,
// double-tap) sends a stable `Idempotency-Key` header; the first request runs normally and its
// response is remembered, and any later request with the same key replays that stored response
// instead of acting twice. No-op for safe methods and for requests without the header, so it never
// changes existing behaviour.
//
// Scope + store: keyed by (bearer token, method, path, key) and held in-process with a TTL. The
// server runs a single instance, so an in-memory store is sufficient and avoids a DB round-trip on
// the hot path; a horizontally-scaled deploy would move this to a shared store (documented).
import type { Request, Response, NextFunction } from 'express';

const TTL_MS = 24 * 60 * 60 * 1000; // a key is honoured for 24h
const MAX_ENTRIES = 5000;           // crude cap so the map can't grow unbounded
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Done { status: number; body: unknown; at: number }
// value is either an in-flight marker or the finished response
const store = new Map<string, Done | 'in-flight'>();

function sweep(now: number) {
  if (store.size < MAX_ENTRIES) return;
  for (const [k, v] of store) {
    if (v === 'in-flight') continue;
    if (now - v.at > TTL_MS) store.delete(k);
  }
  // If still over cap, drop oldest-inserted entries (Map preserves insertion order).
  while (store.size >= MAX_ENTRIES) {
    const first = store.keys().next().value;
    if (first === undefined) break;
    store.delete(first);
  }
}

/** Exposed for tests — clears the in-process store. */
export function __resetIdempotency() { store.clear(); }

export function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.header('Idempotency-Key');
  if (!key || !MUTATING.has(req.method)) return next();

  const auth = req.header('authorization') || 'anon';
  const id = `${auth}:${req.method}:${req.path}:${key.slice(0, 200)}`;
  const now = Date.now();
  const existing = store.get(id);

  if (existing === 'in-flight') {
    // A duplicate arrived while the first is still running — don't act twice.
    return res.status(409).json({ error: 'a request with this Idempotency-Key is still in progress', code: 'idempotency_conflict' });
  }
  if (existing) {
    if (now - existing.at <= TTL_MS) {
      res.setHeader('Idempotent-Replayed', 'true');
      return res.status(existing.status).json(existing.body);
    }
    store.delete(id); // expired — fall through and run fresh
  }

  sweep(now);
  store.set(id, 'in-flight');

  // Capture the response so a later retry can replay it. Only cache completed responses that are
  // not server errors (5xx stays retryable).
  const originalJson = res.json.bind(res);
  let settled = false;
  res.json = (body: unknown) => {
    if (!settled) {
      settled = true;
      if (res.statusCode < 500) store.set(id, { status: res.statusCode, body, at: Date.now() });
      else store.delete(id);
    }
    return originalJson(body);
  };
  // If the response ends without res.json (error path, aborted), release the in-flight marker so the
  // key isn't stuck forever.
  res.on('finish', () => { if (!settled) store.delete(id); });
  res.on('close', () => { if (!settled) store.delete(id); });

  next();
}
