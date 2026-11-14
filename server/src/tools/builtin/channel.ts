// TOOL-07 — channel.send_message: let an agentic agent send a message on its own channel. It is
// sideEffect='external' with approvalAction='send_reply', so it routes through approve-before-act
// (nothing is sent until the owner approves) and goes out through the per-agent send mutex so it
// never collides with a live reply. Durable idempotency is the caller's in-execution dedupe plus
// the approval gate; a resend needs a fresh approval.
import { z } from 'zod';
import { registerTool } from '../registry';
import type { Tool } from '../types';
import { getAdapter } from '../../channels/registry';
import { withSendLock } from '../../lib/sendMutex';
import { toWhatsappChatId } from '../../lib/phone';

export const channelSendMessage: Tool = {
  name: 'channel.send_message',
  description: 'Send a WhatsApp/channel message to a contact. Requires approval before it is sent.',
  inputSchema: z.object({ to: z.string().min(3), message: z.string().min(1).max(4096) }),
  outputSchema: z.object({ sent: z.boolean() }),
  sideEffect: 'external',
  approvalAction: 'send_reply',
  timeoutMs: 20_000,
  async execute(input, ctx) {
    const channelType = ctx.agent?.channelType || 'whatsapp-web';
    const adapter = getAdapter(channelType);
    if (!adapter) return { sent: false };
    const to = channelType === 'whatsapp-web' ? toWhatsappChatId(input.to) || input.to : input.to;
    await withSendLock(ctx.agent.id, () => adapter.send(ctx.agent.id, to, input.message));
    return { sent: true };
  },
};

registerTool(channelSendMessage);
