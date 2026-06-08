-- Distinguish "we deliberately didn't send a report because no recipients are
-- configured" from a genuine successful send. Previously both showed as 'sent',
-- which hid mis-configured clients (a report_recipients.weekly/monthly that was
-- never filled in looked identical to a delivered report). PR #421 follow-up.
--
-- ALTER TYPE ... ADD VALUE runs in-transaction on PostgreSQL 12+; the value is
-- only used at runtime, not within this migration.
ALTER TYPE report_status_enum ADD VALUE IF NOT EXISTS 'skipped_no_recipients';
