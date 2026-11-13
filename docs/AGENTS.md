# Agents — catalog, extensibility & easy training

The platform is **agent-first**: a user enables agents the way they pick apps. It must support
**any number of agents, of the same type or different types**, added in a couple of taps, and the set
of supported agent types must grow quickly without rewrites.

## 1. The agent model

An **agent** = a **channel connection** + a **persona/role** + its **training** + **settings**.

- A user can run **many agents of the same type** (e.g. three WhatsApp numbers) and **many of
  different types** (WhatsApp + Instagram + Gmail), all under one account, limited only by plan.
- Each agent is independent: its own connection, its own training, its own on/off and auto-reply.
- Training is **uniform across every agent type** (same screens, same effort) — see §4.

## 2. Extensibility — adding an agent type is a module, not a rewrite

Every channel implements one interface and self-registers; the core engine never changes.

```ts
interface ChannelAdapter {
  type: string;                       // 'whatsapp-web' | 'instagram' | 'gmail' | ...
  displayName: string;                // "WhatsApp"
  capabilities: Capability[];         // ['text','images','location','quick-replies']
  onboard(agent): OnboardingFlow;     // QR | OAuth | API key | embed snippet
  start(agent): Promise<void>;
  stop(agent): Promise<void>;
  onInbound(cb: (msg: Message) => void);  // normalise to the common Message shape
  send(agent, reply: Reply): Promise<void>;
}
```

- **Common `Message`/`Reply` shape** → the reply engine and training are 100% channel-agnostic.
- **Adapter registry** → the "Add agent" gallery is generated from registered adapters; adding a type
  means dropping in one adapter module + registering it. The UI, training, inbox, and billing all work
  for the new type automatically.
- **Capability flags** let the UI adapt (e.g. show a location field only for channels that support it).
- **Onboarding is per-adapter** (QR for WhatsApp-web, OAuth for Meta/Google, API key for Telegram, an
  embed snippet for the web widget) — but always reduced to the fewest steps (see UX_PRINCIPLES.md).

## 3. Catalog & tier-2 priority (sales + leads focus)

Ranked for tier-2 Indian SMBs (coaching centres, clinics, salons, boutiques, gyms, real estate,
coworking). "Value" = lead/sales impact there.

| # | Agent | Status | Tier-2 value | Onboarding | API feasibility | Notes |
|---|---|---|---|---|---|---|
| 1 | **WhatsApp** | ✅ built (QR) | Very high | QR (now), Cloud API (later) | Easy | The dominant channel; replies are low-cost |
| 2 | **Website chat widget** | ⬜ next | High | Paste an embed snippet | Easy (ours) | 100% in our control; converts site visitors; zero platform risk — great 2nd agent |
| 3 | **Instagram DM** | ⬜ next | High | OAuth (Meta) | Medium | D2C, salons, boutiques, gyms; needs Business/Creator account + app review |
| 4 | **Missed-call → WhatsApp** | ⬜ high | Very high | Virtual number (Exotel/Knowlarity) | Medium | A missed call auto-sends a WhatsApp reply + catalog — a classic tier-2 lead magnet |
| 5 | **Google Business (reviews + Q&A)** | ⬜ | High | OAuth (Google Business Profile) | Medium | Auto-answer profile Q&A and reply to reviews; boosts local "near me" discovery. (Google Business *Messages* was retired in 2024 — this is Profile Q&A/reviews, not DM.) |
| 6 | **Facebook Messenger** | ⬜ | Medium | OAuth (Meta) | Medium | Shares Meta plumbing with Instagram — cheap to add once IG exists |
| 7 | **Telegram** | ⬜ | Medium | Bot token | Easy | Cleanest bot API; communities, groups |
| 8 | **Email / Gmail** | ⬜ | Medium | OAuth (Gmail) / IMAP-SMTP | Easy | Enquiry + quote auto-reply; no platform ToS risk |
| 9 | **SMS** | ⬜ | Medium | Provider (Twilio/Gupshup) | Easy | Universal reach where data is poor; pay per message |
| 10 | **Voice / IVR agent** | ⬜ later | High (hard) | Telephony + speech | Hard | Answer calls in local language; big tier-2 value but the most work |
| 11 | **LinkedIn** | ⬜ constrained | Low–med | — | Hostile | No official DM-automation API; automation risks bans. Offer only as content/compliant features, not DM auto-reply |

**Recommended next three for revenue:** Website widget (easy, ours), Instagram (D2C demand),
Missed-call→WhatsApp (uniquely tier-2). These, plus WhatsApp, cover most lead sources an SMB has.

### Agent *roles* (a second dimension, configured via training)

The same channel agent can play a role, set purely through training/persona — no new code:
Sales/lead-qualifier · Support/FAQ · Appointment booking · Catalogue & price · Follow-up/reminder.
Later these become one-tap "role presets" that pre-fill training.

## 4. Easy training — identical and effortless for every agent

Whatever the channel, training is the same simple flow (see UX_PRINCIPLES.md §4):

1. **Paste a website link** → the agent ingests it (fetch → extract → index). Often enough on its own.
2. **Add facts** — one line each ("Open desk from ₹3,999/month").
3. **Add restrictions** — "Never do X" lines.
4. **Add FAQs** — question/answer pairs.
5. **Add shareable links** — name + URL; the agent shares the exact URL on request (`{{LINK:Name}}`).
6. **Set tone & language** — defaults provided; Hindi/Telugu/English supported.
7. **Test** — "Ask your agent anything" console; nothing is sent.

All of it is **editable any time** and applies to the **next message** with no retrain step. The same
training object drives every channel the business connects, so a business trains once and can reuse it
across agents (with per-agent overrides).

## 5. Build order (see BACKLOG.md for the full task breakdown)

1. Harden WhatsApp + the adapter framework so the 2nd agent type is trivial.
2. Website chat widget (proves multi-type with zero external dependency).
3. Instagram (proves OAuth onboarding + Meta).
4. Missed-call→WhatsApp and Google Business (tier-2 lead engines).
5. Telegram, Gmail, SMS (breadth).
6. Voice/IVR (later, high-value).
