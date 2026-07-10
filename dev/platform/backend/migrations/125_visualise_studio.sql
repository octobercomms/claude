-- Visualise — OMI's generic image generation + surgical-refinement studio.
-- New Workspace module (docs/omi/visualise-studio.md). Generic engine + presets:
-- Project → Variant → Step tree, with corrections as masked inpaint child steps,
-- lock, then faithful 4K export. Files live on local disk per client (like
-- brand_assets); these rows hold the served URLs + metadata.
--
-- Conventions matched to OMI: UUID PKs (uuid_generate_v4), client_id UUID FK,
-- jsonb for flexible schema, created_at timestamptz default now(). The §14 brief
-- schema is extended with two prompt columns (always_on_prompt, scenario_template)
-- that §10.1 requires but the indicative schema omitted.

-- ── Capability: let a read-only 'client' role user write, scoped to Visualise ──
-- §6 gotcha: the 'client' role is blocked from every non-GET at the auth layer
-- (migration 115). This per-user capability is the scoped carve-out — checked by
-- the Visualise routes + the auth middleware — so clients (e.g. lolo) can create,
-- generate, correct, lock and export in Visualise while staying read-only
-- everywhere else. Off by default; granted explicitly.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_use_visualise BOOLEAN NOT NULL DEFAULT false;

-- ── Presets — a saved recipe that lets one engine serve many verticals ────────
CREATE TABLE IF NOT EXISTS visualise_presets (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope              VARCHAR(16) NOT NULL DEFAULT 'shared',   -- shared | client
  client_id          UUID REFERENCES clients(id) ON DELETE CASCADE,  -- null for shared
  name               VARCHAR(160) NOT NULL,
  locked_core_prompt TEXT NOT NULL,          -- non-editable accuracy/brand rules (never shown as a text box)
  always_on_prompt   TEXT,                   -- appended to every generation for this preset
  scenario_template  TEXT,                   -- template for new Variants; [SCENE] filled from free text
  guided_fields      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- the simple inputs the user fills
  input_slots        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- which Input kinds this preset expects + labels
  model_routing      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- fal slugs for generate/scenario/inpaint/upscale
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visualise_presets_client ON visualise_presets(client_id);

-- ── Projects — one subject being developed (lolo: a character) ────────────────
CREATE TABLE IF NOT EXISTS visualise_projects (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  preset_id      UUID REFERENCES visualise_presets(id) ON DELETE SET NULL,
  name           VARCHAR(200) NOT NULL,
  status         VARCHAR(16) NOT NULL DEFAULT 'draft',   -- draft | in_progress | locked
  guided_values  JSONB NOT NULL DEFAULT '{}'::jsonb,     -- the user's answers to the preset's guided_fields
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visualise_projects_client ON visualise_projects(client_id, created_at DESC);

-- ── Inputs — uploaded references belonging to a Project ───────────────────────
CREATE TABLE IF NOT EXISTS visualise_inputs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES visualise_projects(id) ON DELETE CASCADE,
  kind        VARCHAR(24) NOT NULL,   -- sketch | reference_photo | note | swatch | sketch_view
  url         TEXT,                   -- served URL (null for a note)
  text        TEXT,                   -- note text (null for image kinds)
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visualise_inputs_project ON visualise_inputs(project_id);

-- ── Variants — a scenario/context branch of a Project (≥1 per Project) ────────
CREATE TABLE IF NOT EXISTS visualise_variants (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id     UUID NOT NULL REFERENCES visualise_projects(id) ON DELETE CASCADE,
  name           VARCHAR(200),        -- scenario label
  scene_prompt   TEXT,                -- free-text scenario
  active_step_id UUID,                -- the currently-carried-forward step (FK added after steps table)
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visualise_variants_project ON visualise_variants(project_id);

-- ── Steps — one node in a Variant's history: a generation or a correction ─────
-- Immutable, tree-shaped (parent_step_id) → history is revertable AND branchable.
CREATE TABLE IF NOT EXISTS visualise_steps (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id         UUID NOT NULL REFERENCES visualise_variants(id) ON DELETE CASCADE,
  parent_step_id     UUID REFERENCES visualise_steps(id) ON DELETE SET NULL,
  kind               VARCHAR(16) NOT NULL,   -- generation | correction
  image_url          TEXT,
  -- correction-only:
  mask_url           TEXT,
  instruction        TEXT,
  reference_crop_url TEXT,
  -- generation-only:
  gen_params         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { count_index, orientation, model, seed }
  cost_usd           NUMERIC(10,4),
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visualise_steps_variant ON visualise_steps(variant_id);
CREATE INDEX IF NOT EXISTS idx_visualise_steps_parent ON visualise_steps(parent_step_id);

-- active_step_id points at a step; add the FK now that the table exists.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_visualise_variants_active_step') THEN
    ALTER TABLE visualise_variants
      ADD CONSTRAINT fk_visualise_variants_active_step
      FOREIGN KEY (active_step_id) REFERENCES visualise_steps(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Exports — a locked Step run through the faithful upscaler → a 4K asset ─────
CREATE TABLE IF NOT EXISTS visualise_exports (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id    UUID NOT NULL REFERENCES visualise_variants(id) ON DELETE CASCADE,
  step_id       UUID NOT NULL REFERENCES visualise_steps(id) ON DELETE CASCADE,
  image_url_4k  TEXT,
  cost_usd      NUMERIC(10,4),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visualise_exports_variant ON visualise_exports(variant_id);

-- ── Seed preset #1 — lolo "Costume Character" (VERBATIM from brief §10.1) ──────
-- Seeded as a SHARED preset so it's available without a client_id lookup; other
-- clients simply won't pick it. locked_core_prompt / always_on_prompt /
-- scenario_template are the exact text from the brief. model_routing holds the
-- brief's representative fal slugs — subject to the §11 bake-off before the
-- generate/inpaint/upscale paths are wired live (Phases 2/4/5).
INSERT INTO visualise_presets (scope, client_id, name, locked_core_prompt, always_on_prompt, scenario_template, guided_fields, input_slots, model_routing)
SELECT 'shared', NULL, 'Costume Character',
$core$Use the uploaded sketches as the reference for the costume design and
proportions. Use the two photographs as a real life version of the costume
design.

Create a photorealistic editorial photoshoot.

Highly stylised photoshoot, fit for a fashion magazine.

The costume must exactly match the reference design: pay particular attention to
color, material, proportions, shapes.

Negative constraints

Avoid overly glossy skin
Avoid unrealistic symmetry
Avoid visible brand logos
Avoid cartoon or stylised rendering$core$,
$always$don't include any branding.
include the full body$always$,
$scene$Create another image of this character in a different scene. Do not change any of
the details they are wearing. This person works at [SCENE]. No branding.

Do not include other characters. Only the person in the reference image.

They should pose differently in each image.$scene$,
$fields$[
  {"key":"employer_context","label":"Employer / location context","type":"text","placeholder":"e.g. This person works at WB Harry Potter Tour in Abu Dhabi","inject":"line"},
  {"key":"full_body","label":"Full body","type":"toggle","default":true,"emits":"include the full body"},
  {"key":"no_branding","label":"No branding","type":"toggle","default":true,"locked":true,"emits":"don't include any branding"}
]$fields$::jsonb,
$slots$[
  {"kind":"sketch","label":"Costume sketch","primary":true,"required":true},
  {"kind":"sketch_view","label":"Second sketch view (shapes / details)","required":false},
  {"kind":"reference_photo","label":"Reference photograph (real-life version)","min":1,"max":2},
  {"kind":"swatch","label":"Colour / material swatch","required":false},
  {"kind":"note","label":"Notes / measurements","required":false}
]$slots$::jsonb,
$routing${
  "generate":"fal-ai/nano-banana-pro",
  "scenario":"fal-ai/nano-banana-pro",
  "inpaint":"fal-ai/flux-pro/v1/fill",
  "upscale":"fal-ai/clarity-upscaler"
}$routing$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM visualise_presets WHERE scope = 'shared' AND name = 'Costume Character');
