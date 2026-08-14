-- D4 / Límites de plan: el cliente puede anticipar el límite, pero la base es
-- la autoridad. Sin estos triggers un insert directo podía superar el plan.
--
-- No se aplica `max_sales_per_month` aquí: `sales` contiene líneas de venta,
-- no órdenes. Contar filas como órdenes cobraría varias veces una compra con
-- más de un producto. Ese límite se completa al definir la unidad de consumo
-- común entre POS y tienda online.

CREATE OR REPLACE FUNCTION public.organization_plan_limits(p_org_id uuid)
RETURNS TABLE (max_products integer, max_users integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.max_products, p.max_users
  FROM public.organizations o
  LEFT JOIN public.subscriptions s ON s.org_id = o.id
  LEFT JOIN public.plans p ON p.id = COALESCE(s.plan_id, o.plan_id)
  WHERE o.id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION public.enforce_product_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_products integer;
  v_products integer;
BEGIN
  -- Serializa altas del mismo comercio: dos inserts concurrentes no pueden
  -- leer el mismo conteo y pasar juntos el límite.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(NEW.org_id::text));

  SELECT max_products INTO v_max_products
  FROM public.organization_plan_limits(NEW.org_id);

  IF v_max_products IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_products
  FROM public.products
  WHERE org_id = NEW.org_id;

  IF v_products >= v_max_products THEN
    RAISE EXCEPTION 'Límite de % productos alcanzado para esta organización. Cambiá de plan para agregar otro.', v_max_products
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_product_plan_limit ON public.products;
CREATE TRIGGER trg_enforce_product_plan_limit
BEFORE INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.enforce_product_plan_limit();

CREATE OR REPLACE FUNCTION public.enforce_org_user_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_users integer;
  v_members integer;
  v_pending_invitations integer;
  v_redeeming_invitation boolean := false;
  v_seats_in_use integer;
BEGIN
  -- Una invitación vencida no consume un asiento. Al aceptar una invitación,
  -- la membresía entra antes de marcarla aceptada: se descuenta esa reserva
  -- puntual para no rechazar una aceptación válida por un instante.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(NEW.org_id::text));

  SELECT max_users INTO v_max_users
  FROM public.organization_plan_limits(NEW.org_id);

  IF v_max_users IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_members
  FROM public.memberships
  WHERE org_id = NEW.org_id;

  SELECT count(*) INTO v_pending_invitations
  FROM public.org_invitations
  WHERE org_id = NEW.org_id
    AND accepted_at IS NULL
    AND expires_at > now();

  IF TG_TABLE_NAME = 'memberships' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.org_invitations i
      JOIN auth.users u ON u.id = NEW.user_id
      WHERE i.org_id = NEW.org_id
        AND i.accepted_at IS NULL
        AND i.expires_at > now()
        AND lower(i.email) = lower(u.email)
    ) INTO v_redeeming_invitation;
  END IF;

  v_seats_in_use := v_members + v_pending_invitations
    - CASE WHEN v_redeeming_invitation THEN 1 ELSE 0 END;

  IF v_seats_in_use >= v_max_users THEN
    RAISE EXCEPTION 'Límite de % usuarios alcanzado para esta organización. Revocá una invitación pendiente o cambiá de plan.', v_max_users
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_org_invitation_plan_limit ON public.org_invitations;
CREATE TRIGGER trg_enforce_org_invitation_plan_limit
BEFORE INSERT ON public.org_invitations
FOR EACH ROW EXECUTE FUNCTION public.enforce_org_user_plan_limit();

DROP TRIGGER IF EXISTS trg_enforce_org_membership_plan_limit ON public.memberships;
CREATE TRIGGER trg_enforce_org_membership_plan_limit
BEFORE INSERT ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.enforce_org_user_plan_limit();

-- Son funciones de trigger internas; no son RPCs para el navegador.
REVOKE ALL ON FUNCTION public.organization_plan_limits(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.organization_plan_limits(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_product_plan_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_product_plan_limit() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_org_user_plan_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_org_user_plan_limit() FROM anon, authenticated;

-- Verificación integrada: usa un plan y una organización ZZ propios, no toca
-- cupos, productos ni miembros reales. El borrado final deja cero filas ZZ.
DO $verificar$
DECLARE
  v_user_id uuid;
  v_plan_id uuid;
  v_org_id uuid;
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_product_inserted boolean := false;
  v_invitation_inserted boolean := false;
  v_membership_inserted boolean := false;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'D4 necesita un usuario existente para la verificación ZZ';
  END IF;

  INSERT INTO public.plans (
    code, name, description, price_usd_monthly, price_usd_yearly,
    max_products, max_sales_per_month, max_users,
    ai_enabled, backups_enabled, custom_branding, active, sort_order
  ) VALUES (
    'zz-plan-limit-' || v_suffix, 'ZZ Plan límite', 'Sólo para verificar D4', 0, 0,
    2, NULL, 2,
    false, false, false, false, 999999
  ) RETURNING id INTO v_plan_id;

  INSERT INTO public.organizations (name, slug, owner_user_id, plan_id)
  VALUES ('ZZ límite de plan', 'zz-plan-limit-' || v_suffix, v_user_id, v_plan_id)
  RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  INSERT INTO public.products (org_id, user_id, name)
  VALUES
    (v_org_id, v_user_id, 'ZZ límite producto 1'),
    (v_org_id, v_user_id, 'ZZ límite producto 2');

  BEGIN
    INSERT INTO public.products (org_id, user_id, name)
    VALUES (v_org_id, v_user_id, 'ZZ límite producto rechazado');
    v_product_inserted := true;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    NULL;
  END;
  IF v_product_inserted THEN
    RAISE EXCEPTION 'D4 permitió un producto por encima del cupo';
  END IF;

  INSERT INTO public.org_invitations (org_id, email, role, invited_by)
  VALUES (v_org_id, 'zz-limit-' || v_suffix || '@invalid.test', 'viewer', v_user_id);

  BEGIN
    INSERT INTO public.org_invitations (org_id, email, role, invited_by)
    VALUES (v_org_id, 'zz-limit-second-' || v_suffix || '@invalid.test', 'viewer', v_user_id);
    v_invitation_inserted := true;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    NULL;
  END;
  IF v_invitation_inserted THEN
    RAISE EXCEPTION 'D4 permitió una invitación por encima del cupo';
  END IF;

  -- El trigger debe frenar también un insert directo a memberships antes de
  -- que la FK del UUID sintético intervenga: no se puede saltear por API.
  BEGIN
    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org_id, gen_random_uuid(), 'viewer');
    v_membership_inserted := true;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    NULL;
  END;
  IF v_membership_inserted THEN
    RAISE EXCEPTION 'D4 permitió una membresía directa por encima del cupo';
  END IF;

  DELETE FROM public.organizations WHERE id = v_org_id;
  DELETE FROM public.plans WHERE id = v_plan_id;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.plans WHERE id = v_plan_id) THEN
    RAISE EXCEPTION 'D4 dejó filas ZZ de verificación';
  END IF;
END;
$verificar$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260814000008', 'plan_limits_authority') ON CONFLICT DO NOTHING;
