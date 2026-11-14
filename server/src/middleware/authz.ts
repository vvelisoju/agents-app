// POL-03 — authorization middleware. The single default-deny chokepoint for
// privileged routes, driven by the policy engine (policy/engine.ts). Previously RBAC
// was enforced ad hoc at ~5 routes; this generalizes it and records denials in the
// audit log.
import { Request, Response, NextFunction } from 'express';
import { authorize, Action } from '../policy/engine';
import { audit } from '../lib/audit';

export function requirePermission(action: Action) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user || {};
    const { decision } = authorize({ role: user.role || '' }, action);
    if (decision === 'allow') return next();
    audit({ orgId: user.orgId, actorUserId: user.id, action: `denied:${action}`, ip: req.ip });
    return res.status(403).json({ error: 'not permitted', code: 'forbidden' });
  };
}
