# WhatsApp Reply Agent

Reads your incoming WhatsApp messages and drafts smart replies with Claude.
You approve each reply before it sends (until you decide to trust auto-send).

## How it works

```
Customer messages your WhatsApp
        │
        ▼
Agent sees the message (via WhatsApp Web in a background browser)
        │
        ▼
Is the sender allowed?  Is it a real question (not just "ok")?  ──no──▶ ignore
        │ yes
        ▼
Claude reads the last few messages and drafts a reply
        │
        ▼
autoSend = false  ──▶  shows you the draft  ──▶  you press y / e / n
autoSend = true   ──▶  sends automatically
```

## Run it

From the **project root** (`PersonalAgents/`):
```bash
npm run whatsapp
```

First run shows a QR code — scan it from **WhatsApp → Linked Devices**. After that
your login is remembered in `.wwebjs_auth/`.

## Settings (edit `config.js`)

| Setting | What it does |
|---|---|
| `autoSend` | `false` = approve each reply (safe, default). `true` = send automatically. |
| `allowlist` | Phone numbers (digits only, with country code) the agent may reply to. Empty = everyone. |
| `replyInGroups` | Reply inside group chats too. Usually `false`. |
| `historyLimit` | How many recent messages Claude sees for context. |
| `onlyRespondToQuestions` | Skip plain "ok"/"thanks"/emoji acknowledgements. |
| `model` | `claude-opus-5-5` (smartest) or `claude-haiku-5-5` (cheaper + faster). |
| `systemPrompt` | **The persona.** Your products, tone, prices, and rules. Edit this first. |

## Tips

- **Test with one contact first.** Put just your own second number (or a friend's)
  in `allowlist`, message it, and watch the drafts.
- If a message needs a human (complaint, refund), Claude replies with `NEEDS_HUMAN`
  and the agent tells you to handle it yourself — nothing is sent.
- To keep costs tiny at volume, set `model: 'claude-haiku-5-5'` in `config.js`.
- The agent only reacts to messages that arrive **while it is running**. Keep the
  terminal open and the computer awake.

## Safety

This automates WhatsApp Web, which is against WhatsApp's terms. Replying to people
who messaged you first is low-risk; sending bulk/unsolicited promotions is what gets
numbers banned, so this agent is deliberately built to **respond**, not blast. For
official bulk messaging, move to the WhatsApp Business Cloud API.
