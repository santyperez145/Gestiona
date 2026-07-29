-- Los compradores de una tienda NO deben recibir una organización propia.
--
-- `handle_new_user_create_org` le crea a cada usuario nuevo un workspace, una
-- membresía `owner` y una suscripción de prueba de 14 días. Eso está bien para
-- quien se registra en Gestiona, pero con las cuentas de comprador de la
-- tienda online significaría que cada cliente que compra un perfume:
--   * se vuelve dueño de una organización en el SaaS,
--   * consume un trial y ensucia las métricas de negocio,
--   * al entrar a la app ve un panel de gestión vacío en vez de la tienda.
--
-- La distinción viaja en el metadata del signup (`account_type`), que la
-- tienda setea al registrar. Si falta, se asume registro normal en Gestiona:
-- el comportamiento por defecto no cambia.
-- Idempotente.

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
  -- Comprador de una tienda: sin organización, sin membresía, sin trial.
  IF COALESCE(NEW.raw_user_meta_data->>'account_type', '') = 'store_customer' THEN
    RETURN NEW;
  END IF;

  display_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'Mi Negocio');

  SELECT id INTO trial_plan_id FROM public.plans WHERE code = 'trial' LIMIT 1;

  INSERT INTO public.organizations (name, slug, owner_user_id, plan_id, trial_ends_at)
  VALUES (display_name || ' Workspace', public.generate_org_slug(display_name), NEW.id, trial_plan_id, now() + interval '14 days')
  RETURNING id INTO new_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  INSERT INTO public.subscriptions (org_id, plan_id, status, current_period_end)
  VALUES (new_org_id, trial_plan_id, 'trialing', now() + interval '14 days');

  INSERT INTO public.settings (org_id, user_id, business_name)
  VALUES (new_org_id, NEW.id, display_name)
  ON CONFLICT (org_id) DO NOTHING;

  RETURN NEW;
END;
$$;
