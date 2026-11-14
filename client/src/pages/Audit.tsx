import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { ShieldCheck, AlertCircle } from 'lucide-react';

// POL-16 — the audit trail (owner-only; GET /api/audit is audit_view-gated). Read-only view of
// who did what: approvals decided, agents changed, connectors added, logins/revocations, etc.
type AuditEvent = {
  id: string;
  actorType: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadataJson: string | null;
  createdAt: string;
};

// Friendly phrasing for the common action strings; unknown ones show the raw slug.
const ACTION_LABEL: Record<string, string> = {
  'approval.approved': 'Approved an action',
  'approval.rejected': 'Rejected an action',
  'org.rename': 'Renamed the workspace',
  'connected_account.revoke': 'Revoked a connected account',
  'connector.create': 'Added a connector',
  'connector.delete': 'Removed a connector',
  'job.replay': 'Replayed a failed job',
  'agent.delete': 'Deleted an agent',
};
const label = (a: string) => ACTION_LABEL[a] || a.replace(/[._]/g, ' ');
const fmt = (iso: string) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

export function Audit() {
  const { data, error, isLoading } = useQuery<{ events: AuditEvent[] }>({ queryKey: ['/api/audit'], retry: false });
  const forbidden = (error as any)?.status === 403;
  const events = data?.events || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><ShieldCheck size={20} /> Audit trail</h1>
        <p className="text-sm text-muted-foreground">A record of sensitive actions in your workspace. Read-only.</p>
      </div>

      {forbidden && (
        <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <AlertCircle size={16} /> Only the workspace owner can view the audit trail.
        </Card>
      )}

      {!forbidden && (
        <Card className="p-0">
          {isLoading && <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && events.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No audited actions yet.</p>}
          {events.length > 0 && (
            <div className="divide-y divide-border">
              {events.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{label(e.action)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {e.actorType === 'system' ? 'System' : e.actorType === 'agent' ? 'An agent' : 'A team member'}
                      {e.targetType ? ` · ${e.targetType}${e.targetId ? ` ${e.targetId.slice(0, 8)}` : ''}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-muted-foreground">{fmt(e.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
