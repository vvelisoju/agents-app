// EWS-08 — in-process handler registry, mirroring channels/registry.ts. Feature modules
// (outbound-drip, scheduled-monitor, approval-gated-send) self-register their handler on
// import; the spine owns no business handlers. getWorkflow(unknown) → undefined, and the
// runner dead-letters the job rather than crashing.
import type { WorkflowHandler } from './types';

const handlers = new Map<string, WorkflowHandler>();

export function registerWorkflow(name: string, handler: WorkflowHandler): void {
  if (handlers.has(name)) throw new Error(`workflow handler already registered: ${name}`);
  handlers.set(name, handler);
}

export function getWorkflow(name: string): WorkflowHandler | undefined {
  return handlers.get(name);
}

export function listWorkflows(): string[] {
  return [...handlers.keys()];
}

// Test-only: allow a test to replace/clear a handler without the duplicate guard.
export function __setWorkflow(name: string, handler: WorkflowHandler | null): void {
  if (handler) handlers.set(name, handler);
  else handlers.delete(name);
}
