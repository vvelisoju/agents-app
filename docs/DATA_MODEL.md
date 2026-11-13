# Data model

PostgreSQL. Every tenant row carries `org_id`; **row-level security** isolates tenants.
Vector columns use the `pgvector` extension (added when RAG lands — see TRAINING.md).

### organizations
`id`, `name`, `created_at`

### users
`id`, `org_id`, `email` (unique), `password_hash`, `role` (`owner` | `member`), `created_at`

### subscriptions — *stubbed in Phase 1*
`id`, `org_id`, `plan` (`free` | `starter` | `growth`), `status` (`active` | `trialing` | `none`),
`limits` (jsonb: `max_agents`, `max_messages`), `provider` (null | `razorpay`), `provider_ref`, `created_at`
- Phase 1: every new org gets a `free`/`active` row with generous limits. Razorpay fills `provider*` later.

### agents
`id`, `org_id`, `name`, `channel_type` (`whatsapp-web`; others later), `status`
(`draft` | `connecting` | `connected` | `disconnected`), `auto_send` (bool, default false), `created_at`
- One agent = one channel instance (one WhatsApp number).

### channel_sessions — WhatsApp auth state (one per agent)
`id`, `agent_id`, `status` (`pending_qr` | `connecting` | `connected` | `auth_failed` | `disconnected`),
`auth_blob` (**encrypted**; whatsapp-web.js RemoteAuth state), `phone_number`, `last_connected_at`, `updated_at`

### training_profiles — one per agent (the always-on behaviour)
`id`, `agent_id`, `instructions` (text), `restrictions` (text), `tone` (text), `language` (text),
`escalation_keyword` (default `NEEDS_HUMAN`), `updated_at`

### training_sources — many per agent
`id`, `agent_id`, `type` (`fact` | `link` | `faq`), `enabled` (bool), `created_at`, `updated_at`, plus by type:
- `fact`: `content` (text)
- `link`: `url`, `fetch_status` (`queued` | `processing` | `ready` | `failed`), `extracted_text`
- `faq`: `question`, `answer`

### training_chunks — for RAG (Phase 2)
`id`, `source_id`, `agent_id`, `content` (text), `embedding` (vector), `created_at`

### conversations
`id`, `agent_id`, `org_id`, `contact_number`, `contact_name`, `last_message_at`

### messages
`id`, `conversation_id`, `agent_id`, `direction` (`inbound` | `outbound`), `body`,
`status` (`received` | `draft` | `sent` | `skipped` | `needs_human`), `created_at`

### usage_events
`id`, `org_id`, `agent_id`, `type` (`reply`), `tokens_in`, `tokens_out`, `created_at`

**Indexes:** `org_id` and `agent_id` on all tenant tables; a pgvector index on `training_chunks.embedding`.
**Encryption:** `channel_sessions.auth_blob` and any future OAuth tokens are encrypted at rest.
