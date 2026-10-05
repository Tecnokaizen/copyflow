begin;
-- A locked commercial document and its conversion must keep the same client.
-- Operational service/assignee updates remain available. New draft versions
-- restore editable client association without changing historical snapshots.
create function public.tg_quote_locked_client_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.client_id is distinct from old.client_id and exists (
    select 1 from public.quote_versions v
    where v.id=old.current_version_id and v.tenant_id=old.tenant_id
      and v.quote_id=old.id and v.state in ('prepared','sent')
  ) then
    raise exception 'locked_quote_client' using errcode='55000';
  end if;
  return new;
end $$;
create trigger quotes_locked_client before update on public.quotes
for each row execute function public.tg_quote_locked_client_v1();
revoke all on function public.tg_quote_locked_client_v1()
  from public,anon,authenticated,service_role;
commit;
