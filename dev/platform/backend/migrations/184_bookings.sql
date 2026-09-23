-- Book-a-call (docs/omi/booking.md). October's own booking widget on
-- octobercomms.com: live availability from Daniel's Google Calendar, a Google
-- Meet event created on booking, and the booking written straight onto the
-- pipeline lead so the call brief is ready before the call.

-- Single-row availability config. JSON so new rules don't need a migration.
CREATE TABLE IF NOT EXISTS booking_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO booking_settings (id, config) VALUES (1, '{}') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES snapshot_leads(id) ON DELETE SET NULL,
  manage_token TEXT NOT NULL UNIQUE,
  -- confirmed | cancelled
  status VARCHAR(16) NOT NULL DEFAULT 'confirmed',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  timezone TEXT,                         -- the visitor's zone, for their emails
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  website TEXT,
  answers JSONB NOT NULL DEFAULT '{}',   -- qualifying answers (goal, budget, referral)
  calendar_event_id TEXT,
  meet_url TEXT,
  cancelled_at TIMESTAMPTZ,
  reschedule_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_at) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_bookings_lead ON bookings(lead_id);
