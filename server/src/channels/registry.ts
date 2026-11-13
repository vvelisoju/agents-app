import { ChannelAdapter } from './types';

// Adapter registry. Each channel self-registers; the engine and routes look
// adapters up by type. Adding a channel = one register() call, no core changes.
const adapters = new Map<string, ChannelAdapter>();

export function register(a: ChannelAdapter) { adapters.set(a.type, a); }
export function getAdapter(type: string): ChannelAdapter | undefined { return adapters.get(type); }
export function listAdapters(): ChannelAdapter[] { return [...adapters.values()]; }
