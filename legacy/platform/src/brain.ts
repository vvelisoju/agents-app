// =============================================================
// src/brain.ts — the shared Claude helper (ported from the
// prototype's shared/claude.js). Defaults to Haiku (cheapest).
// =============================================================
import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set (copy .env.example to .env and add your key).');
  }
  if (!client) client = new Anthropic();
  return client;
}

export async function askClaude(opts: {
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const { system, prompt, model = 'claude-haiku-5-5', maxTokens = 1024 } = opts;
  const res: any = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    // 'low' effort keeps short replies fast and cheap. Cast: output_config
    // may be newer than the installed SDK's static types.
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: prompt }],
  } as any);

  if (res.stop_reason === 'refusal') return '';
  return (res.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
}
