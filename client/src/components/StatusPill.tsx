import { Badge } from '@/components/ui/badge';

const MAP: Record<string, { label: string; variant: 'default' | 'good' | 'warn' | 'primary' }> = {
  draft: { label: 'Not connected', variant: 'default' },
  pending_qr: { label: 'Scan QR', variant: 'warn' },
  connecting: { label: 'Connecting…', variant: 'warn' },
  connected: { label: 'Live', variant: 'good' },
  auth_failed: { label: 'Login failed', variant: 'warn' },
  disconnected: { label: 'Disconnected', variant: 'default' },
};

export function StatusPill({ status }: { status: string }) {
  const s = MAP[status] || { label: status, variant: 'default' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
