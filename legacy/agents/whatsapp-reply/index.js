// =============================================================
// agents/whatsapp-reply/index.js
// WhatsApp reply assistant.
//   1. Opens WhatsApp Web in a background browser.
//   2. You scan a QR code ONCE (session is saved after that).
//   3. When a customer messages you, Claude drafts a reply.
//   4. You approve it in the terminal, then it sends.
//
// Edit agents/whatsapp-reply/config.js to change behaviour.
// Run from the project root with:  npm run whatsapp
// =============================================================
require('dotenv').config();
const readline = require('readline');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { askClaude } = require('../../shared/claude');
const config = require('./config');

// ---- terminal input helper (for approvals) ------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

// ---- tiny helper: is this message worth replying to? --------
const ACKS = new Set([
  'ok', 'okay', 'k', 'kk', 'thanks', 'thank you', 'ty', 'thx', 'thankyou',
  'great', 'good', 'nice', 'done', 'cool', 'fine', 'welcome', '👍', '🙏', '👌', '❤️',
]);
function worthReplying(body) {
  const t = (body || '').trim().toLowerCase();
  if (!t) return false;
  if (!config.onlyRespondToQuestions) return true;
  return !ACKS.has(t);
}

// ---- swap {{LOCATION}}/{{PHOTOS}}/{{VIDEO}}/{{PHONE}} placeholders the ----
// ---- model wrote for the exact links in config.js (URLs stay correct) ----
function applyLinks(text) {
  if (!text) return text;
  const links = config.links || {};
  const map = {
    '{{LOCATION}}': links.location || '',
    '{{PHOTOS}}': links.photos || '',
    '{{VIDEO}}': links.video || '',
    '{{PHONE}}': links.phone || '',
  };
  return Object.entries(map).reduce((acc, [token, url]) => acc.split(token).join(url), text);
}

// ---- the WhatsApp client ------------------------------------
const client = new Client({
  // LocalAuth saves your login to .wwebjs_auth/ so you only scan the QR once.
  authStrategy: new LocalAuth({ clientId: 'whatsapp-reply' }),
  // Give WhatsApp's WebSocket longer to connect before the QR appears.
  // The default is 30s; a slower connection can trip the
  // "Waiting failed: 30000ms exceeded" error during startup — 90s is safer.
  authTimeoutMs: 90000,
  // If the number looks linked elsewhere, take over instead of stalling.
  takeoverOnConflict: true,
  takeoverTimeoutMs: 0,
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-setuid-sandbox',
    ],
  },
});

client.on('qr', (qr) => {
  console.log('\n📱 Open WhatsApp on your phone → Settings → Linked Devices → Link a device,');
  console.log('   then scan this QR code:\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('🔐 Authenticated. Saving session...'));
client.on('auth_failure', (m) => console.error('❌ Auth failure:', m));
client.on('disconnected', (r) => console.warn('⚠️  Disconnected:', r));

client.on('ready', () => {
  console.log('\n✅ WhatsApp reply agent is ready and listening.');
  console.log(`   Mode: ${config.autoSend ? 'AUTO-SEND (sends without asking)' : 'APPROVE-BEFORE-SEND (safe)'}`);
  console.log(`   Model: ${config.model}`);
  console.log(`   Allowlist: ${config.allowlist.length ? config.allowlist.join(', ') : '(everyone)'}`);
  console.log('   Waiting for messages... (press Ctrl+C to stop)\n');
});

// ---- process one message at a time so approval prompts -------
// ---- never overlap in the terminal --------------------------
let queue = Promise.resolve();
client.on('message', (msg) => {
  queue = queue.then(() => handleMessage(msg)).catch((e) => console.error('Error:', e.message));
});

async function handleMessage(msg) {
  // Ignore status updates / broadcasts.
  if (msg.isStatus || msg.from === 'status@broadcast') return;

  const chat = await msg.getChat();

  // Skip groups unless explicitly enabled.
  if (chat.isGroup && !config.replyInGroups) return;

  const body = (msg.body || '').trim();
  if (!worthReplying(body)) return;

  // Allowlist check (digits-only number of the sender).
  const senderId = msg.author || msg.from;         // e.g. "919876543210@c.us"
  const number = senderId.split('@')[0];
  if (config.allowlist.length > 0 && !config.allowlist.includes(number)) return;

  const contact = await msg.getContact();
  const name = contact.pushname || contact.name || number;

  console.log('\n──────────────────────────────────────────');
  console.log(`📩 From ${name} (${number}):`);
  console.log(`   "${body}"`);

  // Build the recent conversation for context.
  let convo = '';
  try {
    const history = await chat.fetchMessages({ limit: config.historyLimit });
    convo = history
      .filter((m) => m.body)
      .map((m) => `${m.fromMe ? 'Me (business)' : 'Customer'}: ${m.body}`)
      .join('\n');
  } catch {
    convo = `Customer: ${body}`;
  }

  // Ask Claude for a draft reply.
  let draft;
  try {
    draft = await askClaude({
      system: config.systemPrompt,
      prompt:
        `Here is the recent WhatsApp conversation with a customer:\n\n${convo}\n\n` +
        `Write the business's next reply to the customer's most recent message. ` +
        `Reply with ONLY the message text to send, nothing else.`,
      model: config.model,
    });
  } catch (e) {
    console.error('   ⚠️  Could not get a reply from Claude:', e.message);
    return;
  }

  if (!draft) {
    console.log('   ⏭️  Claude returned nothing — skipped.');
    return;
  }
  if (draft.includes('NEEDS_HUMAN')) {
    console.log('   🙋 This one needs YOU — please reply to this customer yourself.');
    return;
  }

  // Insert the real links wherever the model used a {{TOKEN}} placeholder.
  draft = applyLinks(draft);

  console.log(`\n🤖 Suggested reply:\n   ${draft.replace(/\n/g, '\n   ')}\n`);

  // Auto-send mode: just send it.
  if (config.autoSend) {
    await msg.reply(draft);
    console.log('   ✅ Sent (auto).');
    return;
  }

  // Approve-before-send mode.
  const answer = (await ask('   Send this? [y = send / e = edit / n = skip]: ')).trim().toLowerCase();
  if (answer === 'y') {
    await msg.reply(draft);
    console.log('   ✅ Sent.');
  } else if (answer === 'e') {
    const edited = (await ask('   Type your reply: ')).trim();
    if (edited) {
      await msg.reply(edited);
      console.log('   ✅ Sent (your edited version).');
    } else {
      console.log('   ⏭️  Empty — skipped.');
    }
  } else {
    console.log('   ⏭️  Skipped.');
  }
}

console.log('Starting WhatsApp reply agent... (first run opens a browser to show the QR)');
client.initialize();
