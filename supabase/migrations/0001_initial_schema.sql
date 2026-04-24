-- =========================================================
-- Client Portal — Initial Schema
-- Run this once in the Supabase SQL Editor.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Enums (fixed lists of allowed values)
-- ---------------------------------------------------------
create type client_stage as enum (
  'discovery',
  'proposal',
  'contract',
  'onboarding',
  'active',
  'churned'
);

create type link_type as enum (
  'proposal',
  'contract',
  'payment',
  'kickoff',
  'onboarding'
);

create type link_status as enum (
  'pending',
  'viewed',
  'completed'
);

-- ---------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------
create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  name        text not null,
  company     text,
  stage       client_stage not null default 'discovery',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.project_links (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  link_type   link_type not null,
  url         text,
  status      link_status not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (client_id, link_type)
);

create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  action      text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index on public.project_links (client_id);
create index on public.activity_log (client_id);
create index on public.activity_log (created_at desc);

-- ---------------------------------------------------------
-- 3. Auto-update `updated_at` on row changes
-- ---------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

create trigger set_project_links_updated_at
  before update on public.project_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------
-- 4. Admin helper (hardcoded email — change here if needed)
-- ---------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'angel.lin@dealroom.media'
$$;

-- ---------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------
alter table public.clients       enable row level security;
alter table public.project_links enable row level security;
alter table public.activity_log  enable row level security;

-- clients: a logged-in client sees own row; admin sees/edits everything
create policy "clients_select_own_or_admin"
  on public.clients
  for select
  using (
    auth.jwt() ->> 'email' = email
    or public.is_admin()
  );

create policy "clients_admin_write"
  on public.clients
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- project_links: client sees links for their client row; admin full access
create policy "project_links_select_own_or_admin"
  on public.project_links
  for select
  using (
    exists (
      select 1 from public.clients c
      where c.id = project_links.client_id
        and c.email = auth.jwt() ->> 'email'
    )
    or public.is_admin()
  );

create policy "project_links_admin_write"
  on public.project_links
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- activity_log: admin only for now.
-- (Client-click logging will happen via a server-side API route
--  using the service role key, which bypasses RLS server-side.)
create policy "activity_log_admin_all"
  on public.activity_log
  for all
  using (public.is_admin())
  with check (public.is_admin());
