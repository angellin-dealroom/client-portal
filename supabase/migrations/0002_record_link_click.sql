-- =========================================================
-- record_link_click RPC
-- Runs with elevated privileges (SECURITY DEFINER) but
-- validates the caller itself: the caller's JWT email must
-- match the client who owns the link (or be the admin).
-- Bumps project_links.status from 'pending' -> 'viewed' and
-- inserts an activity_log row.
-- =========================================================

create or replace function public.record_link_click(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text;
  the_link  public.project_links%rowtype;
  the_client public.clients%rowtype;
begin
  caller_email := auth.jwt() ->> 'email';

  if caller_email is null or caller_email = '' then
    raise exception 'Not authenticated';
  end if;

  select * into the_link
    from public.project_links
   where id = p_link_id;
  if not found then
    raise exception 'Link not found';
  end if;

  select * into the_client
    from public.clients
   where id = the_link.client_id;
  if not found then
    raise exception 'Client not found';
  end if;

  if the_client.email <> caller_email and not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if the_link.status = 'pending' then
    update public.project_links
       set status = 'viewed'
     where id = p_link_id;
  end if;

  insert into public.activity_log (client_id, action, metadata)
  values (
    the_client.id,
    'viewed_link',
    jsonb_build_object(
      'link_id',   p_link_id,
      'link_type', the_link.link_type,
      'url',       the_link.url
    )
  );
end;
$$;

-- Restrict callers: only logged-in users can invoke.
revoke all on function public.record_link_click(uuid) from public;
grant execute on function public.record_link_click(uuid) to authenticated;
