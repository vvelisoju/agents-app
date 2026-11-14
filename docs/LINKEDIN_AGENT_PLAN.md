# LinkedIn agent — implementation plan (browser automation, owner-operated)

Status: **planned, not built.** This document is the agreed design for a LinkedIn agent that drives a
real logged-in Chrome session (no LinkedIn API) to act on the owner's behalf: publish posts, monitor
chosen people's posts and draft a reshare/comment, and search jobs. Built the same way as every other
feature here — **additive, gated behind a flag, approval-gated writes, test-gated, reply/engine paths
untouched.**

> **Scope guard:** this is for the **owner's own single LinkedIn account**, operated by the owner, with
> a human approving every outbound action. It is **not** a multi-tenant product feature. Automating many
> customers' LinkedIn accounts is the exact activity LinkedIn litigates over and would put the business
> at risk — out of scope by design.

---

## 1. The honest risk frame (read before building)

LinkedIn's User Agreement prohibits bots/automation/scraping. Driving a logged-in session can get the
account **warned → restricted → permanently banned**, and detection is active (behavioural, rate,
browser-fingerprint, new-IP/location checkpoints). We go in **accepting ban as a possible outcome**. The
design therefore optimises for *looking human and staying low-volume*, not for throughput:

- **Human approves every write.** Nothing is posted/commented/reshared without an explicit approval
  (reuses `Step.awaitApproval`). The bot drafts; the owner clicks send.
- **Human-paced.** Randomised delays, small daily caps, no burst actions, business-hours only.
- **One session, one account.** No parallelism, no multi-account.
- **Kill switch.** A single flag (`LINKEDIN_ENABLED=false`) and a per-agent stop that halts all actions.
- **Read-mostly first.** The monitoring/job-search capabilities only read + draft; writes are the
  smallest, most conservative surface.

If LinkedIn throws a checkpoint/2FA, the worker **stops and alerts the owner** (it never tries to solve
a security challenge itself).

---

## 2. Why this fits the current architecture (reuse, not rebuild)

| Need | Reused building block |
|---|---|
| Headless Chrome + persistent login profile | `puppeteer` (already a dep via `whatsapp-web.js`) + the `setup-browser` script; mirror the `LocalAuth` persistent-profile + stale-lock self-heal pattern in `server/src/channels/whatsapp.ts` |
| Proactive scheduled loop (poll → detect → act) | cron `Trigger` → `tickCron` enqueues a `Job` → runner invokes a `WorkflowHandler`; model on `workflow/handlers/scheduledMonitor.ts` |
| Human-in-the-loop gate | `Step.awaitApproval(actionType, payload, reason)` (`workflow/types.ts`) + the existing approvals router/runner |
| Encrypted session/credential storage | `ConnectedAccount` AES-GCM store (`lib/connectedAccount` / crypto) |
| "Add agent" gallery entry + lifecycle | `ChannelAdapter` + `register()` (`channels/registry.ts`); add a `linkedin-browser` adapter |
| Owner notifications (checkpoint, draft-ready) | `lib/notify` (WhatsApp/alert number already used by the monitor handler) |

Net new code is a **LinkedIn browser driver** (Puppeteer page actions) and a **LinkedIn workflow
handler** + a thin adapter + a few additive Prisma models. No engine change.

---

## 3. Capabilities (the "responsibilities" the owner assigns)

Each is a discrete, independently shippable capability. All writes are approval-gated.

1. **Publish a post** — owner writes (or the agent drafts from a prompt / training) → approve → the
   driver opens the composer, types human-paced, submits. *(write)*
2. **Monitor people → draft a reaction** — owner lists people to watch (e.g. their boss). The scheduled
   handler opens each person's recent activity, detects a genuinely new post (hash/id, same idiom as the
   website monitor), and **drafts** a comment and/or a reshare caption based on the post content (via the
   existing agentic model). Owner approves → driver posts the comment / reshares. *(read + gated write)*
3. **Search jobs → save/report** — owner gives criteria; the driver runs a jobs search, extracts the
   listing cards, and returns a saved digest (and/or a WhatsApp summary). **v1 is read-only — no
   auto-apply.** Auto-apply is deferred (highest ToS risk, Easy-Apply forms are brittle). *(read)*

Roles/persona/training are the same uniform training object every other agent uses — no new training UX.

---

## 4. Login / onboarding (the hard part)

LinkedIn has no QR handoff. Two realistic options — **Option A is the recommendation**:

- **A. Session-cookie capture (recommended).** The owner logs into LinkedIn once in a normal browser and
  provides the `li_at` (+ `JSESSIONID`) session cookie, which we store **encrypted** in `ConnectedAccount`.
  The worker injects it into the Puppeteer context — no password in our system, no automated login form to
  trip detection, 2FA already satisfied. Cookie expires (~weeks–months) → status flips to `needs_relink`
  and the owner is alerted to re-paste. Onboarding kind: a small "paste your session" flow (`onboarding:
  'token'`-style).
- **B. Headful one-time login on the worker host.** The owner logs in interactively through a visible
  browser on the worker machine; the profile is persisted (`LocalAuth`-style). Cleaner UX but requires a
  machine with a display at setup and is harder on a headless server.

Password-in-the-bot auto-login is **rejected** — it reliably triggers checkpoints and stores a high-value
secret.

---

## 5. Where it runs (IP matters — owner decision)

LinkedIn flags **datacenter IPs and new-location logins** hard. The session cookie was minted from the
owner's real IP; replaying it from a Railway datacenter IP is a likely checkpoint trigger.

- **Recommended:** run the LinkedIn worker as a **dedicated worker process on a stable, residential-ish
  IP** — e.g. the owner's own always-on machine / mini-PC, or a fixed-IP VPS the owner already uses —
  pointed at the same Postgres. It pulls jobs and reports status like any other worker.
- **Not recommended:** running it on the shared Railway web dyno alongside the API.

This keeps the risky, ToS-sensitive browser automation **off the SaaS's shared infra** and co-located
with the account's normal IP. (Decision 2 below.)

---

## 6. Data model (additive — no changes to existing tables)

- Reuse **`ConnectedAccount`** for the encrypted LinkedIn session + `status`
  (`connected | needs_relink | checkpoint`).
- **`LinkedInWatch`** (or reuse/extend `Watch`): `{ orgId, agentId, profileUrl, label, lastPostId,
  lastCheckedAt, active }` — the people to monitor.
- **`LinkedInAction`** (or reuse the approvals/outbound-log tables): the audit trail of every drafted/
  approved/executed action `{ kind: post|comment|reshare|job-search, payload, state, approvedBy, result }`.
- Monitoring is scheduled with the existing **cron `Trigger`** (`handlerName: 'linkedin-monitor'`,
  per-watch `filterJson`).

---

## 7. Build waves (each additive, flag-gated, test-gated)

**Wave 0 — foundation (no LinkedIn calls yet)**
- Add `puppeteer` as a direct dep (today it's transitive); `LINKEDIN_ENABLED` flag (default off).
- `linkedin-browser` adapter registered (coming-soon tile) + `ConnectedAccount` session plumbing +
  cookie-paste onboarding endpoint. Unit tests for session store/encrypt.

**Wave 1 — session + actions + worker ✅ BUILT (test-gated, 2026-11-14)**
- `lib/linkedin/driver.ts` — Puppeteer driver (lazy-required), injects the `li_at` cookie, `publishPost` /
  `commentOnPost` / `resharePost`, checkpoint/login-wall detection → `SessionError` → session flipped +
  owner re-link. **Selectors are centralised in `SELECTORS` and marked NEEDS-LIVE-TUNING — tune on the
  owner's machine against the real DOM; nothing runs unattended because every action is approved first.**
- `LinkedInAction` model (both schemas) + `modules/linkedin/service.ts` — create/approve/cancel/list +
  atomic `claimNextApproved`/`recordResult` (lifecycle pending_approval→approved→executing→done|failed).
- `lib/linkedin/worker.ts` (`tickOnce` + `runWorker`) + `src/linkedinWorker.ts` entrypoint
  (`npm run linkedin:worker`) — runs on the owner's machine, gated by `LINKEDIN_ENABLED`.
- `modules/linkedin/router.ts` at `/api/linkedin` — connect (paste cookie), status, disconnect,
  actions CRUD, approve, cancel. RBAC + audit, cookie never echoed.
- Tests: `tests/linkedin.test.ts` (14) + `tests/linkedinActions.test.ts` (21) — payload validation,
  service lifecycle, worker dispatch + checkpoint path + no-double-run, full HTTP flow, RBAC, tenancy.
- **Remaining for Wave 1 to go live:** (a) selector tuning on the owner's machine with a real cookie;
  (b) owner runs the worker process; (c) a Studio UI (Wave 4) — until then, drive it via the API.

**Wave 2 — monitor people → draft reaction ✅ BUILT (test-gated, 2026-11-14)**
- `LinkedInWatch` model (both schemas): people to watch + `reaction` (comment|reshare|both) + baseline
  `lastPostId`. `modules/linkedin/monitorService.ts` — watch CRUD + `monitorTickOnce(deps)`.
- `driver.fetchLatestPost` (read the profile's latest activity; separate `LinkedInReader` interface,
  NEEDS-LIVE-TUNING) + `lib/linkedin/draft.ts` (`draftReaction` reuses `composeSystemPrompt`+`askClaude`
  so the comment/caption is in the agent's trained voice — injected, so tests never call the model).
- Flow: first sighting = baseline (no draft); a genuinely new post → drafts a comment and/or reshare
  as **pending_approval** `LinkedInAction`s (owner still approves). A dead session flips to needs_relink.
- Folded into the worker loop: approved actions take priority; idle cycles poll the most-stale watch.
- Routes: `/api/linkedin/:agentId/watches` (CRUD). Tests: `tests/linkedinMonitor.test.ts` (11) —
  baseline/new/unchanged/both/session-fail + watch CRUD + tenancy. Full suite 322/322 green.
- **To go live:** same as Wave 1 (tune `fetchLatestPost`/reaction selectors on the owner's machine).

**Wave 3 — job search (read-only digest)**
- `searchJobs(criteria)` driver → extract listings → saved digest + optional WhatsApp summary. No apply.

**Wave 4 — client UI**
- A LinkedIn section in the Studio: connect (paste session), watched people, pending approvals, post box,
  job digests. Reuses the existing approval/review surfaces.

**Deferred (explicit trigger, not now):** auto-apply to jobs; auto-DM/connection-requests (highest ban
risk); any multi-account/customer-facing version.

---

## 8. Guardrails checklist (enforced in code)

- [ ] `LINKEDIN_ENABLED` master flag + per-agent on/off + hard stop.
- [ ] Every write → `Step.awaitApproval` before execution. No silent sends.
- [ ] Randomised human delays; per-day action caps; business-hours window.
- [ ] Checkpoint/2FA/unexpected-page → stop + alert owner, never auto-solve.
- [ ] Session cookie encrypted at rest; never logged; `needs_relink` on expiry.
- [ ] Full `LinkedInAction` audit trail.
- [ ] Runs on the owner's chosen worker/IP, not shared SaaS infra.

---

## 9. Decisions (confirmed by owner — 2026-11-14)

1. **Login method:** **A — session-cookie paste.** Owner supplies `li_at` (+ `JSESSIONID`), stored
   encrypted in `ConnectedAccount`; no password in the system.
2. **Where it runs:** **Owner's own always-on machine / fixed-IP box**, a dedicated worker pointed at the
   same Postgres — not on Railway/shared infra.
3. **v1 scope:** **Posting only.** Prove the session holds up with the smallest write surface; monitoring
   (Wave 2) and job search (Wave 3) follow once login is reliable.

Still to gather before Wave 2: who to monitor first, and the auto-draft tone (reuse existing training).
