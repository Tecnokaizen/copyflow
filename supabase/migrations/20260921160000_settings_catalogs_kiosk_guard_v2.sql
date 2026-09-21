-- Settings V1 · remove generic GUC bypass from entry_channels kiosk guard.
-- Authenticated sessions cannot opt into Kiosk via any session setting.
-- Privileged maintenance/seeds still work when current_user <> 'authenticated'
-- (e.g. postgres). Future dedicated Kiosk RPCs must use a controlled,
-- non-authenticated execution context — not a mutable GUC.

begin;

create or replace function public.tg_entry_channels_kiosk_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- Only constrain PostgREST / Settings sessions running as `authenticated`.
  if current_user is distinct from 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(new.code, ''))) = 'kiosk' then
      raise exception 'kiosk_channel_reserved'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(old.code, ''))) = 'kiosk'
       and new.active is distinct from old.active then
      raise exception 'kiosk_channel_active_immutable'
        using errcode = '42501';
    end if;
    return new;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

comment on function public.tg_entry_channels_kiosk_guard() is
  'Blocks authenticated-role inserts of code=kiosk and authenticated-role active flips on kiosk. No session GUC bypass. Privileged paths must run as a non-authenticated DB role.';

commit;
