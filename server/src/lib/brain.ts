// The shared Claude helper — now a thin wrapper over the provider-abstracted model
// gateway (lib/model-gateway.ts). Behaviour is byte-for-byte unchanged for callers:
// returns the reply text, '' on a refusal. The gateway adds timeout, bounded retry,
// and token/cost capture (MGW-1/2/3, FND-31).
import { callModel } from './model-gateway';

export async function askClaude(opts: {
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const res = await callModel({
    system: opts.system,
    prompt: opts.prompt,
    model: opts.model,
    maxTokens: opts.maxTokens,
  });
  return res.text;
}
