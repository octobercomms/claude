-- AS IF — initial seed. Run once after schema.sql.

INSERT INTO locations (name) VALUES ('London'), ('Margate');

INSERT INTO settings (`key`, `value`) VALUES
  ('effort_baseline', 'smart'),   -- everyday floor: never below Smart (SCOPE §11/§1)
  ('units',           'metric'),
  ('briefing_day',    '1')        -- day of month for the monthly briefing
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
