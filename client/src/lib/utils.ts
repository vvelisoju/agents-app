import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Merge Tailwind classes with conflict resolution (ClassPe's cn()).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// A WhatsApp contact id looks like "9199...@c.us"; a website one is "web:...".
export function displayContact(n: string): string {
  if (!n) return '';
  return n.replace(/^web:/, '').replace(/@c\.us$/, '');
}

// Compact relative time ("2m", "3h", "Tue").
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
