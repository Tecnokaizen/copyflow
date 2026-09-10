-- =============================================================================
-- DEMO ONLY — Gestcopy commercial seed (slug = demo)
-- NEVER TOUCH SUR4
-- NEVER TOUCH other tenants
--
-- Destructive ONLY for operational / configurable data of tenant slug='demo'.
-- Preserves: tenants, memberships, Auth, profiles, subscriptions/plans,
--            and tenant_settings (with controlled updates).
--
-- DO NOT run via supabase db reset automatically.
-- Execute explicitly after review (see supabase/seeds/README.md).
--
-- Seed marker: metadata.seed = 'gestcopy-demo-commercial-v1'
-- =============================================================================

BEGIN;

-- Deterministic UUID helper (session-only, no public schema changes).
CREATE OR REPLACE FUNCTION pg_temp.demo_uuid(p_key text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $fn$
DECLARE
  h text := md5(p_key);
BEGIN
  RETURN (
    substr(h, 1, 8) || '-' ||
    substr(h, 9, 4) || '-' ||
    '4' || substr(h, 13, 3) || '-' ||
    '8' || substr(h, 17, 3) || '-' ||
    substr(h, 21, 12)
  )::uuid;
END;
$fn$;

DO $seed$
DECLARE
  c_seed constant text := 'gestcopy-demo-commercial-v1';

  v_demo uuid;
  v_sur4 uuid;
  v_demo_count int;
  v_actor uuid;
  v_tz text := 'Europe/Madrid';

  v_status_received uuid;
  v_status_production uuid;
  v_status_ready uuid;
  v_status_collected uuid;
  v_status_cancelled uuid;

  v_type_particular uuid;
  v_type_profesional uuid;
  v_type_empresa uuid;

  v_ch_store uuid;
  v_ch_phone uuid;
  v_ch_email uuid;
  v_ch_web uuid;

  v_ctx_store uuid;
  v_ctx_urgent uuid;
  v_ctx_special uuid;

  v_file_pending uuid;
  v_file_received uuid;
  v_quote_pending uuid;
  v_quote_accepted uuid;
  v_pay_pending uuid;
  v_pay_paid uuid;
  v_del_pickup uuid;
  v_del_courier uuid;

  i int;
  a int;
  n int;
  n_collected int;
  n_cancelled int;
  n_active int;
  n_urgent int;
  n_overdue int;
  n_today int;
  n_ready int;
  n_notified int;
  n_no_pickup int;
  n_activity int;
  n_refs int;
  n_counter int;
  n_foreign int;
  n_sur4_orders int;

  v_order_id uuid;
  v_client_id uuid;
  v_service_id uuid;
  v_member_id uuid;
  v_status_id uuid;
  v_priority text;
  v_channel_id uuid;
  v_context_id uuid;
  v_file_id uuid;
  v_quote_id uuid;
  v_payment_id uuid;
  v_delivery_id uuid;
  v_notif text;
  v_title text;
  v_due timestamptz;
  v_received timestamptz;
  v_ready_at timestamptz;
  v_delivered timestamptz;
  v_local_date date;
  v_req_file boolean;
  v_req_quote boolean;
  v_op int;
  v_svc_idx int;
  v_client_idx int;
  v_member_idx int;
  v_hour int;
  v_event_at timestamptz;
  v_action text;
  v_entity_type text;
  v_entity_id uuid;
  v_tm uuid;
  v_seq int;
BEGIN
  RAISE NOTICE 'DEMO ONLY — starting gestcopy demo commercial seed';
  RAISE NOTICE 'NEVER TOUCH SUR4';

  -- =========================================================================
  -- 1) Absolute tenant guard
  -- =========================================================================
  SELECT count(*) INTO v_demo_count
  FROM public.tenants
  WHERE slug = 'demo';

  IF v_demo_count <> 1 THEN
    RAISE EXCEPTION
      'DEMO seed aborted: expected exactly 1 tenant slug=demo, found %',
      v_demo_count;
  END IF;

  SELECT id INTO v_demo
  FROM public.tenants
  WHERE slug = 'demo';

  SELECT id INTO v_sur4
  FROM public.tenants
  WHERE slug = 'sur4';

  IF v_sur4 IS NULL THEN
    RAISE EXCEPTION 'DEMO seed aborted: tenant slug=sur4 must still exist';
  END IF;

  IF v_demo = v_sur4 THEN
    RAISE EXCEPTION 'DEMO seed aborted: demo tenant id equals sur4 — refuse';
  END IF;

  -- =========================================================================
  -- 2) Technical actor (owner membership of demo) + JWT claim for auth.uid()
  -- =========================================================================
  SELECT m.user_id
  INTO v_actor
  FROM public.memberships m
  WHERE m.tenant_id = v_demo
    AND m.role = 'owner'
    AND m.active = true
  ORDER BY m.created_at ASC, m.user_id ASC
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'DEMO seed aborted: no active owner membership for tenant demo';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_actor::text,
      'role', 'authenticated'
    )::text,
    true
  );

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'DEMO seed aborted: auth.uid() is NULL after JWT setup';
  END IF;

  IF auth.uid() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION
      'DEMO seed aborted: auth.uid()=% expected actor=%',
      auth.uid(), v_actor;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.tenant_id = v_demo
      AND m.user_id = v_actor
      AND m.role = 'owner'
      AND m.active = true
  ) THEN
    RAISE EXCEPTION
      'DEMO seed aborted: actor is not an active owner of demo';
  END IF;

  IF NOT public.has_tenant_role(v_demo, ARRAY['owner']::text[]) THEN
    RAISE EXCEPTION
      'DEMO seed aborted: has_tenant_role(owner) failed for actor';
  END IF;

  -- =========================================================================
  -- 3) Reset DEMO operational data only (FK-safe)
  --    NEVER TOUCH SUR4 / other tenants
  -- =========================================================================
  DELETE FROM public.activity_log WHERE tenant_id = v_demo;
  DELETE FROM public.orders WHERE tenant_id = v_demo;
  DELETE FROM public.clients WHERE tenant_id = v_demo;
  DELETE FROM public.services WHERE tenant_id = v_demo;
  DELETE FROM public.service_categories WHERE tenant_id = v_demo;

  DELETE FROM public.team_members
  WHERE tenant_id = v_demo
    AND user_id IS NULL;

  DELETE FROM public.entry_channels WHERE tenant_id = v_demo;
  DELETE FROM public.order_contexts WHERE tenant_id = v_demo;
  DELETE FROM public.file_statuses WHERE tenant_id = v_demo;
  DELETE FROM public.quote_statuses WHERE tenant_id = v_demo;
  DELETE FROM public.payment_statuses WHERE tenant_id = v_demo;
  DELETE FROM public.delivery_methods WHERE tenant_id = v_demo;
  DELETE FROM public.customer_types WHERE tenant_id = v_demo;
  DELETE FROM public.order_statuses WHERE tenant_id = v_demo;
  DELETE FROM public.order_number_counters WHERE tenant_id = v_demo;

  UPDATE public.tenant_settings
  SET
    business_name = 'Copyflow Demo',
    timezone = 'Europe/Madrid',
    locale = 'es-ES',
    currency = 'EUR',
    branding = jsonb_build_object('primary_style', 'copyflow-default'),
    preferences = jsonb_build_object(
      'default_view', 'dashboard',
      'week_starts_on', 'monday',
      'seed', c_seed
    ),
    updated_at = now()
  WHERE tenant_id = v_demo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEMO seed aborted: tenant_settings missing for demo';
  END IF;

  SELECT timezone INTO v_tz
  FROM public.tenant_settings
  WHERE tenant_id = v_demo;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'Europe/Madrid');

  -- =========================================================================
  -- 4) Configuration catalogs (tenant_id = v_demo always)
  -- =========================================================================
  INSERT INTO public.order_statuses (
    id, tenant_id, name, code,
    is_initial, is_ready, is_closed, is_cancelled,
    active, sort_order
  ) VALUES
    (pg_temp.demo_uuid(c_seed || ':status:received'), v_demo, 'Recibido', 'received',
      true, false, false, false, true, 10),
    (pg_temp.demo_uuid(c_seed || ':status:production'), v_demo, 'Producción', 'production',
      false, false, false, false, true, 20),
    (pg_temp.demo_uuid(c_seed || ':status:ready'), v_demo, 'Listo', 'ready',
      false, true, false, false, true, 30),
    (pg_temp.demo_uuid(c_seed || ':status:collected'), v_demo, 'Recogido', 'collected',
      false, false, true, false, true, 40),
    (pg_temp.demo_uuid(c_seed || ':status:cancelled'), v_demo, 'Cancelado', 'cancelled',
      false, false, false, true, true, 50);

  v_status_received := pg_temp.demo_uuid(c_seed || ':status:received');
  v_status_production := pg_temp.demo_uuid(c_seed || ':status:production');
  v_status_ready := pg_temp.demo_uuid(c_seed || ':status:ready');
  v_status_collected := pg_temp.demo_uuid(c_seed || ':status:collected');
  v_status_cancelled := pg_temp.demo_uuid(c_seed || ':status:cancelled');

  INSERT INTO public.customer_types (id, tenant_id, name, active, sort_order) VALUES
    (pg_temp.demo_uuid(c_seed || ':ctype:particular'), v_demo, 'Particular', true, 10),
    (pg_temp.demo_uuid(c_seed || ':ctype:profesional'), v_demo, 'Profesional', true, 20),
    (pg_temp.demo_uuid(c_seed || ':ctype:empresa'), v_demo, 'Empresa', true, 30);

  v_type_particular := pg_temp.demo_uuid(c_seed || ':ctype:particular');
  v_type_profesional := pg_temp.demo_uuid(c_seed || ':ctype:profesional');
  v_type_empresa := pg_temp.demo_uuid(c_seed || ':ctype:empresa');

  INSERT INTO public.entry_channels (id, tenant_id, name, code, active, sort_order) VALUES
    (pg_temp.demo_uuid(c_seed || ':channel:store'), v_demo, 'Tienda', 'store', true, 10),
    (pg_temp.demo_uuid(c_seed || ':channel:phone'), v_demo, 'Teléfono', 'phone', true, 20),
    (pg_temp.demo_uuid(c_seed || ':channel:email'), v_demo, 'Email', 'email', true, 30),
    (pg_temp.demo_uuid(c_seed || ':channel:web'), v_demo, 'Web', 'web', true, 40);

  v_ch_store := pg_temp.demo_uuid(c_seed || ':channel:store');
  v_ch_phone := pg_temp.demo_uuid(c_seed || ':channel:phone');
  v_ch_email := pg_temp.demo_uuid(c_seed || ':channel:email');
  v_ch_web := pg_temp.demo_uuid(c_seed || ':channel:web');

  INSERT INTO public.order_contexts (id, tenant_id, name, code, active, sort_order) VALUES
    (pg_temp.demo_uuid(c_seed || ':ctx:store'), v_demo, 'Pedido tienda', 'store_order', true, 10),
    (pg_temp.demo_uuid(c_seed || ':ctx:urgent'), v_demo, 'Encargo urgente', 'urgent_job', true, 20),
    (pg_temp.demo_uuid(c_seed || ':ctx:special'), v_demo, 'Proyecto especial', 'special_project', true, 30);

  v_ctx_store := pg_temp.demo_uuid(c_seed || ':ctx:store');
  v_ctx_urgent := pg_temp.demo_uuid(c_seed || ':ctx:urgent');
  v_ctx_special := pg_temp.demo_uuid(c_seed || ':ctx:special');

  INSERT INTO public.file_statuses (id, tenant_id, name, code, active, sort_order) VALUES
    (pg_temp.demo_uuid(c_seed || ':file:pending'), v_demo, 'Pendiente', 'pending', true, 10),
    (pg_temp.demo_uuid(c_seed || ':file:received'), v_demo, 'Recibido', 'received', true, 20);

  v_file_pending := pg_temp.demo_uuid(c_seed || ':file:pending');
  v_file_received := pg_temp.demo_uuid(c_seed || ':file:received');

  INSERT INTO public.quote_statuses (id, tenant_id, name, code, active, sort_order) VALUES
    (pg_temp.demo_uuid(c_seed || ':quote:pending'), v_demo, 'Pendiente', 'pending', true, 10),
    (pg_temp.demo_uuid(c_seed || ':quote:accepted'), v_demo, 'Aceptado', 'accepted', true, 20);

  v_quote_pending := pg_temp.demo_uuid(c_seed || ':quote:pending');
  v_quote_accepted := pg_temp.demo_uuid(c_seed || ':quote:accepted');

  INSERT INTO public.payment_statuses (id, tenant_id, name, code, active, sort_order) VALUES
    (pg_temp.demo_uuid(c_seed || ':pay:pending'), v_demo, 'Pendiente', 'pending', true, 10),
    (pg_temp.demo_uuid(c_seed || ':pay:paid'), v_demo, 'Pagado', 'paid', true, 20);

  v_pay_pending := pg_temp.demo_uuid(c_seed || ':pay:pending');
  v_pay_paid := pg_temp.demo_uuid(c_seed || ':pay:paid');

  INSERT INTO public.delivery_methods (id, tenant_id, name, code, active, sort_order) VALUES
    (pg_temp.demo_uuid(c_seed || ':del:pickup'), v_demo, 'Recogida', 'pickup', true, 10),
    (pg_temp.demo_uuid(c_seed || ':del:courier'), v_demo, 'Mensajería', 'courier', true, 20);

  v_del_pickup := pg_temp.demo_uuid(c_seed || ':del:pickup');
  v_del_courier := pg_temp.demo_uuid(c_seed || ':del:courier');

  -- =========================================================================
  -- 5) Categories + services
  -- =========================================================================
  INSERT INTO public.service_categories (id, tenant_id, name, active, sort_order) VALUES
    (pg_temp.demo_uuid(c_seed || ':cat:01'), v_demo, 'Impresión y copias', true, 10),
    (pg_temp.demo_uuid(c_seed || ':cat:02'), v_demo, 'Encuadernación y acabados', true, 20),
    (pg_temp.demo_uuid(c_seed || ':cat:03'), v_demo, 'Gran formato', true, 30),
    (pg_temp.demo_uuid(c_seed || ':cat:04'), v_demo, 'Diseño gráfico', true, 40),
    (pg_temp.demo_uuid(c_seed || ':cat:05'), v_demo, 'Fotografía / imagen', true, 50);

  INSERT INTO public.services (
    id, tenant_id, category_id, name, description,
    standard_lead_time_minutes, requires_file, requires_design, requires_quote,
    active, sort_order, metadata
  ) VALUES
    (pg_temp.demo_uuid(c_seed || ':svc:01'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:01'),
      'Copias B/N', 'Copias en blanco y negro.', 30, false, false, false, true, 10,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:02'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:01'),
      'Copias color', 'Copias a color.', 45, false, false, false, true, 20,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:03'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:01'),
      'Impresión digital', 'Impresión digital a partir de archivo.', 120, true, false, false, true, 30,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:04'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:02'),
      'Encuadernación espiral', 'Encuadernación con espiral.', 180, false, false, false, true, 40,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:05'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:02'),
      'Encuadernación tapa dura', 'Encuadernación tapa dura.', 2880, true, false, true, true, 50,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:06'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:02'),
      'Plastificado', 'Plastificado de documentos.', 60, false, false, false, true, 60,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:07'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:03'),
      'Impresión gran formato / plotter', 'Plotter y gran formato.', 1440, true, false, true, true, 70,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:08'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:03'),
      'Cartelería', 'Carteles y comunicación visual.', 960, true, true, true, true, 80,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:09'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:04'),
      'Flyers / tarjetas', 'Flyers y tarjetas de visita.', 720, true, true, false, true, 90,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:10'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:04'),
      'Diseño gráfico rápido', 'Diseño gráfico de turno.', 480, false, true, true, true, 100,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:11'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:05'),
      'Revelado fotográfico', 'Revelado e impresión fotográfica.', 1440, true, false, false, true, 110,
      jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':svc:12'), v_demo, pg_temp.demo_uuid(c_seed || ':cat:05'),
      'Álbum fotográfico', 'Álbum fotográfico personalizado.', 10080, true, true, true, true, 120,
      jsonb_build_object('seed', c_seed));

  -- =========================================================================
  -- 6) Clients (30)
  -- =========================================================================
  INSERT INTO public.clients (
    id, tenant_id, customer_type_id, name, contact_name, company_name,
    email, phone, active, metadata
  ) VALUES
    (pg_temp.demo_uuid(c_seed || ':client:01'), v_demo, v_type_particular, 'Lucía Navarro', NULL, NULL,
      'lucia.navarro@example.test', '+34 600 00 01 01', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:02'), v_demo, v_type_particular, 'Javier Ortega', NULL, NULL,
      'javier.ortega@example.test', '+34 600 00 01 02', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:03'), v_demo, v_type_particular, 'Elena Ruiz', NULL, NULL,
      'elena.ruiz@example.test', '+34 600 00 01 03', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:04'), v_demo, v_type_particular, 'Marcos Vidal', NULL, NULL,
      'marcos.vidal@example.test', '+34 600 00 01 04', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:05'), v_demo, v_type_particular, 'Carmen Pardo', NULL, NULL,
      'carmen.pardo@example.test', '+34 600 00 01 05', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:06'), v_demo, v_type_particular, 'Hugo Beltrán', NULL, NULL,
      'hugo.beltran@example.test', '+34 600 00 01 06', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:07'), v_demo, v_type_particular, 'Irene Salas', NULL, NULL,
      'irene.salas@example.test', '+34 600 00 01 07', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:08'), v_demo, v_type_particular, 'Pablo Méndez', NULL, NULL,
      'pablo.mendez@example.test', '+34 600 00 01 08', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:09'), v_demo, v_type_particular, 'Nuria Campos', NULL, NULL,
      'nuria.campos@example.test', '+34 600 00 01 09', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:10'), v_demo, v_type_particular, 'Sergio Ibáñez', NULL, NULL,
      'sergio.ibanez@example.test', '+34 600 00 01 10', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:11'), v_demo, v_type_particular, 'Diego Ferrer', NULL, NULL,
      'diego.ferrer@example.test', '+34 600 00 01 11', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:12'), v_demo, v_type_particular, 'Alba Torralba', NULL, NULL,
      'alba.torralba@example.test', '+34 600 00 01 12', false, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:13'), v_demo, v_type_profesional, 'Ana Ríos Fotografía', 'Ana Ríos', 'Ana Ríos Fotografía',
      'ana.rios@example.test', '+34 600 00 02 01', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:14'), v_demo, v_type_profesional, 'Studio Vega Arquitectura', 'Luis Vega', 'Studio Vega Arquitectura',
      'studio.vega@example.test', '+34 600 00 02 02', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:15'), v_demo, v_type_profesional, 'Consultoría Mira', 'Teresa Mira', 'Consultoría Mira',
      'consultoria.mira@example.test', '+34 600 00 02 03', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:16'), v_demo, v_type_profesional, 'Diseño Atelier Sol', 'Nora Sol', 'Diseño Atelier Sol',
      'atelier.sol@example.test', '+34 600 00 02 04', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:17'), v_demo, v_type_profesional, 'Coaching Lara Peña', 'Lara Peña', 'Coaching Lara Peña',
      'lara.pena@example.test', '+34 600 00 02 05', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:18'), v_demo, v_type_profesional, 'Clínica Dental Prado', 'Dr. Prado', 'Clínica Dental Prado',
      'dental.prado@example.test', '+34 600 00 02 06', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:19'), v_demo, v_type_profesional, 'Gestoría Font', 'Marta Font', 'Gestoría Font',
      'gestoria.font@example.test', '+34 600 00 02 07', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:20'), v_demo, v_type_profesional, 'Traducciones Nexo', 'Iván Nexo', 'Traducciones Nexo',
      'traducciones.nexo@example.test', '+34 600 00 02 08', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:21'), v_demo, v_type_empresa, 'Academia Norte SL', 'Secretaría', 'Academia Norte SL',
      'academia.norte@example.test', '+34 600 00 03 01', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:22'), v_demo, v_type_empresa, 'Inmobiliaria Sierra', 'Comercial', 'Inmobiliaria Sierra',
      'inmobiliaria.sierra@example.test', '+34 600 00 03 02', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:23'), v_demo, v_type_empresa, 'Restaurante La Plaza', 'Gerencia', 'Restaurante La Plaza',
      'restaurante.plaza@example.test', '+34 600 00 03 03', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:24'), v_demo, v_type_empresa, 'Asociación Cultural Río', 'Presidencia', 'Asociación Cultural Río',
      'asociacion.rio@example.test', '+34 600 00 03 04', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:25'), v_demo, v_type_empresa, 'Colegio San Marcos', 'Administración', 'Colegio San Marcos',
      'colegio.sanmarcos@example.test', '+34 600 00 03 05', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:26'), v_demo, v_type_empresa, 'Agencia Pixel Media', 'Producción', 'Agencia Pixel Media',
      'agencia.pixel@example.test', '+34 600 00 03 06', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:27'), v_demo, v_type_empresa, 'Ferretería Centro', 'Compras', 'Ferretería Centro',
      'ferreteria.centro@example.test', '+34 600 00 03 07', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:28'), v_demo, v_type_empresa, 'Hotel Brisa', 'Recepción', 'Hotel Brisa',
      'hotel.brisa@example.test', '+34 600 00 03 08', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:29'), v_demo, v_type_empresa, 'Farmacia Soler', 'Titular', 'Farmacia Soler',
      'farmacia.soler@example.test', '+34 600 00 03 09', true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':client:30'), v_demo, v_type_empresa, 'Constructora Aldea', 'Oficina técnica', 'Constructora Aldea',
      'constructora.aldea@example.test', '+34 600 00 03 10', false, jsonb_build_object('seed', c_seed));

  -- =========================================================================
  -- 7) Team members (7) — no Auth / memberships
  -- =========================================================================
  INSERT INTO public.team_members (
    id, tenant_id, user_id, name, email, phone, job_title, department,
    active, can_receive_orders, metadata
  ) VALUES
    (pg_temp.demo_uuid(c_seed || ':team:01'), v_demo, NULL, 'Marina López',
      'marina.lopez@example.test', '+34 600 10 00 01', 'Responsable', 'Coordinación',
      true, true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':team:02'), v_demo, NULL, 'Hugo Martín',
      'hugo.martin@example.test', '+34 600 10 00 02', 'Mostrador', 'Mostrador',
      true, true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':team:03'), v_demo, NULL, 'Clara Ruiz',
      'clara.ruiz@example.test', '+34 600 10 00 03', 'Recepción', 'Mostrador',
      true, true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':team:04'), v_demo, NULL, 'Iván Delgado',
      'ivan.delgado@example.test', '+34 600 10 00 04', 'Técnico impresión', 'Impresión digital',
      true, true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':team:05'), v_demo, NULL, 'Sofía Navarro',
      'sofia.navarro@example.test', '+34 600 10 00 05', 'Técnico gran formato', 'Gran formato',
      true, true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':team:06'), v_demo, NULL, 'Pedro Gil',
      'pedro.gil@example.test', '+34 600 10 00 06', 'Acabados', 'Encuadernación',
      true, true, jsonb_build_object('seed', c_seed)),
    (pg_temp.demo_uuid(c_seed || ':team:07'), v_demo, NULL, 'Laura Vega',
      'laura.vega@example.test', '+34 600 10 00 07', 'Diseño gráfico', 'Diseño',
      true, true, jsonb_build_object('seed', c_seed));

  -- =========================================================================
  -- 8) Orders (200) — references via tg_assign_order_reference
  -- =========================================================================
  v_local_date := (now() AT TIME ZONE v_tz)::date;

  FOR i IN 1..200 LOOP
    v_order_id := pg_temp.demo_uuid(c_seed || ':order:' || lpad(i::text, 3, '0'));
    v_svc_idx := ((i - 1) % 12) + 1;
    v_service_id := pg_temp.demo_uuid(c_seed || ':svc:' || lpad(v_svc_idx::text, 2, '0'));
    v_client_idx := ((i - 1) % 30) + 1;
    IF v_client_idx IN (12, 30) AND i <= 190 THEN
      v_client_idx := ((i - 1) % 11) + 1;
    END IF;
    v_client_id := pg_temp.demo_uuid(c_seed || ':client:' || lpad(v_client_idx::text, 2, '0'));

    SELECT requires_file, requires_quote, name
    INTO v_req_file, v_req_quote, v_title
    FROM public.services
    WHERE tenant_id = v_demo AND id = v_service_id;

    v_title := v_title || ' — pedido ' || lpad(i::text, 3, '0');
    v_hour := 9 + ((i - 1) % 9);
    v_channel_id := CASE (i % 4)
      WHEN 0 THEN v_ch_store WHEN 1 THEN v_ch_phone WHEN 2 THEN v_ch_email ELSE v_ch_web END;
    v_context_id := CASE
      WHEN i % 11 = 0 THEN v_ctx_urgent
      WHEN i % 7 = 0 THEN v_ctx_special
      ELSE v_ctx_store
    END;
    v_delivery_id := CASE WHEN i % 5 = 0 THEN v_del_courier ELSE v_del_pickup END;

    IF i <= 150 THEN
      v_status_id := v_status_collected;
      v_priority := CASE WHEN i % 9 = 0 THEN 'high' ELSE 'normal' END;
      v_due := ((v_local_date - ((i % 80) + 3))::timestamp + make_time(v_hour, 30, 0))
        AT TIME ZONE v_tz;
      v_ready_at := v_due - interval '3 hours';
      v_delivered := v_due + interval '25 minutes';
      v_received := v_due - interval '2 days';
      v_notif := 'notified';
      v_payment_id := v_pay_paid;
      v_file_id := CASE WHEN v_req_file THEN v_file_received ELSE NULL END;
      v_quote_id := CASE WHEN v_req_quote THEN v_quote_accepted ELSE NULL END;
      v_member_idx := ((i - 1) % 7) + 1;
      v_member_id := pg_temp.demo_uuid(c_seed || ':team:' || lpad(v_member_idx::text, 2, '0'));

    ELSIF i <= 158 THEN
      v_status_id := v_status_cancelled;
      v_priority := CASE WHEN i % 2 = 0 THEN 'high' ELSE 'normal' END;
      v_due := ((v_local_date - ((i - 150) + 1))::timestamp + make_time(v_hour, 0, 0))
        AT TIME ZONE v_tz;
      v_ready_at := NULL;
      v_delivered := NULL;
      v_received := v_due - interval '1 day';
      v_notif := 'not_notified';
      v_payment_id := CASE WHEN i % 2 = 0 THEN v_pay_pending ELSE v_pay_paid END;
      v_file_id := CASE WHEN v_req_file THEN v_file_pending ELSE NULL END;
      v_quote_id := CASE WHEN v_req_quote THEN v_quote_pending ELSE NULL END;
      v_member_idx := ((i - 1) % 7) + 1;
      v_member_id := pg_temp.demo_uuid(c_seed || ':team:' || lpad(v_member_idx::text, 2, '0'));

    ELSE
      v_op := i - 158;

      IF v_op <= 16 THEN
        v_status_id := v_status_received;
      ELSIF v_op <= 30 THEN
        v_status_id := v_status_production;
      ELSE
        v_status_id := v_status_ready;
      END IF;

      IF v_op <= 5 THEN
        v_priority := 'urgent';
      ELSIF v_op <= 17 THEN
        v_priority := 'high';
      ELSE
        v_priority := 'normal';
      END IF;

      IF v_op <= 6 THEN
        v_due := ((v_local_date - v_op)::timestamp + make_time(v_hour, 0, 0)) AT TIME ZONE v_tz;
      ELSIF v_op <= 14 THEN
        v_due := (v_local_date::timestamp + make_time(v_hour, 15, 0)) AT TIME ZONE v_tz;
      ELSIF v_op <= 19 THEN
        v_due := ((v_local_date + 1)::timestamp + make_time(v_hour, 0, 0)) AT TIME ZONE v_tz;
      ELSIF v_op <= 27 THEN
        v_due := ((v_local_date + (2 + ((v_op - 20) % 4)))::timestamp + make_time(v_hour, 0, 0))
          AT TIME ZONE v_tz;
      ELSIF v_op <= 32 THEN
        v_due := ((v_local_date + (8 + (v_op - 28)))::timestamp + make_time(v_hour, 0, 0))
          AT TIME ZONE v_tz;
      ELSE
        v_due := ((v_local_date + ((v_op % 3) + 1))::timestamp + make_time(v_hour, 30, 0))
          AT TIME ZONE v_tz;
      END IF;

      IF v_status_id = v_status_ready THEN
        v_ready_at := least(now(), v_due) - interval '90 minutes';
        v_delivered := NULL;
        IF v_op BETWEEN 31 AND 33 THEN
          v_notif := 'not_notified';
        ELSIF v_op BETWEEN 34 AND 37 THEN
          v_notif := 'notified';
        ELSIF v_op BETWEEN 38 AND 40 THEN
          v_notif := 'notified_no_pickup';
        ELSE
          v_notif := 'notified';
        END IF;
      ELSE
        v_ready_at := NULL;
        v_delivered := NULL;
        v_notif := 'not_notified';
      END IF;

      v_received := v_due - interval '18 hours';
      IF v_received > now() THEN
        v_received := now() - interval '2 hours';
      END IF;

      IF v_req_file AND v_op IN (1, 2, 3, 4) THEN
        v_file_id := v_file_pending;
      ELSIF v_req_file THEN
        v_file_id := v_file_received;
      ELSE
        v_file_id := NULL;
      END IF;

      IF v_req_quote AND v_op IN (2, 8, 12, 18) THEN
        v_quote_id := v_quote_pending;
      ELSIF v_req_quote THEN
        v_quote_id := v_quote_accepted;
      ELSE
        v_quote_id := NULL;
      END IF;

      v_payment_id := CASE WHEN v_op % 2 = 0 THEN v_pay_paid ELSE v_pay_pending END;

      v_member_idx := CASE
        WHEN v_op <= 3 THEN 1
        WHEN v_op <= 8 THEN 2
        WHEN v_op <= 12 THEN 3
        WHEN v_op <= 22 THEN 4
        WHEN v_op <= 27 THEN 5
        WHEN v_op <= 35 THEN 6
        ELSE 7
      END;
      v_member_id := pg_temp.demo_uuid(c_seed || ':team:' || lpad(v_member_idx::text, 2, '0'));

      IF v_priority = 'urgent' THEN
        v_context_id := v_ctx_urgent;
      END IF;
    END IF;

    INSERT INTO public.orders (
      id, tenant_id, title, description,
      client_id, service_id, assigned_team_member_id, status_id,
      entry_channel_id, order_context_id,
      file_status_id, quote_status_id, payment_status_id, delivery_method_id,
      priority, received_at, due_at, ready_at, delivered_at,
      customer_notification_status,
      customer_notified_at,
      metadata
    ) VALUES (
      v_order_id,
      v_demo,
      v_title,
      'Pedido comercial DEMO generado por seed ' || c_seed,
      v_client_id,
      v_service_id,
      v_member_id,
      v_status_id,
      v_channel_id,
      v_context_id,
      v_file_id,
      v_quote_id,
      v_payment_id,
      v_delivery_id,
      v_priority,
      v_received,
      v_due,
      v_ready_at,
      v_delivered,
      v_notif,
      CASE
        WHEN v_notif IN ('notified', 'notified_no_pickup') THEN coalesce(v_ready_at, v_received)
        ELSE NULL
      END,
      jsonb_build_object('seed', c_seed, 'seq', i)
    );
  END LOOP;

  -- =========================================================================
  -- 9) Replace activity with commercial timeline (fictitious team actors)
  -- =========================================================================
  DELETE FROM public.activity_log WHERE tenant_id = v_demo;

  FOR a IN 1..60 LOOP
    v_tm := pg_temp.demo_uuid(
      c_seed || ':team:' || lpad((((a - 1) % 7) + 1)::text, 2, '0')
    );

    IF a <= 10 THEN
      v_action := 'client.created';
      v_entity_type := 'client';
      v_entity_id := pg_temp.demo_uuid(c_seed || ':client:' || lpad(a::text, 2, '0'));
      v_event_at := now() - make_interval(days => 12, hours => -a);
    ELSIF a <= 16 THEN
      v_action := 'service.created';
      v_entity_type := 'service';
      v_entity_id := pg_temp.demo_uuid(c_seed || ':svc:' || lpad((a - 10)::text, 2, '0'));
      v_event_at := now() - make_interval(days => 11, hours => -(a - 10));
    ELSIF a <= 20 THEN
      v_action := 'team_member.created';
      v_entity_type := 'team_member';
      v_entity_id := pg_temp.demo_uuid(c_seed || ':team:' || lpad((a - 16)::text, 2, '0'));
      v_event_at := now() - make_interval(days => 10, hours => -(a - 16));
    ELSIF a <= 35 THEN
      v_action := 'order.created';
      v_entity_type := 'order';
      v_seq := 158 + (a - 20);
      IF v_seq > 200 THEN
        v_seq := 150 + (a % 40);
      END IF;
      v_entity_id := pg_temp.demo_uuid(c_seed || ':order:' || lpad(v_seq::text, 3, '0'));
      v_event_at := now() - make_interval(days => greatest(1, 14 - (a - 20)), hours => (a % 5));
    ELSIF a <= 45 THEN
      v_action := 'order.status_changed';
      v_entity_type := 'order';
      v_seq := 159 + (a - 35);
      v_entity_id := pg_temp.demo_uuid(c_seed || ':order:' || lpad(v_seq::text, 3, '0'));
      v_event_at := now() - make_interval(days => greatest(1, 8 - (a - 35)), hours => 3);
    ELSIF a <= 50 THEN
      v_action := 'order.notification_changed';
      v_entity_type := 'order';
      v_seq := 189 + (a - 45);
      v_entity_id := pg_temp.demo_uuid(c_seed || ':order:' || lpad(v_seq::text, 3, '0'));
      v_event_at := now() - make_interval(days => greatest(0, 3 - (a - 45)), hours => 5);
    ELSIF a <= 55 THEN
      v_action := 'order.details_changed';
      v_entity_type := 'order';
      v_seq := 160 + (a - 50);
      v_entity_id := pg_temp.demo_uuid(c_seed || ':order:' || lpad(v_seq::text, 3, '0'));
      v_event_at := now() - make_interval(days => greatest(1, 6 - (a - 50)));
    ELSE
      v_action := CASE (a % 3)
        WHEN 0 THEN 'order.management_changed'
        WHEN 1 THEN 'order.content_changed'
        ELSE 'order.client_changed'
      END;
      v_entity_type := 'order';
      v_seq := 170 + (a - 55);
      v_entity_id := pg_temp.demo_uuid(c_seed || ':order:' || lpad(v_seq::text, 3, '0'));
      v_event_at := now() - make_interval(days => greatest(1, 4 - (a - 55)), hours => 2);
    END IF;

    INSERT INTO public.activity_log (
      id, tenant_id, user_id, team_member_id,
      action, entity_type, entity_id,
      previous_values, new_values, metadata, created_at
    ) VALUES (
      pg_temp.demo_uuid(c_seed || ':activity:' || lpad(a::text, 3, '0')),
      v_demo,
      NULL,
      v_tm,
      v_action,
      v_entity_type,
      v_entity_id,
      NULL,
      jsonb_build_object('seed_event', a),
      jsonb_build_object('seed', c_seed),
      v_event_at
    );
  END LOOP;

  -- =========================================================================
  -- 10) Pre-commit validations
  -- =========================================================================
  SELECT count(*) INTO n FROM public.tenants WHERE slug = 'demo';
  IF n <> 1 THEN RAISE EXCEPTION 'VALIDATION: demo tenant count=%', n; END IF;

  SELECT count(*) INTO n FROM public.tenants WHERE slug = 'sur4';
  IF n <> 1 THEN RAISE EXCEPTION 'VALIDATION: sur4 tenant missing after seed'; END IF;

  SELECT count(*) INTO n FROM public.orders WHERE tenant_id = v_demo;
  IF n <> 200 THEN RAISE EXCEPTION 'VALIDATION: expected 200 orders, got %', n; END IF;

  SELECT count(*) INTO n FROM public.clients WHERE tenant_id = v_demo;
  IF n <> 30 THEN RAISE EXCEPTION 'VALIDATION: expected 30 clients, got %', n; END IF;

  SELECT count(*) INTO n FROM public.team_members WHERE tenant_id = v_demo AND user_id IS NULL;
  IF n <> 7 THEN RAISE EXCEPTION 'VALIDATION: expected 7 team_members, got %', n; END IF;

  SELECT count(*) INTO n FROM public.services WHERE tenant_id = v_demo;
  IF n <> 12 THEN RAISE EXCEPTION 'VALIDATION: expected 12 services, got %', n; END IF;

  SELECT count(*) INTO n FROM public.service_categories WHERE tenant_id = v_demo;
  IF n <> 5 THEN RAISE EXCEPTION 'VALIDATION: expected 5 categories, got %', n; END IF;

  SELECT count(*) INTO n FROM public.order_statuses WHERE tenant_id = v_demo;
  IF n <> 5 THEN RAISE EXCEPTION 'VALIDATION: expected 5 order_statuses, got %', n; END IF;

  SELECT count(*) INTO n_collected
  FROM public.orders o
  JOIN public.order_statuses s ON s.id = o.status_id AND s.tenant_id = o.tenant_id
  WHERE o.tenant_id = v_demo AND s.code = 'collected';
  IF n_collected <> 150 THEN RAISE EXCEPTION 'VALIDATION: expected 150 collected, got %', n_collected; END IF;

  SELECT count(*) INTO n_cancelled
  FROM public.orders o
  JOIN public.order_statuses s ON s.id = o.status_id AND s.tenant_id = o.tenant_id
  WHERE o.tenant_id = v_demo AND s.code = 'cancelled';
  IF n_cancelled <> 8 THEN RAISE EXCEPTION 'VALIDATION: expected 8 cancelled, got %', n_cancelled; END IF;

  SELECT count(*) INTO n_active
  FROM public.orders o
  JOIN public.order_statuses s ON s.id = o.status_id AND s.tenant_id = o.tenant_id
  WHERE o.tenant_id = v_demo
    AND s.is_closed IS NOT TRUE
    AND s.is_cancelled IS NOT TRUE;
  IF n_active <> 42 THEN RAISE EXCEPTION 'VALIDATION: expected 42 operative orders, got %', n_active; END IF;

  SELECT count(*) INTO n_urgent
  FROM public.orders o
  JOIN public.order_statuses s ON s.id = o.status_id AND s.tenant_id = o.tenant_id
  WHERE o.tenant_id = v_demo
    AND o.priority = 'urgent'
    AND s.is_closed IS NOT TRUE
    AND s.is_cancelled IS NOT TRUE;
  IF n_urgent < 1 THEN RAISE EXCEPTION 'VALIDATION: expected >=1 urgent operative'; END IF;

  SELECT count(*) INTO n_overdue
  FROM public.orders o
  JOIN public.order_statuses s ON s.id = o.status_id AND s.tenant_id = o.tenant_id
  WHERE o.tenant_id = v_demo
    AND s.is_closed IS NOT TRUE
    AND s.is_cancelled IS NOT TRUE
    AND o.due_at < now();
  IF n_overdue < 1 THEN RAISE EXCEPTION 'VALIDATION: expected >=1 overdue operative'; END IF;

  SELECT count(*) INTO n_today
  FROM public.orders o
  JOIN public.order_statuses s ON s.id = o.status_id AND s.tenant_id = o.tenant_id
  WHERE o.tenant_id = v_demo
    AND s.is_closed IS NOT TRUE
    AND s.is_cancelled IS NOT TRUE
    AND (o.due_at AT TIME ZONE v_tz)::date = (now() AT TIME ZONE v_tz)::date;
  IF n_today < 1 THEN RAISE EXCEPTION 'VALIDATION: expected >=1 due today operative'; END IF;

  SELECT count(*) INTO n_ready
  FROM public.orders o
  JOIN public.order_statuses s ON s.id = o.status_id AND s.tenant_id = o.tenant_id
  WHERE o.tenant_id = v_demo AND s.is_ready IS TRUE;
  IF n_ready < 1 THEN RAISE EXCEPTION 'VALIDATION: expected >=1 ready order'; END IF;

  SELECT count(*) INTO n_notified
  FROM public.orders
  WHERE tenant_id = v_demo AND customer_notification_status = 'notified';
  IF n_notified < 1 THEN RAISE EXCEPTION 'VALIDATION: expected >=1 notified'; END IF;

  SELECT count(*) INTO n_no_pickup
  FROM public.orders
  WHERE tenant_id = v_demo AND customer_notification_status = 'notified_no_pickup';
  IF n_no_pickup < 1 THEN RAISE EXCEPTION 'VALIDATION: expected >=1 notified_no_pickup'; END IF;

  SELECT count(*) INTO n_refs
  FROM (SELECT DISTINCT reference FROM public.orders WHERE tenant_id = v_demo) d;
  IF n_refs <> 200 THEN RAISE EXCEPTION 'VALIDATION: expected 200 distinct references, got %', n_refs; END IF;

  SELECT last_number INTO n_counter
  FROM public.order_number_counters
  WHERE tenant_id = v_demo;
  IF n_counter IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION 'VALIDATION: order counter expected 200, got %', n_counter;
  END IF;

  SELECT count(*) INTO n_foreign
  FROM public.orders o
  WHERE o.metadata->>'seed' = c_seed AND o.tenant_id <> v_demo;
  IF n_foreign <> 0 THEN RAISE EXCEPTION 'VALIDATION: seed orders outside demo=%', n_foreign; END IF;

  SELECT count(*) INTO n_sur4_orders
  FROM public.orders
  WHERE tenant_id = v_sur4 AND metadata->>'seed' = c_seed;
  IF n_sur4_orders <> 0 THEN RAISE EXCEPTION 'VALIDATION: SUR4 contaminated by demo seed'; END IF;

  SELECT count(*) INTO n_activity
  FROM public.activity_log
  WHERE tenant_id = v_demo AND metadata->>'seed' = c_seed;
  IF n_activity < 50 OR n_activity > 70 THEN
    RAISE EXCEPTION 'VALIDATION: activity commercial count expected 50-70, got %', n_activity;
  END IF;

  SELECT count(*) INTO n_foreign
  FROM public.orders o
  LEFT JOIN public.clients c ON c.id = o.client_id AND c.tenant_id = o.tenant_id
  LEFT JOIN public.services s ON s.id = o.service_id AND s.tenant_id = o.tenant_id
  LEFT JOIN public.team_members tm ON tm.id = o.assigned_team_member_id AND tm.tenant_id = o.tenant_id
  LEFT JOIN public.order_statuses os ON os.id = o.status_id AND os.tenant_id = o.tenant_id
  WHERE o.tenant_id = v_demo
    AND (
      (o.client_id IS NOT NULL AND c.id IS NULL)
      OR (o.service_id IS NOT NULL AND s.id IS NULL)
      OR (o.assigned_team_member_id IS NOT NULL AND tm.id IS NULL)
      OR os.id IS NULL
    );
  IF n_foreign <> 0 THEN
    RAISE EXCEPTION 'VALIDATION: broken/cross-tenant FKs in demo orders=%', n_foreign;
  END IF;

  RAISE NOTICE 'DEMO commercial seed OK: 200 orders / 30 clients / 7 team / 60 activity';
END;
$seed$;

COMMIT;
