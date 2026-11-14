// Default-deny authorization policy engine (pure — no DB, no side effects).
//
// Phase-3 governance: a single source of truth for "who may do what" that both
// the reply path and the admin API can consult. The engine is intentionally
// data-driven (a static permission matrix) so new actions/roles are a one-line
// change and are trivially unit-testable. Anything not explicitly allowed is
// denied — unknown roles and unknown actions both fall through to `deny`.

/** Every governed action in the platform. Keep this union closed. */
export type Action =
  | 'send_reply'          // emit an outbound channel reply
  | 'approve'             // decide a pending Approval
  | 'train_edit'          // edit an agent's training / knowledge
  | 'agent_create'        // create a new agent
  | 'agent_delete'        // delete an agent (destructive)
  | 'org_admin'           // org-level settings / configuration
  | 'team_manage'         // invite / remove / re-role teammates
  | 'billing'             // billing, plans, payment methods
  | 'lead_export'         // bulk export of lead / contact PII
  | 'connected_accounts'  // manage OAuth / connected third-party accounts
  | 'audit_view';         // read the audit log

/** The three possible outcomes for a (role, action) pair. */
export type Decision = 'allow' | 'require_approval' | 'deny';

/** Roles recognised by the policy. Unknown roles are treated as default-deny. */
export type Role = 'owner' | 'member';

/** Per-action decision for each known role. */
export interface ActionPolicy {
  owner: Decision;
  member: Decision;
}

/**
 * Standard tier-2 SMB defaults.
 *
 * Owner: full control — `allow` for everything.
 * Member: day-to-day operational actions are allowed (reply, approve,
 *   edit training, create agents); everything privileged or destructive
 *   (delete, org admin, team, billing, PII export, connected accounts,
 *   audit) is denied.
 */
export const PERMISSION_MATRIX: Record<Action, ActionPolicy> = {
  send_reply:         { owner: 'allow', member: 'allow' },
  approve:            { owner: 'allow', member: 'allow' },
  train_edit:         { owner: 'allow', member: 'allow' },
  agent_create:       { owner: 'allow', member: 'allow' },
  agent_delete:       { owner: 'allow', member: 'deny' },
  org_admin:          { owner: 'allow', member: 'deny' },
  team_manage:        { owner: 'allow', member: 'deny' },
  billing:            { owner: 'allow', member: 'deny' },
  lead_export:        { owner: 'allow', member: 'deny' },
  connected_accounts: { owner: 'allow', member: 'deny' },
  audit_view:         { owner: 'allow', member: 'deny' },
};

/** Context required to make an authorization decision. */
export interface PolicyContext {
  /** The acting user's role. Typed loosely so callers can pass req.user.role. */
  role: string;
}

/** The result of an authorization check, with a human-readable reason. */
export interface AuthorizationResult {
  decision: Decision;
  reason: string;
}

/** Narrow an arbitrary string to a known Role, or null if unrecognised. */
function toRole(role: string): Role | null {
  return role === 'owner' || role === 'member' ? role : null;
}

/**
 * Authorize an action for the given context.
 *
 * Default-deny: an unknown action or an unknown role always yields `deny`.
 * Otherwise the decision is read straight from PERMISSION_MATRIX.
 */
export function authorize(ctx: PolicyContext, action: Action): AuthorizationResult {
  const policy = PERMISSION_MATRIX[action];
  if (!policy) {
    // Action is not in the matrix (e.g. a stale/forged value) — deny.
    return { decision: 'deny', reason: `unknown action: ${String(action)}` };
  }

  const role = toRole(ctx?.role);
  if (!role) {
    // Role is not recognised — deny regardless of the action.
    return { decision: 'deny', reason: `unknown role: ${String(ctx?.role)}` };
  }

  const decision = policy[role];
  return { decision, reason: `${role} ${decision} ${action}` };
}
