// TOOL-10/20 — web.fetch_page reuses the SSRF-guarded snapshot (fetch → extract readable text),
// size-caps the result, and returns it as structured data. sideEffect='external' so it routes
// through approve-before-act. The returned text is UNTRUSTED — the agentic loop wraps it as a
// tool result, never concatenating it into the system prompt.
import { z } from 'zod';
import { registerTool } from '../registry';
import type { Tool } from '../types';
import { snapshot } from '../../lib/monitor';

const MAX_TEXT = 8_000;

export const webFetchPage: Tool = {
  name: 'web.fetch_page',
  description: 'Fetch and read the visible text of a public web page.',
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({ title: z.string(), text: z.string() }),
  sideEffect: 'external',
  approvalAction: 'web_fetch',
  idempotent: true,
  timeoutMs: 15_000,
  async execute(input) {
    const snap = await snapshot(input.url); // assertPublicUrl + per-hop SSRF re-check inside
    return { title: snap.title || '', text: snap.text.slice(0, MAX_TEXT) };
  },
};

registerTool(webFetchPage);
