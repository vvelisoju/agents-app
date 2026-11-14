// =============================================================
// agents/_template/index.js
// A minimal, runnable starter agent: type a message in the
// terminal and Claude replies. Copy this folder and build on it.
//
// Run:  node agents/_template/index.js
// =============================================================
require('dotenv').config();
const readline = require('readline');
const { askClaude } = require('../../shared/claude');
const config = require('./config');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log('Template agent ready. Type a message (or "exit" to quit).\n');
  while (true) {
    const input = (await ask('You: ')).trim();
    if (!input || input.toLowerCase() === 'exit') break;

    const reply = await askClaude({
      system: config.systemPrompt,
      prompt: input,
      model: config.model,
    });
    console.log(`\nAgent: ${reply}\n`);
  }
  rl.close();
}

main();
