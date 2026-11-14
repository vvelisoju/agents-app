// Unit tests for the default-deny authorization policy (pure, offline, no DB).
import { describe, it, expect } from 'vitest';
import {
  authorize,
  PERMISSION_MATRIX,
  type Action,
} from '../src/policy/engine';

const ALL_ACTIONS = Object.keys(PERMISSION_MATRIX) as Action[];

describe('authorize — owner (full control)', () => {
  it('allows the owner to perform every known action', () => {
    for (const action of ALL_ACTIONS) {
      const result = authorize({ role: 'owner' }, action);
      expect(result.decision, `owner should allow ${action}`).toBe('allow');
    }
  });
});

describe('authorize — member (operational vs privileged)', () => {
  const allowed: Action[] = ['send_reply', 'approve', 'train_edit', 'agent_create'];
  const denied: Action[] = [
    'agent_delete',
    'org_admin',
    'team_manage',
    'billing',
    'lead_export',
    'connected_accounts',
    'audit_view',
  ];

  it('allows members the day-to-day operational actions', () => {
    for (const action of allowed) {
      expect(authorize({ role: 'member' }, action).decision, action).toBe('allow');
    }
  });

  it('denies members every privileged / destructive action', () => {
    for (const action of denied) {
      expect(authorize({ role: 'member' }, action).decision, action).toBe('deny');
    }
  });

  it('covers every action exactly once across allowed + denied', () => {
    expect([...allowed, ...denied].sort()).toEqual([...ALL_ACTIONS].sort());
  });
});

describe('authorize — default-deny fallbacks', () => {
  it('denies an unknown action', () => {
    const result = authorize({ role: 'owner' }, 'nope' as unknown as Action);
    expect(result.decision).toBe('deny');
    expect(result.reason).toMatch(/unknown action/);
  });

  it('denies an unknown role even for an allow-listed action', () => {
    const result = authorize({ role: 'superadmin' }, 'send_reply');
    expect(result.decision).toBe('deny');
    expect(result.reason).toMatch(/unknown role/);
  });

  it('denies when the role is empty / missing', () => {
    expect(authorize({ role: '' }, 'send_reply').decision).toBe('deny');
    expect(authorize({} as { role: string }, 'send_reply').decision).toBe('deny');
  });
});

describe('authorize — result shape', () => {
  it('returns a decision plus a human-readable reason', () => {
    const result = authorize({ role: 'member' }, 'billing');
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('reason');
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
