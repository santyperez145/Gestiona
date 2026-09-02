-- Sembrar automation_flows default al alta (idempotente).
-- Carrito abandonado vive en recover-abandoned-carts (cron aparte); acá
-- reactivación, stock y bienvenida — tablas propias, no iPaaS.

CREATE OR REPLACE FUNCTION public.seed_default_automation_flows(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id requerido';
  END IF;

  -- Reactivación: cliente sin comprar → email (el cron manda si hay canal).
  INSERT INTO public.automation_flows (
    org_id, name, trigger_type, trigger_config, action_type, action_config, active
  )
  SELECT p_org_id,
    'Reactivación: sin comprar 30 días',
    'customer_inactive',
    '{"days": 30}'::jsonb,
    'email',
    '{"subject": "Te extrañamos", "message": "Hace un tiempo que no nos visitás. Tenemos novedades pensadas para vos."}'::jsonb,
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.automation_flows f
    WHERE f.org_id = p_org_id
      AND f.trigger_type = 'customer_inactive'
      AND f.action_type = 'email'
      AND coalesce(f.trigger_config->>'days', '') = '30'
  );

  -- Stock bajo → notificación interna (siempre útil, sin canal externo).
  INSERT INTO public.automation_flows (
    org_id, name, trigger_type, trigger_config, action_type, action_config, active
  )
  SELECT p_org_id,
    'Stock bajo → aviso interno',
    'low_stock',
    '{"threshold": 5}'::jsonb,
    'notification',
    '{"message": "Hay productos con stock bajo — revisá reposición."}'::jsonb,
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.automation_flows f
    WHERE f.org_id = p_org_id
      AND f.trigger_type = 'low_stock'
      AND f.action_type = 'notification'
  );

  -- Producto agotado → notificación (back-in-stock operativo: avisar al equipo).
  INSERT INTO public.automation_flows (
    org_id, name, trigger_type, trigger_config, action_type, action_config, active
  )
  SELECT p_org_id,
    'Sin stock → aviso interno',
    'stock_out',
    '{}'::jsonb,
    'notification',
    '{"message": "Un producto se quedó sin stock."}'::jsonb,
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.automation_flows f
    WHERE f.org_id = p_org_id
      AND f.trigger_type = 'stock_out'
      AND f.action_type = 'notification'
  );

  -- Nuevo cliente → tarea de bienvenida.
  INSERT INTO public.automation_flows (
    org_id, name, trigger_type, trigger_config, action_type, action_config, active
  )
  SELECT p_org_id,
    'Nuevo cliente → tarea de bienvenida',
    'new_customer',
    '{}'::jsonb,
    'create_task',
    '{"task_priority": "medium", "task_due_days": 3, "message": "Contactar nuevo cliente y dar bienvenida"}'::jsonb,
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.automation_flows f
    WHERE f.org_id = p_org_id
      AND f.trigger_type = 'new_customer'
      AND f.action_type = 'create_task'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_default_automation_flows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_default_automation_flows(uuid) TO service_role;

-- Al crear organización (alta real), sembrar flows.
CREATE OR REPLACE FUNCTION public.handle_new_user_create_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  display_name text;
  trial_plan_id uuid;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'account_type', '') IN (
    'store_customer',
    'platform_invited_owner'
  ) THEN
    RETURN NEW;
  END IF;

  display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    'Mi Negocio'
  );

  SELECT id INTO trial_plan_id FROM public.plans WHERE code = 'trial' LIMIT 1;

  INSERT INTO public.organizations (name, slug, owner_user_id, plan_id, trial_ends_at)
  VALUES (
    display_name || ' Workspace',
    public.generate_org_slug(display_name),
    NEW.id,
    trial_plan_id,
    now() + interval '14 days'
  )
  RETURNING id INTO new_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  INSERT INTO public.subscriptions (org_id, plan_id, status, current_period_end)
  VALUES (new_org_id, trial_plan_id, 'trialing', now() + interval '14 days');

  INSERT INTO public.settings (org_id, user_id, business_name)
  VALUES (new_org_id, NEW.id, display_name)
  ON CONFLICT (org_id) DO NOTHING;

  PERFORM public.seed_default_automation_flows(new_org_id);

  RETURN NEW;
END;
$$;

-- Backfill orgs existentes sin esos flows.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_automation_flows(r.id);
  END LOOP;
END;
$$;

-- Verificación: toda org tiene al menos los 4 defaults o 0 orgs.
DO $$
DECLARE
  faltan int;
BEGIN
  SELECT count(*) INTO faltan
  FROM public.organizations o
  WHERE (
    SELECT count(*) FROM public.automation_flows f
    WHERE f.org_id = o.id
      AND f.trigger_type IN ('customer_inactive', 'low_stock', 'stock_out', 'new_customer')
  ) < 4;

  IF faltan > 0 THEN
    RAISE EXCEPTION 'seed_default_automation_flows incompleto en % organizaciones', faltan;
  END IF;
END;
$$;
