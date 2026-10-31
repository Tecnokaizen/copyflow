-- Rollback for 20261028120000_order_notes_v1.sql (SUR4 E5 · order post-its).
--
-- Removes order_notes, order_note_versions, order_note_events, their guards,
-- the purge trigger on orders, the five RPCs and the helpers, the three A1
-- features (and any override granted for them), and restores
-- tg_activity_log_order_content exactly as in 20260919180000.
--
-- It REFUSES to run when it would lose data: any post-it, version or event.
-- Post-its are history; there is no opt-in to discard them. Legacy notes moved
-- with «Pasar a post-it» are NOT put back into orders.notes by this script.
-- It does not delete order.note_* / order.legacy_notes_converted rows from
-- activity_log (history, without text).
-- Then: supabase migration repair --status reverted 20261028120000
begin;

do $guard$
begin
  if exists (select 1 from public.order_notes)
     or exists (select 1 from public.order_note_versions)
     or exists (select 1 from public.order_note_events) then
    raise exception 'rollback refused: post-its still have rows';
  end if;
end
$guard$;

drop trigger if exists trg_orders_purge_notes on public.orders;

drop function public.redact_order_note_v1(uuid, text, uuid[], boolean);
drop function public.convert_order_legacy_notes_v1(uuid, text);
drop function public.set_order_note_state_v1(uuid, text, text);
drop function public.update_order_note_v1(uuid, text, text, text, boolean);
drop function public.create_order_note_v1(uuid, text, text, boolean, uuid, boolean);
drop function public.order_note_log_v1(public.order_notes, text, text, uuid, text, jsonb, jsonb, uuid, uuid, text, jsonb);
drop function public.order_note_json_v1(public.order_notes);
drop function public.order_note_snapshot_v1(public.order_notes);
drop function public.order_note_actor_name_v1(uuid, uuid);
drop function public.order_note_body_valid_v1(text);
drop function public.order_note_plain_length_v1(text);

drop table public.order_note_events;
alter table public.order_notes drop constraint order_notes_current_version_fk;
drop table public.order_note_versions;
drop table public.order_notes;

drop function public.tg_orders_purge_notes_v1();
drop function public.tg_order_notes_refuse_truncate_v1();
drop function public.tg_order_note_events_guard_v1();
drop function public.tg_order_note_versions_guard_v1();
drop function public.tg_order_notes_guard_v1();

delete from public.tenant_feature_overrides o
using public.features f
where o.feature_id = f.id
  and f.code in ('order_sticky_notes', 'order_custom_labels', 'order_work_sheet_ficha');
delete from public.features
where code in ('order_sticky_notes', 'order_custom_labels', 'order_work_sheet_ficha');

-- tg_activity_log_order_content as in 20260919180000 (no marker check).
CREATE OR REPLACE FUNCTION public.tg_activity_log_order_content()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot change with order content'
      using errcode = '42501';
  end if;

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    new.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  if old.title is distinct from new.title then
    insert into public.activity_log (
      tenant_id, user_id, team_member_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null, 'order.content_changed', 'order', new.id,
      pg_catalog.jsonb_build_object('value', old.title),
      pg_catalog.jsonb_build_object('value', new.title),
      pg_catalog.jsonb_build_object('reference', new.reference, 'field', 'title')
    );
  end if;

  if old.description is distinct from new.description then
    insert into public.activity_log (
      tenant_id, user_id, team_member_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null, 'order.content_changed', 'order', new.id,
      pg_catalog.jsonb_build_object('value', old.description),
      pg_catalog.jsonb_build_object('value', new.description),
      pg_catalog.jsonb_build_object('reference', new.reference, 'field', 'description')
    );
  end if;

  if old.notes is distinct from new.notes then
    insert into public.activity_log (
      tenant_id, user_id, team_member_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null, 'order.content_changed', 'order', new.id,
      pg_catalog.jsonb_build_object('value', old.notes),
      pg_catalog.jsonb_build_object('value', new.notes),
      pg_catalog.jsonb_build_object('reference', new.reference, 'field', 'notes')
    );
  end if;

  if old.external_folder_url is distinct from new.external_folder_url then
    insert into public.activity_log (
      tenant_id, user_id, team_member_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null, 'order.content_changed', 'order', new.id,
      pg_catalog.jsonb_build_object('value', old.external_folder_url),
      pg_catalog.jsonb_build_object('value', new.external_folder_url),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'external_folder_url'
      )
    );
  end if;

  return new;
end;
$function$;

commit;
