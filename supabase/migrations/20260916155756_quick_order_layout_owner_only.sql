-- Quick Order Layout configuration is an owner-only structural setting.
-- Narrow the existing policy; no privilege is added.

drop policy if exists "tenant_settings_update_owner_admin"
  on public.tenant_settings;

create policy "tenant_settings_update_owner"
  on public.tenant_settings
  for update
  to authenticated
  using (
    public.has_tenant_role(tenant_id, array['owner'::text])
  )
  with check (
    public.has_tenant_role(tenant_id, array['owner'::text])
  );
