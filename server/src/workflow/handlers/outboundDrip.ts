// SCN-09/12/18 — outbound drip handler on the spine. Sends at most one message per tick, then
// sleeps a randomized gap, so ~N recipients spread across the send window at ~1-per-few-minutes.
// Every gate is enforced per send: send window, warmup-ramped daily cap (counted from the
// ledger so it survives restarts), per-tenant budget, opt-out suppression, and ledger
// idempotency (a recipient is sent at most once). Gated by OUTBOUND_ENABLED. The recipient list
// + promo live in the run's durable state (set at approved campaign start); the cursor advances
// via ctx.setState so progress is crash-safe.
import prisma from '../../lib/prisma';
import { registerWorkflow } from '../registry';
import { Step, type WorkflowHandler } from '../types';
import { outboundEnabled } from '../../lib/spineEnv';
import { canSpend } from '../../lib/budget';
import { isSuppressed } from '../../lib/optout';
import { withSendLock } from '../../lib/sendMutex';
import { getAdapter } from '../../channels/registry';
import { toWhatsappChatId } from '../../lib/phone';
import { inWindow, nextWindowOpen, effectiveCap, localMidnight, randomGapMs, maskPhone, OPT_OUT_FOOTER } from '../../lib/outbound';

export const DRIP_HANDLER = 'outbound-drip';

interface Recipient { phone: string; name?: string }

const handler: WorkflowHandler = async (ctx) => {
  if (!outboundEnabled()) return Step.complete({ skipped: 'outbound_disabled' });

  const connectionId = ctx.state.connectionId as string | undefined;
  const campaignId = (ctx.state.campaignId as string) || '';
  const promo = (ctx.state.promo as string) || '';
  const recipients = (ctx.state.recipients as Recipient[]) || [];
  let cursor = (ctx.state.cursor as number) || 0;

  const conn = connectionId ? await prisma.outboundConnection.findFirst({ where: { id: connectionId, orgId: ctx.orgId } }) : null;
  if (!conn || !conn.active) return Step.complete({ skipped: 'connection_inactive' });
  const agentId = conn.agentId;

  // Send window — outside it, park until it next opens.
  if (!inWindow(conn)) return Step.sleep(nextWindowOpen(conn), 'outside send window');

  // Warmup-ramped daily cap, counted from the ledger since local midnight (restart-safe).
  const dayIndex = Math.floor((localMidnight().getTime() - localMidnight('Asia/Kolkata', conn.createdAt).getTime()) / 86_400_000);
  const cap = effectiveCap(conn, dayIndex);
  const sentToday = await prisma.outboundSendLog.count({
    where: { connectionId: conn.id, createdAt: { gte: localMidnight() }, status: { in: ['sent', 'delivered', 'read'] } },
  });
  if (sentToday >= cap) return Step.sleep(nextWindowOpen(conn, 'Asia/Kolkata', new Date(Date.now() + 86_400_000)), `daily cap reached (${cap})`);

  // Per-tenant budget cap (SCN-12) — bounds runaway volume/cost.
  const spend = await canSpend(conn.orgId);
  if (!spend.allowed) return Step.sleep(nextWindowOpen(conn, 'Asia/Kolkata', new Date(Date.now() + 86_400_000)), 'budget cap reached');

  // Send through the agent's own channel adapter (whatsapp-web in prod; the capturing 'test'
  // adapter in tests).
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  const sendAdapter = getAdapter(agent?.channelType || 'whatsapp-web');

  // Find the next sendable recipient (skip opted-out + already-sent).
  while (cursor < recipients.length) {
    const r = recipients[cursor];
    cursor++;
    if (!r?.phone) continue;
    if (await isSuppressed(agentId, r.phone)) continue;
    const already = await prisma.outboundSendLog.findUnique({
      where: { connectionId_campaignId_recipient: { connectionId: conn.id, campaignId, recipient: r.phone } },
    });
    if (already) continue;

    const chatId = toWhatsappChatId(r.phone) || r.phone;
    const body = `${promo}\n\n${OPT_OUT_FOOTER}`;
    try {
      if (sendAdapter) await withSendLock(agentId, () => sendAdapter.send(agentId, chatId, body));
    } catch (e: any) {
      // Record the failure in the ledger (so it isn't retried forever) and move on next tick.
      await prisma.outboundSendLog.create({ data: { orgId: conn.orgId, connectionId: conn.id, campaignId, recipient: r.phone, status: 'failed' } }).catch(() => {});
      ctx.setState({ cursor });
      return Step.sleep(new Date(Date.now() + randomGapMs(conn.minGapSec, conn.maxGapSec)), `send failed: ${String(e?.message || e)}`);
    }

    // Ledger write — the unique (connection,campaign,recipient) makes this exactly-once.
    await prisma.outboundSendLog.create({ data: { orgId: conn.orgId, connectionId: conn.id, campaignId, recipient: r.phone, status: 'sent' } }).catch(() => {});
    ctx.setState({ cursor });
    ctx.log(`sent to ${maskPhone(r.phone)}`);
    await ctx.emit('outbound.sent', { campaignId, recipient: maskPhone(r.phone) });
    return Step.sleep(new Date(Date.now() + randomGapMs(conn.minGapSec, conn.maxGapSec)), 'next send after jitter');
  }

  return Step.complete({ sent: 'campaign_done', total: recipients.length });
};

registerWorkflow(DRIP_HANDLER, handler);
