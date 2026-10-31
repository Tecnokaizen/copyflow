-- SUR4 E5 · Order post-its (ADR SUR4-01, contract docs/SUR4-FICHA-POSTITS-CONTRATO.md §7).
--
-- Adds three append-friendly tables and five write RPCs:
--   * public.order_notes          one row per post-it: author, state, visibility,
--                                 printable authorization, pin and addressee.
--   * public.order_note_versions  the text of every version. The only place,
--                                 with order_notes.body, where post-it text lives.
--   * public.order_note_events    append-only history, without text. Points at
--                                 the versions before and after each change.
-- Registers three A1 features, all born off (no plan includes them, no override
-- is created): order_sticky_notes, order_custom_labels, order_work_sheet_ficha.
--
-- Access
--   * authenticated: SELECT only, with RLS is_tenant_member AND the feature
--     order_sticky_notes. No direct writes: a row trigger demands the
--     transaction-local marker gestcopy.order_notes_write = '1' (NULL = denied),
--     which only the SECURITY DEFINER RPCs below set.
--   * Without the feature every RPC answers not_found to authenticated, like
--     quotes. Only the operator (service_role) can redact in a tenant without it.
--   * Emptying text (versions and note) and replacing flagged reasons with
--     «[motivo suprimido]» needs a second marker, gestcopy.order_notes_redact,
--     that only redact_order_note_v1 sets (N22).
--
-- Concurrency: post-its never touch orders.row_version (N5), except
-- convert_order_legacy_notes_v1, which empties orders.notes. Creating locks the
-- order FOR SHARE (archive_order uses FOR UPDATE) plus a per-order advisory lock
-- for the 200-notes limit. Editing demands the note's own row_version. Pin,
-- unpin, resolve, reopen and void are idempotent.
--
-- R5: the RPCs are SECURITY DEFINER owned by postgres, so tg_orders_write_guard
-- lets their single UPDATE of orders through. They do not mention app.order_write
-- (release gate invariant 7c keeps that marker to SECURITY INVOKER writers).
--
-- Activity: one activity_log row per event, never with text or reasons (T9).
-- tg_activity_log_order_content skips its notes branch while
-- gestcopy.order_notes_write is set, so «Pasar a post-it» does not copy the
-- legacy text into the activity (it logs order.legacy_notes_converted instead).
--
-- Not touched: orders columns, kiosk, convert_quote_to_order,
-- change_order_content_v2 (they keep writing orders.notes, N7), existing RPC
-- signatures and answers.
-- Rollback: supabase/rollbacks/20261028120000_order_notes_v1.sql
begin;

do $precondition$
begin
  if pg_catalog.to_regprocedure('public.tg_orders_write_guard()') is null then
    raise exception 'SUR4 E5 requires R5 (20261022120000_order_direct_write_guard_v1)';
  end if;
  if pg_catalog.to_regprocedure('public.team_member_is_assignable(uuid,uuid)') is null then
    raise exception 'SUR4 E5 requires R6 (20261022130000_assignee_eligibility_v1)';
  end if;
  if pg_catalog.to_regprocedure('public.tenant_has_feature(uuid,text)') is null then
    raise exception 'SUR4 E5 requires A1 (public.tenant_has_feature)';
  end if;
  if exists (
    select 1
    from public.features f
    where f.id in (
        '31000000-0000-4000-8000-000000000011',
        '31000000-0000-4000-8000-000000000012',
        '31000000-0000-4000-8000-000000000013'
      )
      and f.code not in ('order_sticky_notes', 'order_custom_labels', 'order_work_sheet_ficha')
  ) then
    raise exception 'SUR4 E5: feature ids 011-013 are already used by other codes';
  end if;
end
$precondition$;

-- ---------------------------------------------------------------------------
-- 1. A1 features (born off)
-- ---------------------------------------------------------------------------
insert into public.features (id, code, name, description)
values
  (
    '31000000-0000-4000-8000-000000000011',
    'order_sticky_notes',
    'Post-its del pedido',
    'Notas del pedido con autor, estados, visibilidad imprimible e historial.'
  ),
  (
    '31000000-0000-4000-8000-000000000012',
    'order_custom_labels',
    'Etiquetas propias de la ficha',
    'Nombres propios de los importes y de la descripción en la ficha y los documentos.'
  ),
  (
    '31000000-0000-4000-8000-000000000013',
    'order_work_sheet_ficha',
    'Hoja de trabajo con el reparto de la ficha',
    'Perfil ficha de la Hoja de trabajo impresa.'
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = pg_catalog.now();

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  body text,
  visibility text not null default 'internal',
  state text not null default 'open',
  pinned boolean not null default false,
  addressee_team_member_id uuid,
  author_user_id uuid not null,
  author_name text not null,
  row_version bigint not null default 1,
  current_version_id uuid not null,
  printable_authorized_by uuid,
  printable_authorized_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  resolved_at timestamptz,
  resolved_by uuid,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  redacted_at timestamptz,
  redacted_by uuid,
  constraint order_notes_tenant_id_unique unique (tenant_id, id),
  constraint order_notes_order_fk
    foreign key (tenant_id, order_id) references public.orders (tenant_id, id),
  constraint order_notes_addressee_fk
    foreign key (tenant_id, addressee_team_member_id) references public.team_members (tenant_id, id),
  constraint order_notes_author_membership_fk
    foreign key (tenant_id, author_user_id) references public.memberships (tenant_id, user_id) on delete restrict,
  constraint order_notes_printable_by_membership_fk
    foreign key (tenant_id, printable_authorized_by) references public.memberships (tenant_id, user_id) on delete restrict,
  constraint order_notes_resolved_by_membership_fk
    foreign key (tenant_id, resolved_by) references public.memberships (tenant_id, user_id) on delete restrict,
  constraint order_notes_voided_by_membership_fk
    foreign key (tenant_id, voided_by) references public.memberships (tenant_id, user_id) on delete restrict,
  constraint order_notes_redacted_by_membership_fk
    foreign key (tenant_id, redacted_by) references public.memberships (tenant_id, user_id) on delete restrict,
  constraint order_notes_visibility_check check (visibility in ('internal', 'printable')),
  constraint order_notes_state_check check (state in ('open', 'resolved', 'voided')),
  -- N18: no printable note without the account and the time of its authorization.
  constraint order_notes_printable_authorized check (
    (visibility = 'printable' and printable_authorized_by is not null and printable_authorized_at is not null)
    or (visibility = 'internal' and printable_authorized_by is null and printable_authorized_at is null)
  ),
  constraint order_notes_pinned_open check (not pinned or state = 'open'),
  constraint order_notes_resolved_trace check (
    (state <> 'resolved' or resolved_at is not null) and (state <> 'open' or resolved_at is null)
  ),
  constraint order_notes_voided_trace check (
    (state = 'voided') = (voided_at is not null)
    and (state <> 'voided' or void_reason is not null)
  ),
  constraint order_notes_void_reason_length check (
    void_reason is null or pg_catalog.char_length(void_reason) between 1 and 500
  ),
  -- N22: text is only ever emptied by a redaction, which leaves the note internal and voided.
  constraint order_notes_body_redacted check ((body is null) = (redacted_at is not null)),
  constraint order_notes_redacted_internal check (
    redacted_at is null or (visibility = 'internal' and state = 'voided' and not pinned)
  ),
  constraint order_notes_body_length check (body is null or pg_catalog.char_length(body) <= 20000),
  constraint order_notes_author_name_length check (pg_catalog.char_length(author_name) between 1 and 200),
  constraint order_notes_row_version_positive check (row_version > 0)
);

comment on table public.order_notes is
  'SUR4 E5 post-its. One row per note; text also lives in order_note_versions. SELECT with RLS (member + order_sticky_notes); written only by the order note RPCs.';

create index order_notes_order_idx on public.order_notes (tenant_id, order_id, created_at);
create index order_notes_author_idx on public.order_notes (tenant_id, author_user_id);

create table public.order_note_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  note_id uuid not null,
  version integer not null,
  body text,
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid not null,
  redacted_at timestamptz,
  redacted_by uuid,
  constraint order_note_versions_tenant_id_unique unique (tenant_id, id),
  constraint order_note_versions_number_unique unique (tenant_id, note_id, version),
  constraint order_note_versions_note_fk
    foreign key (tenant_id, note_id) references public.order_notes (tenant_id, id),
  constraint order_note_versions_created_by_membership_fk
    foreign key (tenant_id, created_by) references public.memberships (tenant_id, user_id) on delete restrict,
  constraint order_note_versions_redacted_by_membership_fk
    foreign key (tenant_id, redacted_by) references public.memberships (tenant_id, user_id) on delete restrict,
  constraint order_note_versions_number_positive check (version > 0),
  constraint order_note_versions_body_redacted check ((body is null) = (redacted_at is not null)),
  constraint order_note_versions_body_length check (body is null or pg_catalog.char_length(body) <= 20000)
);

comment on table public.order_note_versions is
  'Text of every version of a post-it. body only goes to NULL through redact_order_note_v1 (gestcopy.order_notes_redact).';

create index order_note_versions_created_by_idx on public.order_note_versions (tenant_id, created_by);

-- The note points at its current version; checked at commit so a note and its
-- first version can be inserted, and purged, in one transaction.
alter table public.order_notes
  add constraint order_notes_current_version_fk
    foreign key (tenant_id, current_version_id) references public.order_note_versions (tenant_id, id)
    deferrable initially deferred;

create table public.order_note_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  note_id uuid not null,
  action text not null,
  actor_user_id uuid,
  actor_name text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  before jsonb,
  after jsonb,
  version_before_id uuid,
  version_after_id uuid,
  reason text,
  constraint order_note_events_order_fk
    foreign key (tenant_id, order_id) references public.orders (tenant_id, id),
  constraint order_note_events_note_fk
    foreign key (tenant_id, note_id) references public.order_notes (tenant_id, id),
  constraint order_note_events_actor_membership_fk
    foreign key (tenant_id, actor_user_id) references public.memberships (tenant_id, user_id) on delete restrict,
  constraint order_note_events_version_before_fk
    foreign key (tenant_id, version_before_id) references public.order_note_versions (tenant_id, id),
  constraint order_note_events_version_after_fk
    foreign key (tenant_id, version_after_id) references public.order_note_versions (tenant_id, id),
  constraint order_note_events_action_check check (action in (
    'created', 'edited', 'printable_authorized', 'made_internal', 'pinned', 'unpinned',
    'resolved', 'reopened', 'voided', 'converted_from_legacy', 'redacted'
  )),
  -- Only the operator (service_role) redacts without an account.
  constraint order_note_events_actor_present check (actor_user_id is not null or action = 'redacted'),
  constraint order_note_events_actor_name_length check (pg_catalog.char_length(actor_name) between 1 and 200),
  constraint order_note_events_reason_length check (reason is null or pg_catalog.char_length(reason) between 1 and 500),
  constraint order_note_events_before_object check (before is null or pg_catalog.jsonb_typeof(before) = 'object'),
  constraint order_note_events_after_object check (after is null or pg_catalog.jsonb_typeof(after) = 'object')
);

comment on table public.order_note_events is
  'Append-only history of post-its, without text. The only later write is replacing a reason flagged by redact_order_note_v1 with «[motivo suprimido]».';

create index order_note_events_note_idx on public.order_note_events (tenant_id, note_id, created_at);
create index order_note_events_order_idx on public.order_note_events (tenant_id, order_id, created_at);
create index order_note_events_actor_idx on public.order_note_events (tenant_id, actor_user_id);

-- RLS: members of the tenant, and only while the feature is granted.
alter table public.order_notes enable row level security;
alter table public.order_note_versions enable row level security;
alter table public.order_note_events enable row level security;

create policy order_notes_select_member
  on public.order_notes
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id) and public.tenant_has_feature(tenant_id, 'order_sticky_notes'));

create policy order_note_versions_select_member
  on public.order_note_versions
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id) and public.tenant_has_feature(tenant_id, 'order_sticky_notes'));

create policy order_note_events_select_member
  on public.order_note_events
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id) and public.tenant_has_feature(tenant_id, 'order_sticky_notes'));

revoke all on public.order_notes from public, anon, authenticated, service_role;
revoke all on public.order_note_versions from public, anon, authenticated, service_role;
revoke all on public.order_note_events from public, anon, authenticated, service_role;
grant select on public.order_notes to authenticated;
grant select on public.order_note_versions to authenticated;
grant select on public.order_note_events to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Row guards
-- ---------------------------------------------------------------------------
create or replace function public.tg_order_notes_guard_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_write boolean := coalesce(pg_catalog.current_setting('gestcopy.order_notes_write', true), '') = '1';
  v_redact boolean := coalesce(pg_catalog.current_setting('gestcopy.order_notes_redact', true), '') = '1';
  v_archived timestamptz;
begin
  if tg_op = 'DELETE' then
    if coalesce(pg_catalog.current_setting('gestcopy.order_notes_purge', true), '') = '1' then
      return old;
    end if;
    raise exception 'order_notes_rpc_only'
      using errcode = '42501';
  end if;

  if not v_write and not v_redact then
    raise exception 'order_notes_rpc_only'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.redacted_at is not null or new.redacted_by is not null then
      raise exception 'order_notes_redact_only'
        using errcode = '42501';
    end if;
  else
    if (new.id, new.tenant_id, new.order_id, new.author_user_id, new.author_name, new.created_at)
       is distinct from (old.id, old.tenant_id, old.order_id, old.author_user_id, old.author_name, old.created_at) then
      raise exception 'immutable_identity'
        using errcode = '55000';
    end if;

    if not v_redact
       and (
         (new.body is null and old.body is not null)
         or new.redacted_at is distinct from old.redacted_at
         or new.redacted_by is distinct from old.redacted_by
       ) then
      raise exception 'order_notes_redact_only'
        using errcode = '42501';
    end if;

    -- Redacted text never comes back.
    if old.redacted_at is not null and new.body is not null then
      raise exception 'order_notes_redacted'
        using errcode = '55000';
    end if;
  end if;

  -- A redaction also runs on archived orders (personal data requests).
  if not v_redact then
    select o.archived_at
      into v_archived
    from public.orders o
    where o.tenant_id = new.tenant_id
      and o.id = new.order_id;

    if not found then
      raise exception 'order_not_found'
        using errcode = 'P0002';
    end if;

    if v_archived is not null then
      raise exception 'order_archived'
        using errcode = '55000';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_order_notes_guard on public.order_notes;
create trigger trg_order_notes_guard
  before insert or update or delete on public.order_notes
  for each row
  execute function public.tg_order_notes_guard_v1();

create or replace function public.tg_order_note_versions_guard_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    if coalesce(pg_catalog.current_setting('gestcopy.order_notes_purge', true), '') = '1' then
      return old;
    end if;
    raise exception 'order_note_versions_rpc_only'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(pg_catalog.current_setting('gestcopy.order_notes_write', true), '') <> '1' then
      raise exception 'order_note_versions_rpc_only'
        using errcode = '42501';
    end if;
    if new.redacted_at is not null or new.redacted_by is not null then
      raise exception 'order_notes_redact_only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE: only a redaction, and only emptying the text.
  if coalesce(pg_catalog.current_setting('gestcopy.order_notes_redact', true), '') <> '1' then
    raise exception 'order_notes_redact_only'
      using errcode = '42501';
  end if;

  if (new.id, new.tenant_id, new.note_id, new.version, new.created_at, new.created_by)
       is distinct from (old.id, old.tenant_id, old.note_id, old.version, old.created_at, old.created_by)
     or new.body is not null
     or old.body is null
     or new.redacted_at is null then
    raise exception 'order_note_versions_immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_order_note_versions_guard on public.order_note_versions;
create trigger trg_order_note_versions_guard
  before insert or update or delete on public.order_note_versions
  for each row
  execute function public.tg_order_note_versions_guard_v1();

create or replace function public.tg_order_note_events_guard_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_redact boolean := coalesce(pg_catalog.current_setting('gestcopy.order_notes_redact', true), '') = '1';
  v_archived timestamptz;
begin
  if tg_op = 'DELETE' then
    if coalesce(pg_catalog.current_setting('gestcopy.order_notes_purge', true), '') = '1' then
      return old;
    end if;
    raise exception 'order_note_events_append_only'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- The only later write: a reason flagged by a redaction.
    if not v_redact
       or (new.id, new.tenant_id, new.order_id, new.note_id, new.action, new.actor_user_id,
           new.actor_name, new.created_at, new.before, new.after, new.version_before_id, new.version_after_id)
          is distinct from
          (old.id, old.tenant_id, old.order_id, old.note_id, old.action, old.actor_user_id,
           old.actor_name, old.created_at, old.before, old.after, old.version_before_id, old.version_after_id)
       or old.reason is null
       or new.reason is distinct from '[motivo suprimido]' then
      raise exception 'order_note_events_append_only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if coalesce(pg_catalog.current_setting('gestcopy.order_notes_write', true), '') <> '1' and not v_redact then
    raise exception 'order_note_events_append_only'
      using errcode = '42501';
  end if;

  if not v_redact then
    select o.archived_at
      into v_archived
    from public.orders o
    where o.tenant_id = new.tenant_id
      and o.id = new.order_id;

    if not found then
      raise exception 'order_not_found'
        using errcode = 'P0002';
    end if;

    if v_archived is not null then
      raise exception 'order_archived'
        using errcode = '55000';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_order_note_events_guard on public.order_note_events;
create trigger trg_order_note_events_guard
  before insert or update or delete on public.order_note_events
  for each row
  execute function public.tg_order_note_events_guard_v1();

create or replace function public.tg_order_notes_refuse_truncate_v1()
  returns trigger
  language plpgsql
  set search_path to ''
as $function$
begin
  raise exception 'order_notes_append_only'
    using errcode = '42501';
end;
$function$;

drop trigger if exists trg_order_notes_refuse_truncate on public.order_notes;
create trigger trg_order_notes_refuse_truncate
  before truncate on public.order_notes
  for each statement
  execute function public.tg_order_notes_refuse_truncate_v1();

drop trigger if exists trg_order_note_versions_refuse_truncate on public.order_note_versions;
create trigger trg_order_note_versions_refuse_truncate
  before truncate on public.order_note_versions
  for each statement
  execute function public.tg_order_notes_refuse_truncate_v1();

drop trigger if exists trg_order_note_events_refuse_truncate on public.order_note_events;
create trigger trg_order_note_events_refuse_truncate
  before truncate on public.order_note_events
  for each statement
  execute function public.tg_order_notes_refuse_truncate_v1();

-- Deleting the order itself (tenant removal, admin) purges its post-its, like its lines.
create or replace function public.tg_orders_purge_notes_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  perform pg_catalog.set_config('gestcopy.order_notes_purge', '1', true);
  delete from public.order_note_events
  where tenant_id = old.tenant_id
    and order_id = old.id;
  delete from public.order_note_versions v
  using public.order_notes n
  where n.tenant_id = old.tenant_id
    and n.order_id = old.id
    and v.tenant_id = n.tenant_id
    and v.note_id = n.id;
  delete from public.order_notes
  where tenant_id = old.tenant_id
    and order_id = old.id;
  perform pg_catalog.set_config('gestcopy.order_notes_purge', '', true);
  return old;
end;
$function$;

drop trigger if exists trg_orders_purge_notes on public.orders;
create trigger trg_orders_purge_notes
  before delete on public.orders
  for each row
  execute function public.tg_orders_purge_notes_v1();

-- ---------------------------------------------------------------------------
-- 4. «Pasar a post-it» must not copy the legacy text into the activity.
--    Same function as 20260919180000, plus the marker check on the notes branch.
-- ---------------------------------------------------------------------------
create or replace function public.tg_activity_log_order_content()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
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

  -- convert_order_legacy_notes_v1 logs order.legacy_notes_converted, without text.
  if old.notes is distinct from new.notes
     and coalesce(pg_catalog.current_setting('gestcopy.order_notes_write', true), '') <> '1' then
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

-- ---------------------------------------------------------------------------
-- 5. Internal helpers (no API role can execute them)
-- ---------------------------------------------------------------------------
-- Visible characters of a rich text body: tags removed, entities count as one.
create or replace function public.order_note_plain_length_v1(p_body text)
  returns integer
  language sql
  immutable
  set search_path to ''
as $function$
  select pg_catalog.char_length(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(coalesce(p_body, ''), '<[^>]*>', '', 'g'),
          '&(nbsp|#160|#xa0);', ' ', 'gi'
        ),
        '&(#[0-9]+|#x[0-9a-f]+|[a-z]+);', 'x', 'gi'
      ),
      E' \t\r\n'
    )
  );
$function$;

create or replace function public.order_note_body_valid_v1(p_body text)
  returns boolean
  language sql
  immutable
  set search_path to ''
as $function$
  select p_body is not null
    and pg_catalog.char_length(p_body) <= 20000
    and public.order_note_plain_length_v1(p_body) between 1 and 4000;
$function$;

-- The author's name at the time: their person in the team, else their profile.
create or replace function public.order_note_actor_name_v1(p_tenant_id uuid, p_user_id uuid)
  returns text
  language sql
  stable
  set search_path to ''
as $function$
  select pg_catalog.left(coalesce(
    (
      select nullif(pg_catalog.btrim(tm.name), '')
      from public.team_members tm
      where tm.tenant_id = p_tenant_id
        and tm.user_id = p_user_id
      order by tm.active desc, tm.created_at
      limit 1
    ),
    (
      select nullif(pg_catalog.btrim(p.full_name), '')
      from public.profiles p
      where p.id = p_user_id
    ),
    'Usuario'
  ), 200);
$function$;

-- What events and activity keep of a note: never its text.
create or replace function public.order_note_snapshot_v1(p_note public.order_notes)
  returns jsonb
  language sql
  immutable
  set search_path to ''
as $function$
  select pg_catalog.jsonb_build_object(
    'visibility', p_note.visibility,
    'state', p_note.state,
    'pinned', p_note.pinned,
    'addressee_team_member_id', p_note.addressee_team_member_id,
    'row_version', p_note.row_version::text
  );
$function$;

create or replace function public.order_note_json_v1(p_note public.order_notes)
  returns jsonb
  language sql
  immutable
  set search_path to ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', p_note.id,
    'order_id', p_note.order_id,
    'body', p_note.body,
    'visibility', p_note.visibility,
    'state', p_note.state,
    'pinned', p_note.pinned,
    'addressee_team_member_id', p_note.addressee_team_member_id,
    'author_user_id', p_note.author_user_id,
    'author_name', p_note.author_name,
    'row_version', p_note.row_version::text,
    'current_version_id', p_note.current_version_id,
    'printable_authorized_by', p_note.printable_authorized_by,
    'printable_authorized_at', p_note.printable_authorized_at,
    'created_at', p_note.created_at,
    'updated_at', p_note.updated_at,
    'resolved_at', p_note.resolved_at,
    'resolved_by', p_note.resolved_by,
    'voided_at', p_note.voided_at,
    'voided_by', p_note.voided_by,
    'void_reason', p_note.void_reason,
    'redacted_at', p_note.redacted_at
  );
$function$;

-- One event and one activity row, without text. The caller holds the marker.
create or replace function public.order_note_log_v1(
  p_note public.order_notes,
  p_reference text,
  p_action text,
  p_actor uuid,
  p_actor_name text,
  p_before jsonb,
  p_after jsonb,
  p_version_before uuid,
  p_version_after uuid,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
  returns uuid
  language plpgsql
  set search_path to ''
as $function$
declare
  v_event uuid;
begin
  insert into public.order_note_events (
    tenant_id, order_id, note_id, action, actor_user_id, actor_name,
    before, after, version_before_id, version_after_id, reason
  )
  values (
    p_note.tenant_id, p_note.order_id, p_note.id, p_action, p_actor, p_actor_name,
    p_before, p_after, p_version_before, p_version_after, p_reason
  )
  returning id into v_event;

  insert into public.activity_log (
    tenant_id, user_id, team_member_id, action, entity_type, entity_id,
    previous_values, new_values, metadata
  )
  values (
    p_note.tenant_id,
    p_actor,
    null,
    case p_action
      when 'converted_from_legacy' then 'order.legacy_notes_converted'
      else 'order.note_' || p_action
    end,
    'order',
    p_note.order_id,
    p_before,
    p_after,
    pg_catalog.jsonb_build_object(
      'reference', p_reference,
      'note_id', p_note.id,
      'event_id', v_event
    ) || coalesce(p_metadata, '{}'::jsonb)
  );

  return v_event;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. create_order_note_v1
-- ---------------------------------------------------------------------------
create or replace function public.create_order_note_v1(
  p_order_id uuid,
  p_body text,
  p_visibility text default 'internal',
  p_pinned boolean default false,
  p_addressee uuid default null,
  p_confirm_printable boolean default false
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_note public.order_notes%rowtype;
  v_visibility text := coalesce(p_visibility, 'internal');
  v_note_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
  v_name text;
  v_count integer;
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or p_order_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- FOR SHARE: archive_order takes FOR UPDATE, so no note slips in after archiving.
  select *
    into v_order
  from public.orders
  where id = p_order_id
  for share;

  if not found
     or not public.is_tenant_member(v_order.tenant_id)
     or not public.tenant_has_feature(v_order.tenant_id, 'order_sticky_notes') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.has_tenant_role(v_order.tenant_id, array['owner', 'admin', 'manager', 'staff']::text[]) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_order.archived_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'order_archived');
  end if;

  if not public.order_note_body_valid_v1(p_body) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_body');
  end if;

  if v_visibility not in ('internal', 'printable') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_visibility');
  end if;

  if v_visibility = 'printable' and p_confirm_printable is not true then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'printable_confirmation_required');
  end if;

  if p_addressee is not null then
    perform 1
    from public.team_members tm
    where tm.tenant_id = v_order.tenant_id
      and tm.id = p_addressee
      and tm.active
    for share;

    if not found then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'addressee_unavailable');
    end if;
  end if;

  -- One writer at a time per order for the 200-notes limit; readers are not blocked.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gestcopy.order_notes:' || v_order.id::text, 0)
  );

  select pg_catalog.count(*)
    into v_count
  from public.order_notes n
  where n.tenant_id = v_order.tenant_id
    and n.order_id = v_order.id;

  if v_count >= 200 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'too_many_notes');
  end if;

  v_name := public.order_note_actor_name_v1(v_order.tenant_id, v_actor);

  perform pg_catalog.set_config('gestcopy.order_notes_write', '1', true);

  insert into public.order_notes (
    id, tenant_id, order_id, body, visibility, state, pinned, addressee_team_member_id,
    author_user_id, author_name, current_version_id,
    printable_authorized_by, printable_authorized_at, created_at, updated_at
  )
  values (
    v_note_id, v_order.tenant_id, v_order.id, p_body, v_visibility, 'open', coalesce(p_pinned, false), p_addressee,
    v_actor, v_name, v_version_id,
    case when v_visibility = 'printable' then v_actor end,
    case when v_visibility = 'printable' then v_now end,
    v_now, v_now
  )
  returning * into v_note;

  insert into public.order_note_versions (id, tenant_id, note_id, version, body, created_at, created_by)
  values (v_version_id, v_order.tenant_id, v_note_id, 1, p_body, v_now, v_actor);

  perform public.order_note_log_v1(
    v_note, v_order.reference, 'created', v_actor, v_name,
    null, public.order_note_snapshot_v1(v_note), null, v_version_id, null
  );

  if v_visibility = 'printable' then
    perform public.order_note_log_v1(
      v_note, v_order.reference, 'printable_authorized', v_actor, v_name,
      null, public.order_note_snapshot_v1(v_note), null, v_version_id, null
    );
  end if;

  perform pg_catalog.set_config('gestcopy.order_notes_write', '', true);

  return pg_catalog.jsonb_build_object('ok', true, 'changed', true, 'note', public.order_note_json_v1(v_note));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. update_order_note_v1 (N4: only the author, only open notes)
-- ---------------------------------------------------------------------------
create or replace function public.update_order_note_v1(
  p_note_id uuid,
  p_expected_row_version text,
  p_body text default null,
  p_visibility text default null,
  p_confirm_printable boolean default false
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_note public.order_notes%rowtype;
  v_before jsonb;
  v_previous_version uuid;
  v_version_id uuid;
  v_next integer;
  v_body text;
  v_visibility text;
  v_body_changed boolean;
  v_visibility_changed boolean;
  v_authorize boolean;
  v_name text;
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or p_note_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select n.tenant_id, n.order_id
    into v_tenant, v_order_id
  from public.order_notes n
  where n.id = p_note_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_order
  from public.orders
  where tenant_id = v_tenant
    and id = v_order_id
  for share;

  if not found
     or not public.is_tenant_member(v_tenant)
     or not public.tenant_has_feature(v_tenant, 'order_sticky_notes') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_note
  from public.order_notes
  where id = p_note_id
  for update;

  if not public.has_tenant_role(v_tenant, array['owner', 'admin', 'manager', 'staff']::text[]) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_order.archived_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'order_archived');
  end if;

  if v_note.author_user_id is distinct from v_actor or v_note.state <> 'open' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_expected_row_version is null
     or p_expected_row_version !~ '^[0-9]+$'
     or v_note.row_version::text is distinct from p_expected_row_version then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'conflict', 'row_version', v_note.row_version::text
    );
  end if;

  if p_body is not null and not public.order_note_body_valid_v1(p_body) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_body');
  end if;

  v_body := coalesce(p_body, v_note.body);
  v_visibility := coalesce(p_visibility, v_note.visibility);

  if v_visibility not in ('internal', 'printable') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_visibility');
  end if;

  v_body_changed := v_body is distinct from v_note.body;
  v_visibility_changed := v_visibility is distinct from v_note.visibility;

  if not v_body_changed and not v_visibility_changed then
    return pg_catalog.jsonb_build_object('ok', true, 'changed', false, 'note', public.order_note_json_v1(v_note));
  end if;

  -- Making a note printable, or editing the text of a printable one, needs a confirmation.
  v_authorize := v_visibility = 'printable' and (v_visibility_changed or v_body_changed);

  if v_authorize and p_confirm_printable is not true then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'printable_confirmation_required');
  end if;

  v_before := public.order_note_snapshot_v1(v_note);
  v_previous_version := v_note.current_version_id;
  v_version_id := v_note.current_version_id;
  v_name := public.order_note_actor_name_v1(v_tenant, v_actor);

  perform pg_catalog.set_config('gestcopy.order_notes_write', '1', true);

  if v_body_changed then
    select coalesce(pg_catalog.max(v.version), 0) + 1
      into v_next
    from public.order_note_versions v
    where v.tenant_id = v_tenant
      and v.note_id = v_note.id;

    v_version_id := gen_random_uuid();

    insert into public.order_note_versions (id, tenant_id, note_id, version, body, created_at, created_by)
    values (v_version_id, v_tenant, v_note.id, v_next, v_body, v_now, v_actor);
  end if;

  update public.order_notes
  set
    body = v_body,
    current_version_id = v_version_id,
    visibility = v_visibility,
    printable_authorized_by = case
      when v_visibility = 'internal' then null
      when v_authorize then v_actor
      else printable_authorized_by
    end,
    printable_authorized_at = case
      when v_visibility = 'internal' then null
      when v_authorize then v_now
      else printable_authorized_at
    end,
    row_version = row_version + 1,
    updated_at = v_now
  where id = v_note.id
  returning * into v_note;

  if v_body_changed then
    perform public.order_note_log_v1(
      v_note, v_order.reference, 'edited', v_actor, v_name,
      v_before, public.order_note_snapshot_v1(v_note), v_previous_version, v_version_id, null
    );
  end if;

  if v_authorize then
    perform public.order_note_log_v1(
      v_note, v_order.reference, 'printable_authorized', v_actor, v_name,
      v_before, public.order_note_snapshot_v1(v_note), v_previous_version, v_version_id, null
    );
  elsif v_visibility_changed then
    perform public.order_note_log_v1(
      v_note, v_order.reference, 'made_internal', v_actor, v_name,
      v_before, public.order_note_snapshot_v1(v_note), v_previous_version, v_version_id, null
    );
  end if;

  perform pg_catalog.set_config('gestcopy.order_notes_write', '', true);

  return pg_catalog.jsonb_build_object('ok', true, 'changed', true, 'note', public.order_note_json_v1(v_note));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. set_order_note_state_v1: pin, unpin, resolve, reopen, void (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.set_order_note_state_v1(
  p_note_id uuid,
  p_action text,
  p_reason text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_note public.order_notes%rowtype;
  v_before jsonb;
  v_event text;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_name text;
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or p_note_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select n.tenant_id, n.order_id
    into v_tenant, v_order_id
  from public.order_notes n
  where n.id = p_note_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_order
  from public.orders
  where tenant_id = v_tenant
    and id = v_order_id
  for share;

  if not found
     or not public.is_tenant_member(v_tenant)
     or not public.tenant_has_feature(v_tenant, 'order_sticky_notes') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_note
  from public.order_notes
  where id = p_note_id
  for update;

  if not public.has_tenant_role(v_tenant, array['owner', 'admin', 'manager', 'staff']::text[]) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_order.archived_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'order_archived');
  end if;

  if p_action is null or p_action not in ('pin', 'unpin', 'resolve', 'reopen', 'void') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_action');
  end if;

  if p_action = 'void' then
    -- N4: the author, or owner, admin and manager.
    if v_note.author_user_id is distinct from v_actor
       and not public.has_tenant_role(v_tenant, array['owner', 'admin', 'manager']::text[]) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    if v_note.state = 'voided' then
      return pg_catalog.jsonb_build_object('ok', true, 'changed', false, 'note', public.order_note_json_v1(v_note));
    end if;

    if v_reason is null then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'reason_required');
    end if;
  elsif v_note.state = 'voided' then
    -- Voided is final.
    return pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'conflict', 'row_version', v_note.row_version::text
    );
  end if;

  -- Optional for the other actions (kept in the event); required to void.
  if pg_catalog.char_length(v_reason) > 500 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  if (p_action = 'pin' and v_note.pinned)
     or (p_action = 'unpin' and not v_note.pinned)
     or (p_action = 'resolve' and v_note.state = 'resolved')
     or (p_action = 'reopen' and v_note.state = 'open') then
    return pg_catalog.jsonb_build_object('ok', true, 'changed', false, 'note', public.order_note_json_v1(v_note));
  end if;

  if p_action = 'pin' and v_note.state <> 'open' then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'conflict', 'row_version', v_note.row_version::text
    );
  end if;

  v_before := public.order_note_snapshot_v1(v_note);
  v_name := public.order_note_actor_name_v1(v_tenant, v_actor);

  perform pg_catalog.set_config('gestcopy.order_notes_write', '1', true);

  update public.order_notes
  set
    pinned = case
      when p_action = 'pin' then true
      when p_action in ('unpin', 'resolve', 'void') then false
      else pinned
    end,
    state = case
      when p_action = 'resolve' then 'resolved'
      when p_action = 'reopen' then 'open'
      when p_action = 'void' then 'voided'
      else state
    end,
    resolved_at = case
      when p_action = 'resolve' then v_now
      when p_action = 'reopen' then null
      else resolved_at
    end,
    resolved_by = case
      when p_action = 'resolve' then v_actor
      when p_action = 'reopen' then null
      else resolved_by
    end,
    voided_at = case when p_action = 'void' then v_now else voided_at end,
    voided_by = case when p_action = 'void' then v_actor else voided_by end,
    void_reason = case when p_action = 'void' then v_reason else void_reason end,
    row_version = row_version + 1,
    updated_at = v_now
  where id = v_note.id
  returning * into v_note;

  v_event := case p_action
    when 'pin' then 'pinned'
    when 'unpin' then 'unpinned'
    when 'resolve' then 'resolved'
    when 'reopen' then 'reopened'
    else 'voided'
  end;

  perform public.order_note_log_v1(
    v_note, v_order.reference, v_event, v_actor, v_name,
    v_before, public.order_note_snapshot_v1(v_note), null, null, v_reason
  );

  perform pg_catalog.set_config('gestcopy.order_notes_write', '', true);

  return pg_catalog.jsonb_build_object('ok', true, 'changed', true, 'note', public.order_note_json_v1(v_note));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. convert_order_legacy_notes_v1: «Pasar a post-it», all or nothing
-- ---------------------------------------------------------------------------
create or replace function public.convert_order_legacy_notes_v1(
  p_order_id uuid,
  p_expected_row_version text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_note public.order_notes%rowtype;
  v_note_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
  v_name text;
  v_count integer;
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or p_order_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found
     or not public.is_tenant_member(v_order.tenant_id)
     or not public.tenant_has_feature(v_order.tenant_id, 'order_sticky_notes') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.has_tenant_role(v_order.tenant_id, array['owner', 'admin', 'manager', 'staff']::text[]) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_order.archived_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'order_archived');
  end if;

  if p_expected_row_version is null
     or p_expected_row_version !~ '^[0-9]+$'
     or v_order.row_version::text is distinct from p_expected_row_version then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'conflict', 'row_version', v_order.row_version::text
    );
  end if;

  if v_order.notes is null or public.order_note_plain_length_v1(v_order.notes) = 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_legacy_notes');
  end if;

  if not public.order_note_body_valid_v1(v_order.notes) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_body');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gestcopy.order_notes:' || v_order.id::text, 0)
  );

  select pg_catalog.count(*)
    into v_count
  from public.order_notes n
  where n.tenant_id = v_order.tenant_id
    and n.order_id = v_order.id;

  if v_count >= 200 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'too_many_notes');
  end if;

  v_name := public.order_note_actor_name_v1(v_order.tenant_id, v_actor);

  perform pg_catalog.set_config('gestcopy.order_notes_write', '1', true);

  -- First the note, its version and its event; only then empty orders.notes.
  insert into public.order_notes (
    id, tenant_id, order_id, body, visibility, state, pinned,
    author_user_id, author_name, current_version_id, created_at, updated_at
  )
  values (
    v_note_id, v_order.tenant_id, v_order.id, v_order.notes, 'internal', 'open', false,
    v_actor, v_name, v_version_id, v_now, v_now
  )
  returning * into v_note;

  insert into public.order_note_versions (id, tenant_id, note_id, version, body, created_at, created_by)
  values (v_version_id, v_order.tenant_id, v_note_id, 1, v_order.notes, v_now, v_actor);

  perform public.order_note_log_v1(
    v_note, v_order.reference, 'converted_from_legacy', v_actor, v_name,
    null, public.order_note_snapshot_v1(v_note), null, v_version_id, null
  );

  -- orders_bump_row_version raises row_version once. The content activity
  -- trigger skips notes while the marker is set: no text is copied.
  update public.orders
  set notes = null
  where tenant_id = v_order.tenant_id
    and id = v_order.id
  returning * into v_updated;

  if not found then
    raise exception 'could not convert legacy notes';
  end if;

  perform pg_catalog.set_config('gestcopy.order_notes_write', '', true);

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'changed', true,
    'note', public.order_note_json_v1(v_note),
    'version', v_updated.row_version::text
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10. redact_order_note_v1 (N22): owner with the feature, or the operator
-- ---------------------------------------------------------------------------
create or replace function public.redact_order_note_v1(
  p_note_id uuid,
  p_reason_code text,
  p_reason_event_ids uuid[] default null,
  p_confirm boolean default false
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_operator boolean := coalesce(auth.role(), '') = 'service_role';
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_note public.order_notes%rowtype;
  v_ids uuid[];
  v_before jsonb;
  v_pending_versions integer;
  v_pending_reasons integer;
  v_versions integer := 0;
  v_reasons integer := 0;
  v_void_flagged boolean;
  v_name text;
  v_now timestamptz := pg_catalog.now();
begin
  if p_note_id is null or (not v_operator and v_actor is null) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_operator then
    v_actor := null;
  end if;

  select n.tenant_id, n.order_id
    into v_tenant, v_order_id
  from public.order_notes n
  where n.id = p_note_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_order
  from public.orders
  where tenant_id = v_tenant
    and id = v_order_id
  for share;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not v_operator then
    if not public.is_tenant_member(v_tenant)
       or not public.tenant_has_feature(v_tenant, 'order_sticky_notes') then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    if not public.has_tenant_role(v_tenant, array['owner']::text[]) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  end if;

  select *
    into v_note
  from public.order_notes
  where id = p_note_id
  for update;

  if p_confirm is not true then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'confirmation_required');
  end if;

  if p_reason_code is null or p_reason_code not in ('personal_data_request', 'personal_data_found') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_reason_code');
  end if;

  select coalesce(pg_catalog.array_agg(distinct i), '{}'::uuid[])
    into v_ids
  from pg_catalog.unnest(coalesce(p_reason_event_ids, '{}'::uuid[])) as i
  where i is not null;

  -- Every flagged event belongs to this note and carries a reason.
  if exists (
    select 1
    from pg_catalog.unnest(v_ids) as i
    where not exists (
      select 1
      from public.order_note_events e
      where e.id = i
        and e.tenant_id = v_tenant
        and e.note_id = v_note.id
        and e.reason is not null
    )
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_reason_target');
  end if;

  select pg_catalog.count(*)
    into v_pending_versions
  from public.order_note_versions v
  where v.tenant_id = v_tenant
    and v.note_id = v_note.id
    and v.body is not null;

  select pg_catalog.count(*)
    into v_pending_reasons
  from public.order_note_events e
  where e.tenant_id = v_tenant
    and e.id = any (v_ids)
    and e.reason is distinct from '[motivo suprimido]';

  -- Repeating it with nothing new to suppress writes nothing.
  if v_note.redacted_at is not null and v_pending_versions = 0 and v_pending_reasons = 0 then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'changed', false, 'note', public.order_note_json_v1(v_note),
      'versions_redacted', 0, 'reasons_redacted', 0
    );
  end if;

  -- The void reason is also replaced when its own event is flagged.
  select exists (
    select 1
    from public.order_note_events e
    where e.tenant_id = v_tenant
      and e.id = any (v_ids)
      and e.action = 'voided'
      and e.reason is not distinct from v_note.void_reason
  )
    into v_void_flagged;

  v_before := public.order_note_snapshot_v1(v_note);
  v_name := case
    when v_operator then 'Operador'
    else public.order_note_actor_name_v1(v_tenant, v_actor)
  end;

  perform pg_catalog.set_config('gestcopy.order_notes_write', '1', true);
  perform pg_catalog.set_config('gestcopy.order_notes_redact', '1', true);

  update public.order_note_versions
  set
    body = null,
    redacted_at = v_now,
    redacted_by = v_actor
  where tenant_id = v_tenant
    and note_id = v_note.id
    and body is not null;
  get diagnostics v_versions = row_count;

  update public.order_note_events
  set reason = '[motivo suprimido]'
  where tenant_id = v_tenant
    and note_id = v_note.id
    and id = any (v_ids)
    and reason is distinct from '[motivo suprimido]';
  get diagnostics v_reasons = row_count;

  update public.order_notes
  set
    body = null,
    visibility = 'internal',
    printable_authorized_by = null,
    printable_authorized_at = null,
    pinned = false,
    void_reason = case
      when state <> 'voided' then 'Texto suprimido'
      when v_void_flagged then '[motivo suprimido]'
      else void_reason
    end,
    voided_by = case when state <> 'voided' then v_actor else voided_by end,
    voided_at = case when state <> 'voided' then v_now else voided_at end,
    state = 'voided',
    redacted_at = coalesce(redacted_at, v_now),
    redacted_by = case when redacted_at is null then v_actor else redacted_by end,
    row_version = row_version + 1,
    updated_at = v_now
  where id = v_note.id
  returning * into v_note;

  perform public.order_note_log_v1(
    v_note, v_order.reference, 'redacted', v_actor, v_name,
    v_before,
    public.order_note_snapshot_v1(v_note) || pg_catalog.jsonb_build_object(
      'reason_code', p_reason_code,
      'versions_redacted', v_versions,
      'reasons_redacted', v_reasons
    ),
    null, null, null,
    pg_catalog.jsonb_build_object('reason_code', p_reason_code)
  );

  perform pg_catalog.set_config('gestcopy.order_notes_redact', '', true);
  perform pg_catalog.set_config('gestcopy.order_notes_write', '', true);

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'changed', true,
    'note', public.order_note_json_v1(v_note),
    'versions_redacted', v_versions,
    'reasons_redacted', v_reasons
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.tg_order_notes_guard_v1() from public, anon, authenticated, service_role;
revoke all on function public.tg_order_note_versions_guard_v1() from public, anon, authenticated, service_role;
revoke all on function public.tg_order_note_events_guard_v1() from public, anon, authenticated, service_role;
revoke all on function public.tg_order_notes_refuse_truncate_v1() from public, anon, authenticated, service_role;
revoke all on function public.tg_orders_purge_notes_v1() from public, anon, authenticated, service_role;
revoke all on function public.order_note_plain_length_v1(text) from public, anon, authenticated, service_role;
revoke all on function public.order_note_body_valid_v1(text) from public, anon, authenticated, service_role;
revoke all on function public.order_note_actor_name_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.order_note_snapshot_v1(public.order_notes) from public, anon, authenticated, service_role;
revoke all on function public.order_note_json_v1(public.order_notes) from public, anon, authenticated, service_role;
revoke all on function public.order_note_log_v1(public.order_notes, text, text, uuid, text, jsonb, jsonb, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.create_order_note_v1(uuid, text, text, boolean, uuid, boolean) from public, anon, service_role;
revoke all on function public.update_order_note_v1(uuid, text, text, text, boolean) from public, anon, service_role;
revoke all on function public.set_order_note_state_v1(uuid, text, text) from public, anon, service_role;
revoke all on function public.convert_order_legacy_notes_v1(uuid, text) from public, anon, service_role;
revoke all on function public.redact_order_note_v1(uuid, text, uuid[], boolean) from public, anon;

grant execute on function public.create_order_note_v1(uuid, text, text, boolean, uuid, boolean) to authenticated;
grant execute on function public.update_order_note_v1(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.set_order_note_state_v1(uuid, text, text) to authenticated;
grant execute on function public.convert_order_legacy_notes_v1(uuid, text) to authenticated;
grant execute on function public.redact_order_note_v1(uuid, text, uuid[], boolean) to authenticated, service_role;

comment on function public.create_order_note_v1(uuid, text, text, boolean, uuid, boolean) is
  'SUR4 E5. Creates a post-it (owner/admin/manager/staff, order_sticky_notes). Does not touch orders.row_version. Errors: not_found, forbidden, order_archived, invalid_body, invalid_visibility, printable_confirmation_required, addressee_unavailable, too_many_notes.';
comment on function public.update_order_note_v1(uuid, text, text, text, boolean) is
  'SUR4 E5. Edits text and visibility of an own open post-it, with the note row_version. Errors: not_found, forbidden, order_archived, conflict, invalid_body, invalid_visibility, printable_confirmation_required.';
comment on function public.set_order_note_state_v1(uuid, text, text) is
  'SUR4 E5. pin, unpin, resolve, reopen, void (idempotent). Voiding needs a reason, optional for the rest; staff voids only own notes. Errors: not_found, forbidden, order_archived, conflict, invalid_action, reason_required, invalid_reason.';
comment on function public.convert_order_legacy_notes_v1(uuid, text) is
  'SUR4 E5. «Pasar a post-it»: creates an internal note with orders.notes and empties it in one transaction, with the order row_version. Errors: not_found, forbidden, order_archived, conflict, no_legacy_notes, invalid_body, too_many_notes.';
comment on function public.redact_order_note_v1(uuid, text, uuid[], boolean) is
  'SUR4 E5 (N22). Empties the text of every version, leaves the note internal and voided, and replaces only the flagged reasons. Owner with order_sticky_notes, or service_role. Errors: not_found, forbidden, confirmation_required, invalid_reason_code, invalid_reason_target.';

commit;
