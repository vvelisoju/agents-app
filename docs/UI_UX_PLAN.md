# UI/UX review & implementation plan

> **Planning doc — not the source of truth.** The **backlog** ([architecture/backlog.md](architecture/backlog.md)) and the **shipped `client/` code** are authoritative. For the UI/UX actually built and verified, see the **Execution Log** ([architecture/EXECUTION_LOG.md](architecture/EXECUTION_LOG.md)) (Phase 4 Creation Studio, Automations/Approvals/Insights, agent-detail panels). This document is the original review + plan and may lag what shipped.

Honest assessment of the current `client/` against [UX_PRINCIPLES.md](UX_PRINCIPLES.md), the gaps for a
**web + mobile-friendly, invisible-UI, AI-agentic** product, and a prioritized plan to close them.

_Reviewed 2026-11-13. Status: foundation built & verified (builds, connects to server). UI/UX is **not
complete** — the core design system and screens exist, but several invisible-UI and mobile pillars are
missing._

## Progress log

**2026-11-13 — big UI/UX build (client fully owned by this session; peer owns server/API).**
Done & verified (client builds clean + rendered screenshots confirm a professional AI look):
- ✅ **AI visual identity**: violet→cyan brand gradient, glass, glow, Sparkles mark, aurora background,
  gradient buttons, dark/light tokens + toggle (UX visual priority).
- ✅ **Adaptive chrome** (UX-1): desktop sidebar + mobile bottom tab bar (Agents/Inbox/Leads/Settings).
- ✅ **AI-hero Login**, **Settings** (theme + **Plan/billing** + **People/team**), **unified Inbox**.
- ✅ **Leads board** (UX-13): stages, notes, CSV export, open-chat.
- ✅ **Conversation control** (UX-16): take over, mute, manual reply; chat bubbles.
- ✅ **Vertical templates** quick-setup (UX-15) in training.
- ✅ **Analytics dashboard** strip (UX-9 start): replies today/total, leads won.
- ✅ **PWA** (UX-4): manifest + service worker (installable); AI app icon.
Pending: i18n hi/te (UX-3), first-run polish (UX-2), offline outbox (UX-8), Capacitor native shell
(UX-7, needs native SDKs), a11y pass (UX-11), typing/activity-feed polish (UX-9), per-agent business
hours + 'away' rendering, billing Razorpay checkout (needs keys).

---

## 1. Are we following invisible UI? — scorecard

| UX principle | Status | Notes |
|---|---|---|
| Zero-decision defaults | ✅ | Agent name pre-filled; training defaults; auto-reply off by default |
| ≤3 controls before the primary action | 🔨 | Login/add-agent are clean; the **training panel is dense** (many fields at once) — needs disclosure |
| Outcome-named buttons | ✅ | "Connect / show QR", "Add these to the agent", "Turn on widget" |
| Show what changed | 🔨 | Status lines shown; no explicit result sheet after connect/train |
| Zero-states with a first action | ✅ | "Add your first agent", empty chats dispatch |
| No tours/tooltips | ✅ | None |
| AI-agentic framing (agents, not settings) | ✅ | Gallery + agent cards + status pills |
| Conversational training | 🔨 | Friendly labels, but still reads form-like |
| Live, visible work | 🔨 | Live QR + status; **no activity feed / typing / "what the agent did"** |
| Verify by chatting (Test console) | ✅ | "Ask your agent anything" |
| Train with one paste | ✅ | Train-from-link works |
| Mobile + web, one codebase | 🔨 | Vite SPA ✅; **Capacitor native not set up**; **no bottom-tab mobile chrome** |
| Mobile tokens (safe-area, 44px tap) | ✅ | Present in shell/toast/kit |
| Offline resilience | ❌ | No React Query persistence / outbox |
| shadcn-style kit + two-layer tokens | ✅ | button/card/input/…; HSL vars + spacing tokens |
| i18n (English/Hindi/Telugu) | ❌ | Not wired — **tier-2 blocker** |

**Verdict:** the principles are respected *in what exists*, but the UI/UX is **partially complete**.
Five pillars are missing: **mobile-native chrome, i18n, offline/PWA, first-run activation, accessibility**.

## 2. Mobile + web friendliness — where we stand

- ✅ **Web:** responsive, centered column, works at desktop + phone widths.
- ✅ **Mobile-responsive:** 44px tap targets, safe-area insets, backdrop app bar.
- ❌ **Mobile-native feel:** no bottom tab bar, no installable PWA, no Capacitor iOS/Android shell, no
  haptics, no pull-to-refresh, no hide-on-scroll bar. Today it's a *responsive web app*, not yet a
  *mobile app experience*.

## 3. Gaps (all of them)

**Navigation & shell**
- No adaptive chrome: bottom tab bar on mobile/native, sidebar/header on desktop (B1.3).
- Only one top-level section (Agents). Needs: Inbox, Leads, Settings → then nav matters.

**Activation & flow**
- No first-run activation (land in "add your first agent", guided to live) (B1.7).
- No "show-what-changed" result sheet after connect / train / go-live.
- Training panel exceeds the ≤3-controls rule — needs progressive disclosure.

**Mobile platform**
- Capacitor native projects not initialized (B0.3); no PWA manifest/service worker.
- No push notifications, haptics, native share, status-bar/safe-area polish.

**Localization**
- No i18n framework; all strings hardcoded in English. Need en/hi/te (UX_PRINCIPLES §6).

**Resilience & feedback**
- No offline persistence (React Query persist) or write outbox (B1.4 completion).
- Loading states are plain "Loading…" text — no skeletons.
- Error handling inconsistent (some toasts, some inline).
- No optimistic updates (toggles, adds feel laggy on slow nets).

**AI-agentic polish (B17)**
- No agent activity feed, no typing/thinking indicator on drafts, no live "chats today" stat on cards.

**Accessibility (B1.8)**
- No systematic focus management, aria labels, contrast audit, keyboard nav.

**Theming**
- Light tokens exist but no toggle; no per-tenant theme.

**Missing screens (UI for planned features)**
- Unified multi-agent **Inbox** (B7.3), **Settings/profile**, **Workspace switcher** (B2.6),
  **Billing** page (B10), **Leads** board (B18). These need UI even if backend is later.

## 4. Implementation plan (prioritized)

**P0 — make it a true web + mobile, invisible-UI MVP** (do these next)

| ID | Task | Why | Done when |
|---|---|---|---|
| UX-1 | **Adaptive chrome**: bottom tab bar (Agents · Inbox · Settings) on mobile, header+sidebar on desktop, from one `navigation.ts` + `chrome.ts` | Mobile-native feel; ClassPe pattern | Bottom nav on phone widths, sidebar ≥ md; `isNative()` aware |
| UX-2 | **First-run activation**: new signup lands directly in "Add your first agent" → connect → train-from-link → live, as one guided path | The critical first 5 minutes | New user reaches a live/trained agent with no dead-ends |
| UX-3 | **i18n (en/hi/te)**: add i18next, externalize strings, language switch in Settings; default from device | Tier-2 reach | Switching language changes all app copy |
| UX-4 | **PWA**: manifest + service worker (installable, offline shell) via `vite-plugin-pwa` | "Install app" on mobile web | Installable; app shell loads offline |
| UX-5 | **Invisible-UI refinements**: `ResultSheet` (show-what-changed after connect/train), `Disclosure` on the training panel (≤3 controls, rest behind "More training"), loading **skeletons**, consistent error toasts, optimistic toggles | Core doctrine | Training shows ≤3 controls first; every write shows its result |
| UX-6 | **Settings screen** (profile, language, theme, logout) + **theme toggle** | Needed shell destination | Settings reachable from nav |

**P1 — native + polish**

| ID | Task | Why |
|---|---|---|
| UX-7 | **Capacitor native shell** (B0.3): init android/ios, status bar, splash, safe areas, **haptics** on key actions, **push notifications** | Real mobile apps |
| UX-8 | **Offline resilience** (B1.4): persist React Query to IndexedDB + write **outbox** that replays on reconnect | Flaky tier-2 networks |
| UX-9 | **AI-agentic polish** (B17): agent **activity feed**, **typing/thinking** indicator on drafts, live "N chats today" on cards | Feels intelligent |
| UX-10 | **Unified Inbox** (B7.3): one inbox across all agents, filter by agent/channel, draft approve/skip inline | Daily driver screen |
| UX-11 | **Accessibility pass** (B1.8): focus order, aria, contrast AA, keyboard | Quality + reach |
| UX-12 | **Workspace switcher** (B2.6) in the top bar | Multi-business owners |

**P2 — feature-screen UI (as their backends land)**

| ID | Task |
|---|---|
| UX-13 | **Leads board** UI (B18) — pipeline, lead cards, export |
| UX-14 | **Billing** UI (B10) — plan, usage, upgrade, Razorpay checkout |
| UX-15 | **Vertical templates** picker (B22) — "What's your business?" → pre-trained agent |
| UX-16 | **Conversation control** UI (B19) — live takeover, business hours, pause |

## 5. Sequence

Do **P0 UX-1 → UX-6** next (completes the invisible-UI, mobile+web MVP shell), then P1 for native +
polish, then P2 screens as their backends are built. Each task keeps the DoD: within click budgets,
responsive at phone width, no regression.
