// SCN-07 — per-agent send mutex. The outbound drip shares the single whatsapp-web.js client per
// agent with live replies; this serializes all sends for one agent so sendMessage/sendMedia are
// never invoked concurrently. Replies stay event-driven and effectively take priority over the
// ~1-send/5-min drip (a reply acquires the lock between drip sends, which are minutes apart).
//
// In-process only (single replica today; the lease/leaseUntil columns exist for a future worker).

const chains = new Map<string, Promise<unknown>>();

export function withSendLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(agentId) ?? Promise.resolve();
  // Chain fn after whatever is already queued for this agent; swallow the predecessor's
  // result/error so one failed send never poisons the next.
  const next = prev.catch(() => undefined).then(fn);
  chains.set(agentId, next);
  // Clean up the map entry once this is the tail (avoid unbounded growth).
  void next.catch(() => undefined).finally(() => {
    if (chains.get(agentId) === next) chains.delete(agentId);
  });
  return next;
}
