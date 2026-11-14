# Data connectors — configuring database & API access

Let agents answer from, and act on, your live business data (a leads DB, an orders API, …) **safely**.
Pairs with [SECURITY.md](SECURITY.md).

## The safety model (read this first)

**The model never writes SQL or chooses URLs.** You, the owner, define named, parameterized
**operations**; the agent can only pick an operation by name and supply parameter *values*, which are
bound positionally. So an agent can never inject SQL, reach a table you didn't expose, or hit an
endpoint you didn't define. Writes additionally require your approval before they run.

## Setup (dashboard → **Connectors**)

1. **Add a connection.** Pick a kind and paste its secret (encrypted at rest, never shown again):
   - **PostgreSQL:** `postgres://user:pass@host:5432/dbname`
   - **MySQL:** `mysql://user:pass@host:3306/dbname`
   - **REST API:** JSON — `{"baseUrl":"https://api.example.com","headers":{"Authorization":"Bearer …"}}`
   Use **Test** to verify it connects.
2. **Define operations.** For each thing an agent may do, add an operation:
   - **name** — what the agent calls, e.g. `get_lead_by_phone` (letters/numbers/underscores).
   - **description** — shown to the model so it knows when to use it.
   - **access** — `customer` (any customer-facing agent) or `admin` (only agents you set to admin access).
   - **read / write** — read runs immediately; **write needs your approval** each time.
   - **SQL** (DB) with positional params: `SELECT name, status FROM leads WHERE phone = $1` (Postgres) /
     `… WHERE phone = ?` (MySQL). **REST**: method + path with `{name}` placeholders, e.g. `GET /orders/{id}`.
   - **param names** in order — e.g. `phone`, or `id, status`. Path params are URL-encoded; other REST
     params become the JSON body.
3. **Enable it on an agent.** In the agent's **Abilities** tab, turn on **data.query** (reads) and/or
   **data.action** (writes). The agent is then told which operations exist and can call them.

## Examples (your use cases)

| Goal | Operation |
|---|---|
| Look up a lead | `get_lead_by_phone` · read · `SELECT name, status, note FROM leads WHERE phone = $1` · param `phone` |
| Update a lead's status | `set_lead_status` · **write** · `UPDATE leads SET status = $2 WHERE phone = $1` · params `phone, status` |
| Check stock via your API | `check_stock` · read · REST `GET /inventory/{sku}` · param `sku` |

A customer chatting with the agent ("what's the status of my enquiry?") triggers `get_lead_by_phone`;
"mark me as not interested" triggers `set_lead_status`, which **waits in Approvals** until you approve.

## Limits & safety

- Reads are capped at 100 rows; queries time out at 10s (`CONNECTOR_TIMEOUT_MS`).
- Writes are approval-gated (Approvals inbox) — nothing changes your data without your OK.
- `admin` operations only run for agents whose access is set to `admin`; customer-facing agents can't
  reach them. Keep destructive queries behind `admin` + `write`.
- Secrets are AES-256-GCM encrypted and never returned by the API or logged. Scope the DB user to the
  least privilege the operations need (e.g. a read-only role for read ops).
