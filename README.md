# Personal Agents

A small, private hub for your own automation agents. Each agent lives in its own
folder under `agents/` and shares one "brain" (Claude) from `shared/`.

The first agent is a **WhatsApp reply assistant**: when a customer messages your
WhatsApp, Claude drafts a reply and you approve it before it sends.

```
PersonalAgents/
├─ shared/
│   └─ claude.js            ← the shared "brain" (talks to Claude)
├─ agents/
│   ├─ whatsapp-reply/      ← Agent #1: WhatsApp auto-reply
│   │   ├─ index.js         ← the agent (you rarely edit this)
│   │   ├─ config.js        ← YOUR settings + persona (edit this)
│   │   └─ README.md        ← how this agent works
│   └─ _template/           ← copy this to create new agents
├─ .env                     ← your secret API key (you create this; never shared)
└─ package.json
```

---

## One-time setup (about 5 minutes)

Open a terminal **in this folder** and run:

**1. Install the libraries**
```bash
npm install
```
> The first install also downloads a small Chromium browser (used behind the
> scenes for WhatsApp Web). It can take a few minutes — that's normal.

**2. Add your Claude API key**
- Get a key from https://console.anthropic.com/
- Copy `.env.example` to `.env` and paste your key:
```bash
cp .env.example .env     # (Git Bash)   —   or:  copy .env.example .env  (CMD)
```
Then open `.env` and set `ANTHROPIC_API_KEY=sk-ant-...`

**3. Tell the agent about your business**
- Open `agents/whatsapp-reply/config.js` and edit the `systemPrompt` (your products,
  tone, and rules). This is the most important step — better instructions = better replies.

---

## Run the WhatsApp agent

```bash
npm run whatsapp
```

- The **first time**, a QR code appears in the terminal. On your phone open
  **WhatsApp → Settings → Linked Devices → Link a device**, and scan it.
- After that it stays logged in — no QR needed next time.
- When a customer messages you, the agent shows a suggested reply and asks
  **`Send this? [y / e / n]`**. Press `y` to send, `e` to edit, `n` to skip.
- Press **Ctrl + C** to stop the agent.

Full details: [agents/whatsapp-reply/README.md](agents/whatsapp-reply/README.md)

### If you see `Could not find Chrome`

WhatsApp Web runs inside a Chrome browser that npm downloads for you. If that
download was interrupted (antivirus, a dropped connection), fetch it manually:
```bash
npm run setup-browser      # = npx puppeteer browsers install chrome
```
`npm install` also runs this automatically now (see the `postinstall` script).

---

## Important — please read

- **Keep the computer on.** This runs on *your* machine. When the computer is off
  or asleep, the agent isn't watching WhatsApp. (Later you can move it to a small
  always-on PC or a cheap cloud server.)
- **Start in approve-before-send mode** (`autoSend: false`, the default). Watch the
  replies for a few days before you ever consider turning on auto-send.
- **Reply to people who message you — don't mass-blast.** Sending the same
  promotional message to lots of people is the #1 reason WhatsApp bans business
  numbers. This tool is built for *responding*, which is safe. Keep it that way.
- **This uses an unofficial method** (automating WhatsApp Web), which is against
  WhatsApp's terms. The risk is low when you only reply to real conversations, but
  it is not zero. For heavy/official use, the WhatsApp Business Cloud API is the
  sanctioned route — ask and I'll help you move to it.
- Your `.env` and WhatsApp session (`.wwebjs_auth/`) are **private** and are never
  committed to git (see `.gitignore`).

---

## Add a new agent

1. Copy the `agents/_template/` folder to `agents/<your-agent-name>/`.
2. Edit its `config.js` and `index.js`.
3. Add a script to `package.json`, e.g. `"myagent": "node agents/my-agent/index.js"`.
4. Run it with `npm run myagent`.

See [agents/_template/README.md](agents/_template/README.md).
