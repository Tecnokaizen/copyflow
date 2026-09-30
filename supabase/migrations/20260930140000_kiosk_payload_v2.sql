-- Kiosk payload v2.
-- orders.description stores canonical HTML. The 4000 limit applies to
-- the signed plain-text representation, not to the serialized HTML.
-- Both representations are inside the capability fingerprint, so a
-- caller cannot change one without invalidating the signature.
-- The historical Kiosk migration is left untouched. This file replaces
-- the previous fingerprint and submit overloads.

create or replace function kiosk_private.kiosk_payload_fingerprint(
  p_title text,
  p_service_id uuid,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_description_html text,
  p_description_plain text,
  p_due_at timestamptz,
  p_observations text
)
  returns text
  language sql
  stable
  security invoker
  set search_path to ''
  as $function$
    select pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'kiosk-payload-v2|' ||
          kiosk_private.canonical_part($1) || '|' ||
          kiosk_private.canonical_part($2::text) || '|' ||
          kiosk_private.canonical_part($3) || '|' ||
          kiosk_private.canonical_part($4) || '|' ||
          kiosk_private.canonical_part($5) || '|' ||
          kiosk_private.canonical_part($6) || '|' ||
          kiosk_private.canonical_part($7) || '|' ||
          kiosk_private.canonical_part(
            case
              when $8 is null then null
              else pg_catalog.to_char(
                $8 at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              )
            end
          ) || '|' ||
          kiosk_private.canonical_part($9),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
$function$;

create or replace function kiosk_private.submit_kiosk_order(
  p_tenant_slug text,
  p_client_key text,
  p_issued_at bigint,
  p_purpose text,
  p_binding text,
  p_signature text,
  p_permit_id uuid,
  p_submission_id uuid,
  p_title text,
  p_service_id uuid,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_description text,
  p_description_plain text,
  p_due_at timestamptz,
  p_observations text
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path to ''
  as $function$
declare
  v_tenant public.tenants%rowtype;
  v_service public.services%rowtype;
  v_status_ids uuid[];
  v_channel_id uuid;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_consumed_permit uuid;
  v_actual_fingerprint text;
  v_locked_id uuid;
  v_notes text;
begin
  if p_permit_id is null
     or p_submission_id is null then
    return pg_catalog.jsonb_build_object('status', 'invalid_request');
  end if;

  if nullif(pg_catalog.btrim(p_title), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_title)) > 80
     or p_service_id is null
     or nullif(pg_catalog.btrim(p_contact_name), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_contact_name)) > 120
     or (
       nullif(pg_catalog.btrim(p_contact_email), '') is null
       and nullif(pg_catalog.btrim(p_contact_phone), '') is null
     )
     or pg_catalog.char_length(coalesce(pg_catalog.btrim(p_contact_email), '')) > 254
     or pg_catalog.char_length(coalesce(pg_catalog.btrim(p_contact_phone), '')) > 40
     or nullif(pg_catalog.btrim(p_description), '') is null
     or pg_catalog.char_length(p_description) > 200000
     or nullif(pg_catalog.btrim(p_description_plain), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_description_plain)) > 4000
     or pg_catalog.char_length(coalesce(pg_catalog.btrim(p_observations), '')) > 2000
     or (
       p_due_at is not null
       and pg_catalog.date_trunc('milliseconds', p_due_at) <> p_due_at
     ) then
    return pg_catalog.jsonb_build_object('status', 'invalid_request');
  end if;

  v_actual_fingerprint := kiosk_private.kiosk_payload_fingerprint(
    p_title,
    p_service_id,
    p_contact_name,
    p_contact_email,
    p_contact_phone,
    p_description,
    p_description_plain,
    p_due_at,
    p_observations
  );

  if p_purpose <> 'submit'
     or p_binding <> (
       p_permit_id::text || '|' ||
       p_submission_id::text || '|' ||
       v_actual_fingerprint
     )
     or not kiosk_private.verify_kiosk_capability(
       p_tenant_slug,
       p_client_key,
       p_issued_at,
       p_purpose,
       p_binding,
       p_signature
     ) then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  select t.*
  into v_tenant
  from public.tenants t
  where t.slug = p_tenant_slug
    and t.active = true
  for share;

  if v_tenant.id is null then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  select ec.id
  into v_channel_id
  from public.entry_channels ec
  where ec.tenant_id = v_tenant.id
    and ec.active = true
    and ec.code = 'kiosk'
  for share;

  if v_channel_id is null then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  update kiosk_private.kiosk_request_permits p
  set consumed_at = pg_catalog.now()
  where p.id = p_permit_id
    and p.tenant_id = v_tenant.id
    and p.client_key = p_client_key
    and p.consumed_at is null
    and p.expires_at >= pg_catalog.now()
  returning p.id into v_consumed_permit;

  if v_consumed_permit is null then
    return pg_catalog.jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kiosk-submission:' || p_submission_id, 0)
  );

  select o.*
  into v_existing
  from public.orders o
  where o.id = p_submission_id;

  if v_existing.id is not null then
    if v_existing.tenant_id = v_tenant.id
       and v_existing.metadata ->> 'source' = 'kiosk'
       and v_existing.metadata #>> '{kiosk,request_fingerprint}'
         = v_actual_fingerprint then
      return pg_catalog.jsonb_build_object(
        'status', 'replay',
        'reference', v_existing.reference
      );
    end if;
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  select s.*
  into v_service
  from public.services s
  where s.id = p_service_id
    and s.tenant_id = v_tenant.id
    and s.active = true
  for share;

  if v_service.id is null then
    return pg_catalog.jsonb_build_object('status', 'invalid_service');
  end if;

  v_status_ids := array[]::uuid[];
  for v_locked_id in
    select os.id
    from public.order_statuses os
    where os.tenant_id = v_tenant.id
      and os.active = true
      and os.is_initial = true
    for share
  loop
    v_status_ids := pg_catalog.array_append(v_status_ids, v_locked_id);
  end loop;

  if coalesce(pg_catalog.cardinality(v_status_ids), 0) <> 1 then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  v_notes := pg_catalog.concat_ws(
    E'\n',
    'Solicitud Kiosk',
    'Contacto: ' || pg_catalog.btrim(p_contact_name),
    case
      when nullif(pg_catalog.btrim(p_contact_email), '') is not null
        then 'Email: ' || pg_catalog.lower(pg_catalog.btrim(p_contact_email))
    end,
    case
      when nullif(pg_catalog.btrim(p_contact_phone), '') is not null
        then 'Teléfono: ' || pg_catalog.btrim(p_contact_phone)
    end,
    case
      when nullif(pg_catalog.btrim(p_observations), '') is not null
        then 'Observaciones: ' || pg_catalog.btrim(p_observations)
    end
  );

  perform pg_catalog.set_config('app.kiosk_submission', 'validated', true);

  insert into public.orders (
    id,
    tenant_id,
    title,
    description,
    service_id,
    status_id,
    entry_channel_id,
    priority,
    due_at,
    notes,
    metadata,
    created_by
  )
  values (
    p_submission_id,
    v_tenant.id,
    pg_catalog.btrim(p_title),
    pg_catalog.btrim(p_description),
    v_service.id,
    v_status_ids[1],
    v_channel_id,
    'normal',
    p_due_at,
    v_notes,
    pg_catalog.jsonb_build_object(
      'source', 'kiosk',
      'kiosk', pg_catalog.jsonb_build_object(
        'submission_id', p_submission_id,
        'request_fingerprint', v_actual_fingerprint,
        'client_key', p_client_key,
        'contact', pg_catalog.jsonb_build_object(
          'name', pg_catalog.btrim(p_contact_name),
          'email', nullif(pg_catalog.lower(pg_catalog.btrim(p_contact_email)), ''),
          'phone', nullif(pg_catalog.btrim(p_contact_phone), '')
        )
      )
    ),
    null
  )
  returning * into v_order;

  return pg_catalog.jsonb_build_object(
    'status', 'created',
    'reference', v_order.reference
  );
end;
$function$;

create or replace function public.submit_kiosk_order(
  p_tenant_slug text,
  p_client_key text,
  p_issued_at bigint,
  p_purpose text,
  p_binding text,
  p_signature text,
  p_permit_id uuid,
  p_submission_id uuid,
  p_title text,
  p_service_id uuid,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_description text,
  p_description_plain text,
  p_due_at timestamptz,
  p_observations text
)
  returns jsonb
  language sql
  volatile
  security definer
  set search_path to ''
  as $function$
    select kiosk_private.submit_kiosk_order(
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17
    );
$function$;

drop function if exists public.submit_kiosk_order(
  text, text, bigint, text, text, text, uuid, uuid, text, uuid,
  text, text, text, text, timestamptz, text
);
drop function if exists kiosk_private.submit_kiosk_order(
  text, text, bigint, text, text, text, uuid, uuid, text, uuid,
  text, text, text, text, timestamptz, text
);
drop function if exists kiosk_private.kiosk_payload_fingerprint(
  text, uuid, text, text, text, text, timestamptz, text
);

revoke all on function kiosk_private.kiosk_payload_fingerprint(
  text, uuid, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function kiosk_private.submit_kiosk_order(
  text, text, bigint, text, text, text, uuid, uuid, text, uuid,
  text, text, text, text, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on schema kiosk_private
  from public, anon, authenticated, service_role;

revoke all on function public.submit_kiosk_order(
  text, text, bigint, text, text, text, uuid, uuid, text, uuid,
  text, text, text, text, text, timestamptz, text
) from public, authenticated, service_role;
grant execute on function public.submit_kiosk_order(
  text, text, bigint, text, text, text, uuid, uuid, text, uuid,
  text, text, text, text, text, timestamptz, text
) to anon;

comment on function public.submit_kiosk_order(
  text, text, bigint, text, text, text, uuid, uuid, text, uuid,
  text, text, text, text, text, timestamptz, text
) is 'Hardened signed one-shot Kiosk submit wrapper. Description HTML and plain text are both bound by the capability.';
