import { Bot, Inbox, Settings } from 'lucide-react';

// Data-driven nav (ClassPe pattern): sidebar on desktop, bottom tab bar on mobile.
// Items use `href` to match AppShell / wouter <Link>.
export const NAV = [
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/settings', label: 'Settings', icon: Settings },
];
