// Common shapes so the engine is 100% channel-agnostic (B3.1/B3.5).
// Every adapter normalises its channel to InboundMessage and provides send().

export interface InboundMessage {
  from: string;         // channel contact id (phone@c.us, widget contact id, …)
  contactName: string;
  text: string;
}

export interface ChannelAdapter {
  type: string;                                   // 'whatsapp-web' | 'website' | …
  onboarding: 'qr' | 'embed' | 'oauth' | 'none';
  // Optional lifecycle (WhatsApp needs it; a website widget does not).
  start?(agentId: string): Promise<void>;
  stop?(agentId: string): Promise<void>;
  // Deliver an outbound reply. Sync channels (website) may no-op and let the
  // client poll; async channels (WhatsApp) actually send.
  send(agentId: string, to: string, text: string): Promise<void>;
}
