-- Read-only client logins. A 'client' role user is scoped to their own client
-- (via user_clients, same as a viewer) but is additionally blocked from every
-- non-GET request at the auth layer — so they can browse their account in full
-- but can never mutate data or spend AI credits (all generation is POST).
--
-- ADD VALUE is safe inside the migration runner's transaction on PG 12+ as long
-- as the new value isn't USED in the same transaction — it isn't here.
ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'client';
