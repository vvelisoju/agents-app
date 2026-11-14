# Pending backlog — implementation plan

Status: Phases 0–6 core + the new scope (PDF ingestion, RAG, DB/REST connectors) are **built,
deployed, and live-verified**. This plan covers what genuinely remains, classified and sequenced.
Every item follows the standing guardrails (additive, gated, reply path byte-for-byte, test-gated).

> **Concurrent-session constraint:** another session is building a **voice/transcription** feature in
> the client. To avoid tangling, this plan does **server/back-end work first** (no client-file
> collisions), then client UIs once the voice work is committed or we coordinate.

---

## A. Buildable now — the real remaining work (prioritized)

### Wave 1 — Back-end (no client collision) · do first
| # | Task | Value | Notes |
|---|---|---|---|
| 1 | **SEC‑9** — migrate Telegram `botToken` → encrypted `ConnectedAccount` | Med (security) | Move the plaintext channel token into the AES‑GCM store + `connectedAccount` lib; decrypt at send time. Additive, test-gated. |
| 2 | **SCN‑06** — promote outbound send to a supported capability + `message_ack` → delivered/read | Med | Subscribe to `client.on('message_ack')`, map ACK 2/3 → `delivered`/`read` on `OutboundSendLog`; retire the TEMP `/test-send` route (FND‑07). |
| 3 | **SCN‑14** — delivered/read status sync (ledger) | Low‑med | Fold ack updates into the ledger; progress counts reflect live delivery. |
| 4 | **DB‑14** — tenant-scope read helper | Low | A small `scopedFindById(orgId)` guard applied to by-id reads; a defensive test. |
| 5 | **Connector "test connection" endpoint** | Med | `POST /api/connectors/:id/test` runs a trivial read to validate a new connection before the owner adds ops. |

### Wave 2 — Client config UIs for the new back-end (coordinate with the voice session)
These unlock features whose APIs are done but have no UI yet — **highest user value**.
| # | Task | Value |
|---|---|---|
| 6 | **Connector config UI** — add a DB/REST connection + define operations (name, SQL/endpoint, params, access, read/write) + the Abilities toggle for `data.query`/`data.action` | High |
| 7 | **Documents / Knowledge UI** — show uploaded documents + chunk/embedded counts (`GET /knowledge`), a "re-index" button, and surface RAG status | High |
| 8 | **Outbound opt-out management UI** — list/clear `OutboundOptOut` (API exists) | Med |
| 9 | **STU‑24 / STU‑29/31** — template→spec presets + capability/trigger pickers (flip the "soon" placeholders now that Phase 5/6 wiring exists) | Med |
| 10 | **STU‑27..35** — richer draft-edit surfaces in the Studio review step | Low‑med |

### Wave 3 — QA + docs sweep (parallel fan-out)
| # | Task | Value |
|---|---|---|
| 11 | Deeper API/unit coverage on top of smoke tests (leads/team/billing deep paths; connector exec paths) | Low‑med |
| 12 | **PXD** docs reconcile (DATA_MODEL already done; AGENTS/UX principles cross-check, CHANGELOG) | Low |
| 13 | **DB‑16/18/21/22** — dev-reset script, divergence doc, perf check, doc reconcile | Low |

---

## B. Deferred by design (build when the trigger fires — not now)
- **Vector RAG activation (MK‑18/20):** plumbing is built; set `EMBEDDINGS_PROVIDER` + key to switch on.
- **SCN‑08 Trackly HTTP connector:** the drip already works off the owner's own recipient list; Trackly
  becomes an optional source when a real Trackly integration is needed.
- **SCN‑26 Google Calendar backend, SCN‑34 in-process delegate, EWS‑31 pg-boss, MK large-KB pgvector,
  Phase‑7 scale-out:** each has a written flip trigger; nothing built speculatively.

## C. Owner-gated (needs your action — I prepare, you execute)
- **SEC‑3/4/5 token hashing + expiry + rotate-on-login** — invalidates all live sessions; needs a
  maintenance window. Infra ready.
- **orgId NOT‑NULL enforcement** — after a prod-scale rehearsal (DB‑24).
- **DR restore drill (DB‑17/QA‑48)** — needs Railway backup access.
- **Enable the feature flags in prod** — `WORKFLOW/MONITOR/MEMORY` already on; `OUTBOUND` and embeddings
  on your go (`docs/OPERATIONS.md`).

---

## Execution order
1. **Wave 1** (back-end) now, task by task, each test-gated + deployed.
2. **Wave 2** (client UIs) after the voice session commits, to avoid client collisions.
3. **Wave 3** (QA/docs) as a parallel fan-out.
4. **Section C** handed to you as a runbook when Wave 1–3 are done.
