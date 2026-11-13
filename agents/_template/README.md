# Agent Template

A minimal starter agent. Copy this folder to create your own.

## Make a new agent

1. **Copy the folder**
   ```bash
   cp -r agents/_template agents/my-agent      # Git Bash
   # or in CMD:  xcopy agents\_template agents\my-agent /E /I
   ```

2. **Edit `agents/my-agent/config.js`** — set the `systemPrompt` (who the agent is)
   and the `model`.

3. **Edit `agents/my-agent/index.js`** — this is the logic. The template just reads
   from the terminal and replies. Replace that with whatever your agent should do
   (watch a folder, poll a website, read emails, etc.). Every agent gets its brain
   the same way:
   ```js
   const { askClaude } = require('../../shared/claude');
   const reply = await askClaude({ system, prompt, model });
   ```

4. **Add a run script** to the project's `package.json`:
   ```json
   "scripts": {
     "my-agent": "node agents/my-agent/index.js"
   }
   ```

5. **Run it**
   ```bash
   npm run my-agent
   ```

## Give it instructions

The "instructions" for an agent are its `systemPrompt` in `config.js`. Write it like
you'd brief a new assistant: who they are, what they know, the tone, and the rules
(what they must never do). The clearer and more specific it is, the better the agent
behaves.
