-- Give client chat more than one thread per client. The AI Data Analyst uses
-- the default 'analyst' thread; the Strategist chat (ask-the-strategist,
-- grounded in the latest cross-PESO briefing) uses 'strategist'. Same agent and
-- tools, separate conversation history.
ALTER TABLE client_chat_messages ADD COLUMN IF NOT EXISTS thread TEXT NOT NULL DEFAULT 'analyst';
CREATE INDEX IF NOT EXISTS idx_client_chat_thread
  ON client_chat_messages (client_id, thread, created_at);
