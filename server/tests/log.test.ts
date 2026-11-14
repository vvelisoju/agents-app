// OBS-1 — structured logger + redaction unit tests.
import { describe, it, expect } from 'vitest';
import { log, redact } from '../src/lib/log';

describe('redact() masks sensitive fields (OBS-1)', () => {
  it('masks the default sensitive keys and leaves others intact', () => {
    const out = redact({
      token: 'abc123',
      botToken: '987:XYZ',
      authorization: 'Bearer secret',
      password: 'hunter2',
      body: 'hello world',
      userId: 'u1',
      count: 42,
    });
    expect(out.token).toBe('[redacted]');
    expect(out.botToken).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(out.password).toBe('[redacted]');
    expect(out.body).toBe('[redacted]');
    // non-sensitive fields pass through untouched
    expect(out.userId).toBe('u1');
    expect(out.count).toBe(42);
  });

  it('is case-insensitive on key names', () => {
    const out = redact({ Token: 'x', AUTHORIZATION: 'y', Body: 'z' });
    expect(out.Token).toBe('[redacted]');
    expect(out.AUTHORIZATION).toBe('[redacted]');
    expect(out.Body).toBe('[redacted]');
  });

  it('honours an explicit key list', () => {
    const out = redact({ secret: 's', keep: 'k' }, ['secret']);
    expect(out.secret).toBe('[redacted]');
    expect(out.keep).toBe('k');
  });

  it('never throws on non-objects', () => {
    expect(redact(null as any)).toBeNull();
    expect(redact(undefined as any)).toBeUndefined();
    expect(redact('plain' as any)).toBe('plain');
    expect(redact(7 as any)).toBe(7);
  });

  it('does not mutate the original object', () => {
    const src = { token: 'abc', userId: 'u1' };
    redact(src);
    expect(src.token).toBe('abc'); // original untouched
  });
});

describe('log methods never throw (OBS-1)', () => {
  it('info/warn/error accept a message with or without fields', () => {
    expect(() => log.info('hello')).not.toThrow();
    expect(() => log.info('with fields', { token: 'abc', userId: 'u1' })).not.toThrow();
    expect(() => log.warn('careful', { body: 'payload' })).not.toThrow();
    expect(() => log.error('boom', { authorization: 'Bearer x' })).not.toThrow();
  });

  it('tolerates circular / odd field values without throwing', () => {
    const circular: any = {};
    circular.self = circular;
    expect(() => log.info('circular', circular)).not.toThrow();
  });
});
