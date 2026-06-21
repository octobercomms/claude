-- Re-author the seeded strategy library to the SOSTAC framework. Remove the
-- previous (non-SOSTAC) seed rows; services/strategyTemplates.ensureSeeded then
-- re-installs the SOSTAC seeds on next use. Clients already assigned keep their
-- own snapshot (client_strategy), and admin-authored templates (is_seed = false)
-- are untouched.

DELETE FROM strategy_templates WHERE is_seed = TRUE;
