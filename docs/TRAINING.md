# Agent training — the heart of the product

> **Source of truth: the code. Last reconciled 2026-11-14.** (PXD-17)
> Corrected from an earlier draft that said retrieval used **pgvector**. The shipped RAG path is
> **in-process cosine over JSON-array embeddings with a keyword fallback — _not_ pgvector** (pgvector
> is deferred). Details in [§How retrieval (RAG) actually works](#how-retrieval-rag-actually-works).
> Source files: `server/src/lib/training.ts`, `learn.ts`, `knowledge.ts`, `embeddings.ts`, `pdf.ts`,
> `templates.ts`, and the `training`/`knowledge` routes in `server/src/modules/agents/router.ts`.

A non-technical business owner must be able to make their agent reply well, **see exactly what it
knows**, and **change it any time** — no code, no redeploy. This is the most important feature.

## What a user can provide

| Input | Stored as | Example |
|---|---|---|
| Instructions | `TrainingProfile.instructions` | "Greet warmly, keep replies short, always offer a free tour." |
| Restrictions | `TrainingProfile.restrictions` | "Never quote a final price. Never promise delivery dates." |
| Facts | `TrainingSource` (`fact`) | "Open desk from ₹3,999/month." |
| Links | `TrainingSource` (`link`) | website, Google Drive folder, menu page |
| FAQs | `TrainingSource` (`faq`) | Q: "Do you allow 24/7 access?" A: "Cabins do…" |
| Documents | `KnowledgeChunk` rows (via PDF upload) | a brochure / price list PDF, chunked for retrieval |
| Settings | `TrainingProfile` + `Agent` | tone, language, auto-send on/off, escalation keyword |

## Train from a link (the default, no-typing way to set up)

Most owners should never have to type their business into the agent. The primary onboarding:
**paste a link you already have — your website, Google Business profile, Instagram or Facebook page —
and the agent reads it for you.**

Pipeline (`lib/learn.ts`, endpoint `POST /api/agents/:id/training/learn`):
1. **Fetch** the URL (browser-like UA, timeout, follows redirects; guarded against SSRF).
2. **Extract** readable text + `<title>`/`og:`/meta description (scripts, styles, markup stripped).
3. **Condense** with Claude (Haiku) into a confirmable draft: `instructions`, `tone`, `language`,
   `facts[]`, `faqs[]`, `links[]` — strictly faithful to the page (never invents prices/offers).
4. **Confirm**: the UI pre-fills the instruction fields and lists found knowledge as items the owner
   keeps or removes, then **"Add these to the agent"** saves the profile + chosen sources in one click.

Nothing is saved by the learn step itself — it returns a draft. The owner's confirmation persists it
through the normal profile + sources endpoints, so everything stays editable afterwards. Pages that need
a login or render purely via JavaScript may return little; the UI says so and the owner can paste a
different link or add a couple of facts by hand.

## Train from a document (PDF upload)

`POST /api/agents/:id/training/learn-document` accepts a **PDF** (raw bytes, ≤15 MB; `%PDF-` magic
checked). `lib/pdf.ts` (pdf-parse, pure Node — no Chromium) extracts the text, which is then:
1. **Condensed** into the same confirmable draft shape as the link path (shared `lib/learn.ts` condenser), and
2. **Chunked and stored** as `KnowledgeChunk` rows via `ingestChunks()` for retrieval (below).

Scanned/image-only PDFs yield little text and are rejected with a friendly message.

## How training becomes behaviour

On every inbound message the reply engine:
1. Loads the agent's `TrainingProfile` + enabled `TrainingSource`s from the DB.
2. Composes a **system prompt** = instructions + restrictions + tone/language + facts + FAQs (small
   training stays **inline** — cheaper and simpler).
3. Calls Claude (Haiku by default; `AGENT_MODEL` overrides), applies share-link placeholders
   (`{{LINK:Name}}`), and returns the reply or a draft.

In **agentic mode** (opt-in: `executionMode='agentic'` + enabled tools) the model can additionally call
the **`knowledge.search`** tool to pull document chunks on demand (see below). In the default reply mode,
retrieval is not in the inline path.

**Immediate effect.** Training is read per message, so an edit applies to the very next message. There is
no "retrain" or "redeploy" step — the agent is always live with its current training.

## How retrieval (RAG) actually works

> **Not pgvector.** Embeddings are stored as a **JSON float array** in the `KnowledgeChunk.embeddingJson`
> column and similarity is computed **in-process**. This is fine for the small per-tenant knowledge bases
> in scope; pgvector is a deferred option if a KB ever outgrows that. (`lib/knowledge.ts`, `lib/embeddings.ts`.)

- **Chunking** — `chunkText()` splits a document's text into ~700-char windows with ~120-char overlap
  (capped at 300 chunks). A re-ingest of the same `(agent, sourceLabel)` replaces its chunks.
- **Embeddings are pluggable and optional** — provider is chosen by `EMBEDDINGS_PROVIDER` + that
  provider's API key: **voyage** (`voyage-3`), **openai** (`text-embedding-3-small`), or **cohere**
  (`embed-english-v3.0`), overridable via `EMBEDDINGS_MODEL`. When **no provider is configured**
  (the default), chunks are stored with a `null` vector.
- **Search** (`searchChunks`) returns top-k with the **same contract** either way:
  - **Vector cosine** when a provider is configured **and** chunks have vectors — `cosineSim()` in JS.
  - **Keyword fallback** otherwise — ranks chunks by how many query terms they contain. So RAG works
    with **zero config**, and turning on a provider is a key change, not a code change.
- **Reindex** — after first configuring a provider, `POST /api/agents/:id/training/knowledge/reindex`
  embeds the agent's existing keyword-only chunks so they gain vectors without re-uploading.
- **`knowledge.search` tool** — in agentic mode, first searches document chunks, then falls back to the
  agent's facts/FAQs. Document ingestion is currently wired for the **PDF upload** path; link training
  still stores condensed facts rather than chunks.

## Viewing the training (must be easy)

A **Training** screen per agent shows:
- Instructions, restrictions, tone/language — editable inline.
- All sources: facts, links, FAQs — add / edit / enable / remove.
- **Knowledge status** — chunk/embedded counts + the active embeddings provider
  (`GET /api/agents/:id/training/knowledge`).
- A plain-language **"What your agent knows"** summary.
- A **Test Console**: type a sample customer message and instantly see the drafted reply — nothing sent —
  so the owner can verify training *before* it goes live.

## Updating any time

All training is CRUD; changes take effect on the next message. Owners can keep improving the agent
whenever they want — the explicit core requirement.

## Training API

| Method & path | Does |
|---|---|
| `GET /api/agents/:id/training` | Returns profile + sources + the "what it knows" summary |
| `POST /api/agents/:id/training/learn` | `{ url }` → fetch + read the page → `{ source, suggestion }` draft (not saved) |
| `POST /api/agents/:id/training/learn-document` | PDF bytes → extract + condense + chunk → draft (chunks stored) |
| `GET /api/agents/:id/training/knowledge` | Chunk/embedded counts + embeddings-provider status |
| `POST /api/agents/:id/training/knowledge/reindex` | Embed existing chunks after a provider is first configured |
| `PUT /api/agents/:id/training/profile` | Update instructions, restrictions, tone, language, settings |
| `POST /api/agents/:id/training/sources` | Add a `fact` \| `link` \| `faq` |
| `PATCH /api/agents/:id/training/sources/:sid` | Edit / enable / disable a source |
| `DELETE /api/agents/:id/training/sources/:sid` | Remove a source |
| `POST /api/agents/:id/test` | `{ message }` → `{ draftReply }` for the Test Console |

---

**See also:** [ARCHITECTURE.md](ARCHITECTURE.md) · [EXTENDING.md](EXTENDING.md) (tool registry) ·
[DATA_MODEL.md](DATA_MODEL.md) (`KnowledgeChunk`) · [CONNECTORS.md](CONNECTORS.md)
