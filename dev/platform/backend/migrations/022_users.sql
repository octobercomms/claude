-- Real users table — replaces the single-admin env-var login.
-- The env admin (ADMIN_USERNAME / ADMIN_PASSWORD) is still authoritative for
-- the admin role; index.js upserts it into this table on every boot. Other
-- users are managed via the Manage UI by an admin.

CREATE TYPE user_role_enum AS ENUM ('admin', 'viewer');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role_enum NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Join table — viewers see only their assigned clients; admins ignore this.
CREATE TABLE user_clients (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, client_id)
);

CREATE INDEX idx_user_clients_user_id ON user_clients(user_id);
