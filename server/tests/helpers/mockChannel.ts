// QA-03 — an in-memory capturing channel adapter registered as type 'test'.
// Lets engine tests assert exactly what the agent would send without any network.
import { register } from '../../src/channels/registry';

export interface CapturedSend {
  agentId: string;
  to: string;
  text: string;
}

const captured: CapturedSend[] = [];

/** All sends captured since the last reset (newest last). */
export const sends = captured;

export function resetSends() {
  captured.length = 0;
}

// Self-register once on import. register() is a Map.set, so re-import is idempotent.
register({
  type: 'test',
  onboarding: 'none',
  send: async (agentId: string, to: string, text: string) => {
    captured.push({ agentId, to, text });
  },
});
