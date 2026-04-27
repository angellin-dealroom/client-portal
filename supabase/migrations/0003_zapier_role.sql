-- =========================================================
-- Zapier Postgres role
-- =========================================================
-- Dedicated login role for Zapier's PostgreSQL connector. Supabase
-- has no first-party Zapier app, so we point Zapier's PostgreSQL
-- connector at Supabase's underlying Postgres directly.
--
-- BYPASSRLS lets the role read/write tables that have RLS enabled
-- (clients, project_links, activity_log) without needing JWT context.
-- Narrowed grants below restrict it to the three tables we actually
-- need; no DELETE grants on any table.
--
-- BEFORE RUNNING:
--   1. Generate a strong password locally:
--        openssl rand -base64 32
--   2. Replace the placeholder below with that password.
--   3. Save the password in your password manager — you'll paste it
--      into Zapier's PostgreSQL connection.
--   4. NEVER commit the real password back to this file.
--
-- TO ROTATE LATER:
--   alter role zapier with password 'NEW-PASSWORD';
--   then update the Zapier connection.
-- =========================================================

create role zapier with login bypassrls password 'REPLACE-WITH-STRONG-PASSWORD';

grant usage on schema public to zapier;

grant select, insert, update on public.clients       to zapier;
grant select, insert, update on public.project_links to zapier;
grant select, insert         on public.activity_log  to zapier;
