-- Add tools_used column to chat messages
ALTER TABLE client_chat_messages ADD COLUMN IF NOT EXISTS tools_used JSONB DEFAULT '[]';

-- Context log for decisions, investigations, pending items, observations
CREATE TABLE IF NOT EXISTS client_context_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('decision', 'investigation', 'pending', 'observation')),
  content TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_context_log_client_id ON client_context_log(client_id);
CREATE INDEX IF NOT EXISTS idx_context_log_status ON client_context_log(status);
