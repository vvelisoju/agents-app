// =============================================================
// shared/claude.js
// The "brain" every agent uses. One small helper that sends a
// prompt to Claude and returns the text reply.
// =============================================================
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n❌ ANTHROPIC_API_KEY is not set.');
  console.error('   Copy .env.example to .env and paste your key from https://console.anthropic.com/\n');
  process.exit(1);
}

// The SDK automatically reads ANTHROPIC_API_KEY from the environment (.env).
const client = new Anthropic();

/**
 * Ask Claude for a reply.
 *
 * @param {object}  opts
 * @param {string}  opts.system       - the agent's persona + rules (who it is, how to behave)
 * @param {string}  opts.prompt       - the conversation so far + what we want
 * @param {string}  [opts.model]      - model id (default: claude-opus-5-5)
 * @param {string}  [opts.effort]     - 'low' | 'medium' | 'high' (default: 'low' — fast + cheap)
 * @param {number}  [opts.maxTokens]  - max length of the reply (default: 1024)
 * @returns {Promise<string>}          - the reply text, or '' if Claude declined
 */
async function askClaude({ system, prompt, model = 'claude-opus-5-5', effort = 'low', maxTokens = 1024 }) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    output_config: { effort }, // 'low' keeps replies quick and inexpensive
    messages: [{ role: 'user', content: prompt }],
  });

  // If Claude's safety system declined, return empty so the caller can skip.
  if (response.stop_reason === 'refusal') return '';

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

module.exports = { askClaude };
