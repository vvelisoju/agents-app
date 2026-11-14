// SCN-29 — one reusable notify path (adapter.send) shared by monitors and owner-alerts.
// Fire-and-forget with try/catch so a notify failure never breaks a workflow step.
import { getAdapter } from '../channels/registry';
import { log } from './log';

export async function notify(agentId: string, channelType: string, to: string, body: string): Promise<boolean> {
  try {
    const adapter = getAdapter(channelType);
    if (!adapter || !to) return false;
    await adapter.send(agentId, to, body);
    return true;
  } catch (e: any) {
    log.warn('notify failed', { agentId, error: String(e?.message || e) });
    return false;
  }
}
