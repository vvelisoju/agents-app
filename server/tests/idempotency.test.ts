// PXD-34 — Idempotency-Key middleware: a repeated mutating request with the same key replays the
// first response instead of acting twice; without the key, behaviour is unchanged.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { idempotency, __resetIdempotency } from '../src/middleware/idempotency';

// A tiny app whose POST handler increments a counter, so we can prove it runs once per key.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', idempotency);
  let calls = 0;
  app.post('/api/do', (_req, res) => { calls++; res.json({ calls }); });
  app.get('/api/calls', (_req, res) => res.json({ calls }));
  return app;
}

beforeEach(() => __resetIdempotency());

describe('idempotency middleware', () => {
  it('runs the handler once and replays the stored response for a repeated key', async () => {
    const app = makeApp();
    const h = { Authorization: 'Bearer t', 'Idempotency-Key': 'abc' };

    const first = await request(app).post('/api/do').set(h);
    expect(first.status).toBe(200);
    expect(first.body.calls).toBe(1);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const second = await request(app).post('/api/do').set(h);
    expect(second.status).toBe(200);
    expect(second.body.calls).toBe(1); // NOT 2 — handler did not run again
    expect(second.headers['idempotent-replayed']).toBe('true');

    // The handler really only ran once.
    expect((await request(app).get('/api/calls')).body.calls).toBe(1);
  });

  it('a different key runs the handler again', async () => {
    const app = makeApp();
    await request(app).post('/api/do').set({ Authorization: 'Bearer t', 'Idempotency-Key': 'k1' });
    const other = await request(app).post('/api/do').set({ Authorization: 'Bearer t', 'Idempotency-Key': 'k2' });
    expect(other.body.calls).toBe(2);
  });

  it('is a no-op without the header (every request runs)', async () => {
    const app = makeApp();
    await request(app).post('/api/do');
    const again = await request(app).post('/api/do');
    expect(again.body.calls).toBe(2);
  });

  it('scopes keys by caller — same key, different token runs again', async () => {
    const app = makeApp();
    await request(app).post('/api/do').set({ Authorization: 'Bearer a', 'Idempotency-Key': 'same' });
    const other = await request(app).post('/api/do').set({ Authorization: 'Bearer b', 'Idempotency-Key': 'same' });
    expect(other.body.calls).toBe(2);
  });
});
