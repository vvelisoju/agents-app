# Agent training — the heart of the product

A non-technical business owner must be able to make their agent reply well, **see exactly what it
knows**, and **change it any time** — no code, no redeploy. This is the most important feature.

## What a user can provide

| Input | Stored as | Example |
|---|---|---|
| Instructions | `training_profiles.instructions` | "Greet warmly, keep replies short, always offer a free tour." |
| Restrictions | `training_profiles.restrictions` | "Never quote a final price. Never promise delivery dates." |
| Facts | `training_sources` (`fact`) | "Open desk from ₹3,999/month." |
| Links | `training_sources` (`link`) | website, Google Drive folder, menu PDF |
| FAQs | `training_sources` (`faq`) | Q: "Do you allow 24/7 access?" A: "Cabins do…" |
| Settings | `training_profiles` + `agents` | tone, language, auto-send on/off, escalation keyword |

## Train from a link (the default, no-typing way to set up)

Most owners should never have to type their business into the agent. The primary onboarding is:
**paste a link you already have — your website, Google Business profile, Instagram or Facebook page —
and the agent reads it for you.**

Pipeline (`src/learn.ts`, endpoint `POST /agents/:id/training/learn`):
1. **Fetch** the URL (browser-like UA, 12s timeout, follows redirects).
2. **Extract** readable text + `<title>`/`og:`/meta description (scripts, styles, markup stripped).
3. **Condense** with Claude (Haiku) into a confirmable draft: `instructions`, `tone`, `language`,
   `facts[]`, `faqs[]`, `links[]` — strictly faithful to the page (never invents prices/offers).
4. **Confirm**: the UI pre-fills the instruction fields and lists the found knowledge as items the
   owner keeps or removes, then **"Add these to the agent"** saves the profile + chosen sources in
   one click. Add more links to accumulate; type extra instructions only if you want to.

Nothing is saved by the learn step itself — it returns a draft. The owner's confirmation persists it
through the normal profile + sources endpoints, so everything stays editable afterwards. Pages that
need a login or render purely via JavaScript (some social profiles) may return little; the UI says so
and the owner can paste a different link or add a couple of facts by hand. This is the invisible-UI
intent: the machine does the data entry, the owner just approves.

## How training becomes behaviour

On every inbound message the reply engine:
1. Loads the agent's `training_profile` + enabled `training_sources` from the DB.
2. Composes a **system prompt** = instructions + restrictions + tone/language + facts + FAQs.
3. If link knowledge is large, retrieves the top-k relevant chunks via pgvector (**RAG**) and adds
   them. Small training stays inline (cheaper and simpler).
4. Calls Claude (Haiku), applies any share-link placeholders (reusing the prototype's `{{LOCATION}}`
   pattern), and returns the reply.

**Immediate effect.** Training is read per message (with a short cache that is invalidated on save),
so an edit applies to the very next message. There is no "retrain" or "redeploy" step — the agent is
always live with its current training.

## Link processing pipeline

Adding a link triggers a background job: **fetch → extract readable text → chunk → embed → mark status.**
The UI shows each link's status (Queued / Processing / Ready / Failed, with Retry). A failed or private
link never blocks replies.

> Phase-1 simplification: before vector RAG is built, a link can be stored and its extracted text
> condensed into a few facts the owner confirms. Add true RAG (chunks + embeddings) in Phase 2 when
> content outgrows the prompt.

## Viewing the training (must be easy)

A **Training** screen per agent shows:
- Instructions, restrictions, tone/language — editable inline.
- All sources: facts, links (with status), FAQs — add / edit / enable / remove.
- A plain-language **"What your agent knows"** summary.
- A **Test Console**: type a sample customer message and instantly see the drafted reply — no WhatsApp,
  nothing sent — so the owner can verify training *before* it goes live. (This generalizes the
  prototype's brain-test.)

## Updating any time

All training is CRUD; changes take effect on the next message. Editing or re-adding a link re-runs its
pipeline. Owners can keep improving the agent whenever they want — the explicit core requirement.

## Training API

| Method & path | Does |
|---|---|
| `GET /agents/:id/training` | Returns profile + sources + the "what it knows" summary |
| `POST /agents/:id/training/learn` | `{ url }` → fetch + read the page → `{ source, suggestion }` draft (not saved) |
| `PUT /agents/:id/training/profile` | Update instructions, restrictions, tone, language, settings |
| `POST /agents/:id/training/sources` | Add a `fact` \| `link` \| `faq` |
| `PATCH /agents/:id/training/sources/:sid` | Edit / enable / disable a source |
| `DELETE /agents/:id/training/sources/:sid` | Remove a source |
| `POST /agents/:id/test` | `{ message }` → `{ draftReply }` for the Test Console |
