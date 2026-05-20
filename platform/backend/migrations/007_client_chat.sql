CREATE TABLE IF NOT EXISTS client_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_chat_client_id ON client_chat_messages(client_id);
CREATE INDEX IF NOT EXISTS idx_client_chat_created_at ON client_chat_messages(created_at);
