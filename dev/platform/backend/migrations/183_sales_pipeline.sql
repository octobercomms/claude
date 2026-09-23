-- Sales pipeline + proposal engine (docs/omi/sales-pipeline.md).
-- Builds on Snapshot Studio: a snapshot_lead is the pipeline record from the
-- homepage report through to sign-up. Proposals hang off a lead; the proof
-- library feeds per-prospect matching; views give section-level engagement
-- for the decay alerts.

-- Report gate + call stage fields on the lead.
ALTER TABLE snapshot_leads ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE snapshot_leads ADD COLUMN IF NOT EXISTS referral_source TEXT;
ALTER TABLE snapshot_leads ADD COLUMN IF NOT EXISTS call_at TIMESTAMPTZ;          -- scheduled call time
ALTER TABLE snapshot_leads ADD COLUMN IF NOT EXISTS call_booked_at TIMESTAMPTZ;   -- when the booking was recorded
ALTER TABLE snapshot_leads ADD COLUMN IF NOT EXISTS call_brief JSONB;             -- pre-call talking points
ALTER TABLE snapshot_leads ADD COLUMN IF NOT EXISTS call_notes TEXT;              -- notes / Meet transcript excerpt
ALTER TABLE snapshot_leads ADD COLUMN IF NOT EXISTS nudge_sent_at TIMESTAMPTZ;    -- the one Stage 2 nudge

-- Proof library: case studies, testimonials, credentials, press lines. Tagged
-- by sector and by the problem they evidence, so a proposal picks the proof
-- that answers THIS prospect's gap rather than a fixed default.
CREATE TABLE IF NOT EXISTS proof_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind VARCHAR(16) NOT NULL,                 -- case_study | testimonial | credential | press
  title TEXT NOT NULL,                       -- client / project / credential name
  body TEXT NOT NULL,                        -- the quote, summary or credential line
  attribution TEXT,                          -- who said it / outcome line
  sector_tags TEXT[] NOT NULL DEFAULT '{}',  -- architecture, interiors, furniture, retail, hospitality, property, culture, ...
  problem_tags TEXT[] NOT NULL DEFAULT '{}', -- press, search, ai, social, content, positioning, leads, ecommerce, paid, trust
  url TEXT,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proof_items_kind ON proof_items(kind) WHERE active;

CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES snapshot_leads(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  -- draft → sent → viewed → replied | accepted | lost
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  recipient_email TEXT,
  recipient_names TEXT,                      -- "Shaun, Craig and Debbie"
  content JSONB NOT NULL DEFAULT '{}',       -- the drafted proposal body
  matched JSONB NOT NULL DEFAULT '{}',       -- chosen proof ids + why each was chosen
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  first_opened_at TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ,
  open_count INT NOT NULL DEFAULT 0,
  replied_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  accepted_name TEXT,
  accepted_package TEXT,
  lost_reason TEXT,
  -- Decay alerts fire once each; the stamp is the dedupe.
  alert_unopened_at TIMESTAMPTZ,
  alert_opened_at TIMESTAMPTZ,
  alert_cooling_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proposals_lead ON proposals(lead_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);

-- One row per viewing session (a browser tab). Section dwell is accumulated
-- from heartbeats: { "situation": 42, "pricing": 18, ... } in seconds.
CREATE TABLE IF NOT EXISTS proposal_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '{}',
  user_agent TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_ping_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_id, session_key)
);
CREATE INDEX IF NOT EXISTS idx_proposal_views_proposal ON proposal_views(proposal_id, started_at);

-- Seed the proof already used in proposals (ROAR, Sept 2026) so matching has
-- something to pick from on day one. Tags are a first pass; refine in
-- Settings → Biz dev → Proof library. Case studies are left for October to add.
INSERT INTO proof_items (kind, title, body, attribution, sector_tags, problem_tags)
SELECT * FROM (VALUES
  ('testimonial', 'Case Furniture',
   'We worked closely with October Communications on PR, Blogger outreach, eCommerce & SEO and saw a great ROI. We can highly recommend October Communications.',
   'Case Furniture', ARRAY['furniture','retail','design'], ARRAY['press','search','ecommerce']),
  ('testimonial', 'Rabih Geha Architects',
   'We have had the opportunity to work with the wonderful team at October Communications; people are great, the work is fruitful, the communication is easy and most importantly they deliver!',
   'Rabih Geha Architects', ARRAY['architecture','interiors'], ARRAY['press','positioning']),
  ('testimonial', 'Scenario Architecture',
   'We have been working with October for over a year now on various aspects of our branding and digital marketing such as content writing, SEO, PPC campaigns, press and social media. Daniel and the team are great professionals to collaborate with, they are responsive, creative and always open to exploring new ideas together.',
   'Scenario Architecture', ARRAY['architecture','interiors','residential'], ARRAY['press','search','content','social','paid','positioning']),
  ('testimonial', 'Shamsian',
   'Enjoyed meeting Daniel, getting his sound advice on the content of our new site, what worked and didn''t work. Extremely professional service, very quick to respond and with immediate results.',
   'Shamsian', ARRAY['property','design'], ARRAY['content','positioning','leads']),
  ('testimonial', 'Falcon Enamelware',
   'Daniel and the team at October Communications are my ''go to'' source for digital marketing. The strategic advice is excellent and execution is also first class.',
   'Falcon Enamelware', ARRAY['retail','homeware','design'], ARRAY['search','ecommerce','paid','social']),
  ('credential', 'Fellow of the RSA',
   'Our director has been a Fellow of the Royal Society for the encouragement of Arts, Manufactures and Commerce since 2012.',
   NULL, ARRAY['culture','design','architecture'], ARRAY['trust']),
  ('credential', 'Friend of the RIBA',
   'Part of the RIBA community of architects and designers; we attend its events and exhibitions regularly.',
   NULL, ARRAY['architecture','interiors','residential'], ARRAY['trust','press']),
  ('credential', 'Archiboo Awards finalist',
   'Shortlisted for Best Digital Team at the Archiboo Awards, which recognise digital performance in architecture.',
   NULL, ARRAY['architecture','interiors'], ARRAY['search','ai','content','social']),
  ('credential', 'International Building Press member',
   'Members of the IBP, which brings together journalists and communications professionals across construction, architecture, housing and property.',
   NULL, ARRAY['architecture','property','construction','residential'], ARRAY['press'])
) AS v(kind, title, body, attribution, sector_tags, problem_tags)
WHERE NOT EXISTS (SELECT 1 FROM proof_items);
