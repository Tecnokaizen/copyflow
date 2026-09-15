-- Invitation self-bootstrap: allow accept_tenant_invitation to insert the
-- invitee's own Personal card when the activity trigger would otherwise
-- reject a staff/viewer actor.
-- Does not change team_members_insert_management (owner/admin/manager only).
-- Does not change the UPDATE branch of this trigger.
-- Does not modify 20260914220000 or 20260915130000.

CREATE OR REPLACE FUNCTION public.tg_activity_log_team_member()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_self_bootstrap boolean := false;
begin

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ==========================================================
  -- INSERT
  -- ==========================================================

  if tg_op = 'INSERT' then

    if public.has_tenant_role(
      new.tenant_id,
      array['owner', 'admin', 'manager']::text[]
    ) then
      v_self_bootstrap := false;
    else
      v_self_bootstrap :=
        new.user_id is not distinct from v_actor
        and exists (
          select 1
          from public.memberships m
          where m.tenant_id = new.tenant_id
            and m.user_id = v_actor
            and m.active = true
        )
        and exists (
          select 1
          from public.tenant_invitations i
          where i.tenant_id = new.tenant_id
            and i.status = 'pending'
            and i.add_to_personal = true
            and i.email_normalized = (
              select public.normalize_invitation_email(u.email)
              from auth.users u
              where u.id = v_actor
            )
        );

      if not v_self_bootstrap then
        raise exception 'tenant access denied'
          using errcode = '42501';
      end if;
    end if;


    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,

      -- Este campo representa al ACTOR, no al miembro modificado.
      null,

      'team_member.created',
      'team_member',
      new.id,
      null,

      pg_catalog.jsonb_build_object(
        'name', new.name,
        'job_title', new.job_title,
        'department', new.department,
        'active', new.active,
        'can_receive_orders', new.can_receive_orders
      ),

      pg_catalog.jsonb_build_object(
        'team_member_name', new.name
      )
    );

    return new;
  end if;


  -- ==========================================================
  -- UPDATE
  -- ==========================================================

  if tg_op = 'UPDATE' then

    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id cannot change on team member'
        using errcode = '42501';
    end if;


    if not public.has_tenant_role(
      new.tenant_id,
      array['owner', 'admin', 'manager']::text[]
    ) then
      raise exception 'tenant access denied'
        using errcode = '42501';
    end if;


    -- No registrar cambios que únicamente afecten a updated_at
    -- u otros campos fuera del módulo operativo actual.
    if
      old.name is not distinct from new.name
      and old.job_title is not distinct from new.job_title
      and old.department is not distinct from new.department
      and old.active is not distinct from new.active
      and old.can_receive_orders is not distinct from new.can_receive_orders
    then
      return new;
    end if;


    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'team_member.updated',
      'team_member',
      new.id,

      pg_catalog.jsonb_build_object(
        'name', old.name,
        'job_title', old.job_title,
        'department', old.department,
        'active', old.active,
        'can_receive_orders', old.can_receive_orders
      ),

      pg_catalog.jsonb_build_object(
        'name', new.name,
        'job_title', new.job_title,
        'department', new.department,
        'active', new.active,
        'can_receive_orders', new.can_receive_orders
      ),

      pg_catalog.jsonb_build_object(
        'team_member_name', new.name
      )
    );

    return new;
  end if;


  return new;
end;
$function$;

COMMENT ON FUNCTION public.tg_activity_log_team_member() IS
  'DEFINER: activity_log de Personal. INSERT: owner/admin/manager, o self-bootstrap del invitado (user_id=auth.uid(), membership activa, invitación pending add_to_personal). UPDATE: solo owner/admin/manager. No relaja team_members_insert_management.';

REVOKE ALL ON FUNCTION public.tg_activity_log_team_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_activity_log_team_member() TO postgres;
