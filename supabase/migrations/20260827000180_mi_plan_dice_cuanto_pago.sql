-- «Mi plan» dice cuánto paga este comercio, no cuánto sale el plan
--
-- ⚠️ La tarjeta del plan actual no mostraba **ningún** precio: nombre, estado y
-- fecha de renovación. Lo único con precio eran las tarjetas de los planes
-- contratables, que muestran el **precio de lista**.
--
-- Eso convivía bien mientras el precio de lista y el cobrado fueran lo mismo.
-- Desde que `subscriptions.precio_ars` existe, son dos cosas distintas: el
-- comercio que se suscribió a $19.900 sigue pagando $19.900 aunque la lista
-- diga otra cosa, porque el `preapproval` de MercadoPago se creó con aquel
-- monto.
--
-- 📌 Un comercio tiene que poder ver **cuánto se le cobra**. Mostrarle sólo el
-- precio de lista es mostrarle el precio de otro.
--
-- 📌 El cuerpo se regenera desde `pg_get_functiondef` con los campos nuevos
-- insertados, no se reescribe de memoria — es la regla que evitó romper
-- `mark_store_order_paid`.

CREATE OR REPLACE FUNCTION public.suscripcion_de_organizacion(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_r jsonb;
BEGIN
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización';
  END IF;

  SELECT jsonb_build_object(
    'subscription_id', s.id,
    'estado', s.status,
    'provider', s.provider,
    'ciclo', s.ciclo,
    'renueva_el', s.current_period_end,
    'cancela_al_final', s.cancel_at_period_end,
    'trial_hasta', s.trial_end,
    -- Lo que este comercio autorizó en MercadoPago. NULL = no consta, que NO
    -- es lo mismo que gratis: la pantalla tiene que poder decir «no consta».
    'precio_ars', s.precio_ars,
    'precio_ars_desde', s.precio_ars_desde,
    'plan', jsonb_build_object(
      'code', p.code, 'name', p.name,
      'price_ars_monthly', p.price_ars_monthly,
      'price_ars_yearly', p.price_ars_yearly,
      'max_products', p.max_products, 'max_users', p.max_users,
      'ai_enabled', p.ai_enabled),
    -- Cuánto falta para que venza. Negativo = ya venció.
    'dias_restantes', CASE WHEN s.current_period_end IS NULL THEN NULL
      ELSE EXTRACT(day FROM s.current_period_end - now())::int END)
  INTO v_r
  FROM public.subscriptions s
  LEFT JOIN public.plans p ON p.id = s.plan_id
  WHERE s.org_id = p_org
  ORDER BY s.created_at DESC LIMIT 1;

  RETURN COALESCE(v_r, jsonb_build_object('estado', 'sin_suscripcion'));
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org uuid;
  v_user uuid;
  v_r jsonb;
BEGIN
  -- La organización que sí tiene un precio acordado, leída como su miembro.
  SELECT s.org_id INTO v_org FROM public.subscriptions s WHERE s.precio_ars IS NOT NULL LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'sin suscripciones con precio acordado: no hay nada que verificar';
    RETURN;
  END IF;
  SELECT user_id INTO v_user FROM public.memberships WHERE org_id = v_org LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_r := public.suscripcion_de_organizacion(v_org);
  ASSERT v_r ? 'precio_ars', 'la respuesta no trae el precio acordado';
  ASSERT (v_r->>'precio_ars') IS NOT NULL,
    'el precio acordado vino vacío para una suscripción que lo tiene';

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'OK: Mi plan puede mostrar el precio realmente acordado';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000180', 'mi_plan_dice_cuanto_pago')
ON CONFLICT DO NOTHING;
