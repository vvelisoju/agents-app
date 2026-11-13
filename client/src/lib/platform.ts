// Native detection without a hard Capacitor import (Capacitor injects window.Capacitor
// in the native shell). Keeps the web build free of native deps until B0.3 adds them.
export function isNative(): boolean {
  try { return !!(window as any).Capacitor?.isNativePlatform?.(); } catch { return false; }
}
