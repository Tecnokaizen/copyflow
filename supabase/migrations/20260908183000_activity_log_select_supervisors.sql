DROP POLICY IF EXISTS "activity_log_select_member" ON "public"."activity_log";

CREATE POLICY "activity_log_select_supervisors" ON "public"."activity_log"
  FOR SELECT
  TO "authenticated"
  USING (
    public.has_tenant_role(
      tenant_id,
      ARRAY['owner', 'admin', 'manager']::text[]
    )
  );
