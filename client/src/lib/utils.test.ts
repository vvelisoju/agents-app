// QA-51 — first client unit tests: the display/formatting helpers used across the UI.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cn, displayContact, timeAgo } from './utils';

describe('cn', () => {
  it('merges classes and resolves Tailwind conflicts (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm', false && 'hidden', 'font-bold')).toBe('text-sm font-bold');
  });
});

describe('displayContact', () => {
  it('strips the whatsapp @c.us suffix and web: prefix', () => {
    expect(displayContact('919000000001@c.us')).toBe('919000000001');
    expect(displayContact('web:abc123')).toBe('abc123');
    expect(displayContact('')).toBe('');
  });
});

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());
  it('formats relative times compactly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    expect(timeAgo(new Date('2026-01-01T11:59:30Z').toISOString())).toBe('now'); // <60s
    expect(timeAgo(new Date('2026-01-01T11:30:00Z').toISOString())).toBe('30m');
    expect(timeAgo(new Date('2026-01-01T09:00:00Z').toISOString())).toBe('3h');
    expect(timeAgo(null)).toBe('');
    expect(timeAgo('not-a-date')).toBe('');
  });
});
