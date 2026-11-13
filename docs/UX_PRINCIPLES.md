# UX principles — invisible UI, AI-agentic, effortless

The product must **feel like an AI agent doing the work**, not a form the user fills in. The primary
goal is **fewer clicks and less effort**. These rules are binding for every screen. They adopt
ClassPe's proven "standing constraints" and extend them for an agentic product.

## 1. Invisible UI — the interface gets out of the way

- **Zero-decision defaults.** Every new agent, every setting, every field ships with a sensible
  default already chosen. Complexity lives in generated data, never in the form the user faces.
- **≤ 3 controls before the primary button.** A primary flow shows at most three inputs before its
  action button. Everything else sits behind **one named disclosure that states its default in words**
  (e.g. "Replies in the customer's language · change") — never a bare "More" or "Advanced".
- **Outcome-named buttons.** Every button says what will happen in the user's words:
  `Connect WhatsApp`, `Train this agent`, `Turn on auto-reply` — never `Submit`, `Save`, `OK`.
- **Show what changed.** After any action, show the result and its side-effects (e.g. "Agent is live —
  it will now reply to new messages. Auto-reply is ON."). A self-dismissing toast is not confirmation.
- **No empty states without a first action.** Every empty list is a dispatch: an empty agents list
  shows one big **"Add your first agent"**; empty training shows **"Paste your website link to start"**.
- **No tours, tooltips, or coach-marks.** If a screen needs a tutorial, redesign it. The product
  teaches by doing.

## 2. AI-agentic feel — the user feels an agent is working for them

- Frame everything around **agents**, not settings. The home screen is "Your agents", each a card
  with a live status ("Replying · 4 chats today"), not a config panel.
- **Agent gallery onboarding.** Adding an agent starts from a visual picker — WhatsApp, Instagram,
  Gmail, LinkedIn, … — each a tile with an icon and one line ("Reply to WhatsApp customers"). The user
  *picks an agent*, the app does the setup.
- **Conversational training.** Training reads like talking to the agent: "What should I know about your
  business?", "What should I never say?", "Paste any links I can share". Plain-language, not DB fields.
- **Live, visible work.** Show the agent acting: typing indicators on drafts, a running count of
  replies, a feed of "what the agent did". The user should *see* intelligence, calmly.
- **Verify, don't configure.** The Test Console ("Ask your agent anything") is front-and-center so the
  user confirms behaviour by chatting, not by reading settings.

## 3. Effort budget — measured, not vibes

Target click-counts for the core jobs (fewer is better; these are ceilings):

| Job | Max taps/clicks |
|---|---|
| Add an agent and reach the QR | 3 (pick channel → name is pre-filled → Connect) |
| Train with a website link | 2 (paste link → Train) |
| Add a fact / instruction | 2 |
| Turn auto-reply on | 1 (a single toggle) |
| Test the agent | 1 (type + Enter) |
| Add another agent of the same type | 2 (Add → Connect) |

If a flow exceeds its budget, it is a bug to fix, not ship.

## 4. Easy training — the heart, made effortless

- **One paste, done.** The fastest path: paste a website URL → the agent ingests it → ready. Everything
  else (facts, restrictions, FAQs, links) is optional enrichment, each addable in one short line.
- **Always editable, instant effect.** Training is never "locked"; edits apply to the next message with
  no "retrain" button. The UI says "Saved — your agent already knows this."
- **See what it knows.** A plain-language "What your agent knows" summary, not a raw data dump.
- **Guardrails in words.** Restrictions are phrased as "Never do X" lines the user types naturally.

## 5. Mobile + web, one codebase

- **React + Vite SPA wrapped by Capacitor** (like ClassPe): same code → web (PWA), iOS, Android.
- **Adaptive chrome** from one config: **bottom tab bar on native**, **sidebar + header on desktop**
  (ClassPe's `chrome.ts` / `navigation.ts` pattern). Nav items are data, feature/role-gated.
- **Mobile-first tokens:** iOS safe-area insets, 44px minimum tap targets, keyboard-height var, haptics
  on key actions, hide-on-scroll app bar, pull-to-refresh.
- **Offline-tolerant:** React Query persisted to IndexedDB (cold-launch to last data); an outbox queues
  writes offline and replays on reconnect — so a tier-2 user on a flaky network never loses an action.

## 6. Design system (aligned with ClassPe)

- **shadcn/ui** (Radix + `class-variance-authority` + `cn()`) under `client/src/components/ui/` as the
  one primitive library; feature components compose it. No MUI/Ionic.
- **Two-layer tokens:** CSS custom-property HSL colors consumed as `hsl(var(--primary))` in
  `tailwind.config.ts`; plus named spacing/size tokens (`safe-top/bottom`, `tap=44px`, `appbar`,
  `tabbar`, `gutter`) and a role-based rem type scale (respects OS Dynamic Type). A `theme.json` seed
  enables per-tenant rebranding.
- **i18n from day one:** `i18next` with English, Hindi, Telugu — essential for tier-2 reach.

## 7. Language & tone

- Plain words, short sentences, the user's language. Money and numbers are specific.
- The agent's own replies follow each business's training; the *product's* copy follows these rules.

> These principles are the acceptance bar. A screen that is "correct" but needs more than its click
> budget, hides what changed, or reads like a settings form does not pass review.
