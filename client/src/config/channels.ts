import { MessageCircle, Globe, Send, Instagram, Mail, type LucideIcon } from 'lucide-react';

// One place for every channel's identity — icon, copy, readiness, and its
// brand accent. Each agent is colored by its channel so the app reads as a
// set of distinct AI agents rather than a wall of identical rows.
export type ChannelMeta = {
  type: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  ready: boolean;
  badge: string; // icon chip: tint background + text color
  selected: string; // picker card when chosen: border + fill
};

export const CHANNELS: ChannelMeta[] = [
  {
    type: 'whatsapp-web', label: 'WhatsApp', icon: MessageCircle,
    blurb: 'Reply to WhatsApp customers', ready: true,
    badge: 'bg-emerald-500/15 text-emerald-400',
    selected: 'border-emerald-500/60 bg-emerald-500/10',
  },
  {
    type: 'website', label: 'Website', icon: Globe,
    blurb: 'A chat widget on your site', ready: true,
    badge: 'bg-violet-500/15 text-violet-400',
    selected: 'border-violet-500/60 bg-violet-500/10',
  },
  {
    type: 'telegram', label: 'Telegram', icon: Send,
    blurb: 'A Telegram bot', ready: true,
    badge: 'bg-sky-500/15 text-sky-400',
    selected: 'border-sky-500/60 bg-sky-500/10',
  },
  {
    type: 'instagram', label: 'Instagram', icon: Instagram,
    blurb: 'Answer Instagram DMs', ready: false,
    badge: 'bg-pink-500/15 text-pink-400',
    selected: 'border-pink-500/60 bg-pink-500/10',
  },
  {
    type: 'gmail', label: 'Email', icon: Mail,
    blurb: 'Auto-reply to enquiries', ready: false,
    badge: 'bg-amber-500/15 text-amber-400',
    selected: 'border-amber-500/60 bg-amber-500/10',
  },
];

export function channelMeta(type: string): ChannelMeta {
  return CHANNELS.find((c) => c.type === type) ?? { ...CHANNELS[0], type, label: type };
}
