# legacy/ — archived earlier generations (reference only)

These are **not the product** and are not imported by `server/` or `client/`. They are kept
for reference and git history. The live product is **`server/`** (Express + Prisma API) and
**`client/`** (React + Vite web app). See [docs/architecture/](../docs/architecture/).

| Folder | What it was | Status |
|---|---|---|
| `agents/` | The original single-tenant **CLI** WhatsApp bot (hardcoded Secure Studio persona, terminal approve/edit/skip). | Archived. Still runnable via `npm run whatsapp` (now points here). |
| `platform/` | An intermediate **single-file** multi-tenant skeleton (email auth, hand-rolled SQLite, own WS hub/engine). | Archived. Superseded by `server/`. |
| `shared/` | The prototype's shared `askClaude` helper (used only by `agents/`). | Archived. |

Do not add new features here. New work goes in `server/` + `client/` behind the seams
documented in `docs/architecture/`. (FND-01)
