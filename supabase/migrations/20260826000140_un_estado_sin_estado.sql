-- ═══════════════════════════════════════════════════════════════════════════
-- Una recomendación sin estado no es una recomendación
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Continuación del barrido que empezó con `20260826000130`. Ahí el guard de
-- reintegros se salteaba con un NULL porque `x <> 'literal'` da NULL y un
-- `IF NULL THEN` no ejecuta. La pregunta obvia era: **¿dónde más?**
--
-- ── El barrido, y por qué casi todo estaba bien ───────────────────────────
--
-- Se revisaron las 39 comparaciones `<> 'literal'` dentro de un `IF` que lanza,
-- en las funciones `SECURITY DEFINER` de `public` (medido 2026-08-26). El bug
-- sólo muerde si la columna comparada puede ser NULL, y casi todas son NOT NULL:
-- `ecommerce_orders.payment_status`, `purchase_orders.status`, los estados de
-- `finance_document_*`, los del conteo físico, `payment_transactions.status`.
--
-- Quedan **dos** guards sobre una columna nullable, y los dos leen la misma:
-- `ai_offer_recommendations.status`.
--
--     apply_ai_offer_recommendation   status <> 'pending'
--     revert_price_change_proposal    status <> 'applied'
--
-- 📌 Vale la pena decir que `revert_price_change_proposal` **ya usaba**
-- `IS DISTINCT FROM` en sus otros tres chequeos —el precio y el destacado— así
-- que el idioma estaba presente en la misma función; sólo no se aplicó al
-- estado. Es el tipo de olvido que ningún test agarra.
--
-- ── Y el CHECK tampoco lo frenaba ─────────────────────────────────────────
--
-- ⚠️ La restricción es `CHECK (status = ANY (ARRAY['pending','applied',
-- 'dismissed','reverted']))`. Con `status = NULL` esa expresión evalúa a NULL, y
-- **un CHECK sólo falla con FALSE**: NULL lo deja pasar. La constraint que
-- parece enumerar los estados válidos acepta "ninguno de ellos".
--
-- Barrido de ese patrón: **27 columnas nullable con un CHECK de lista** en
-- `public` (2026-08-26). No se tocan las 27: en la mayoría NULL significa "sin
-- definir" y es correcto —la familia olfativa de un perfume, la clase ABC de un
-- producto, el resultado de una actividad de CRM, el `resultado` de un
-- comprobante de ARCA que todavía no respondió—. Cambiarlas en masa rompería
-- semántica real. Sólo se ajusta ésta, donde NULL no significa nada: una
-- recomendación siempre está en alguno de los cuatro estados.
--
-- ── Qué tan alcanzable era ────────────────────────────────────────────────
--
-- **No desde el cliente**, y conviene decirlo con precisión en vez de exagerar
-- el hallazgo. La policy de UPDATE exige `status = 'dismissed'`, que con NULL da
-- NULL y una policy necesita TRUE; y no hay policy de INSERT. Sólo una Edge
-- Function con `service_role` podría escribir NULL. Medido: 25 filas, **0 con
-- status NULL**.
--
-- Es defensa en profundidad, no un incendio. Se arregla ahora porque cuesta dos
-- líneas y porque la próxima función que lea esta tabla no tiene por qué
-- acordarse de esto.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- El estado deja de poder faltar. 25 filas, 0 en NULL, y hay DEFAULT 'pending'.
ALTER TABLE public.ai_offer_recommendations
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL;

COMMENT ON COLUMN public.ai_offer_recommendations.status IS
  'pending | applied | dismissed | reverted. NOT NULL desde 2026-08-26: el CHECK de lista dejaba pasar NULL (un CHECK solo falla con FALSE) y dos guards se salteaban con el.';

CREATE OR REPLACE FUNCTION public.apply_ai_offer_recommendation(p_recommendation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recommendation public.ai_offer_recommendations%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_authority jsonb;
  v_cost_ars numeric;
  v_discount_percent numeric;
  v_resulting_margin_percent numeric;
  v_max_discount_percent numeric;
  v_min_margin_percent numeric;
  v_apply_price boolean;
  v_feature_product boolean;
  v_applied_at timestamptz := clock_timestamp();
  v_window_hours integer;
  v_baseline_start timestamptz;
  v_baseline jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion para aplicar una recomendacion';
  END IF;

  SELECT * INTO v_recommendation
  FROM public.ai_offer_recommendations recommendation
  WHERE recommendation.id = p_recommendation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La recomendacion no existe';
  END IF;
  IF NOT public.has_permission(v_recommendation.org_id, 'marketing', 'edit') THEN
    RAISE EXCEPTION 'No tenes permiso para aplicar esta recomendacion'
      USING ERRCODE = '42501';
  END IF;
  IF v_recommendation.status = 'applied' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_applied', true,
      'recommendation_id', v_recommendation.id,
      'measurement_due_at', v_recommendation.measurement_due_at
    );
  END IF;
  IF v_recommendation.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'La recomendacion no esta pendiente y no se puede aplicar';
  END IF;
  IF v_recommendation.product_id IS NULL THEN
    RAISE EXCEPTION 'La recomendacion no tiene un producto al que aplicar';
  END IF;

  v_apply_price := v_recommendation.suggested_price_ars IS NOT NULL;
  v_feature_product := v_recommendation.offer_type = 'destacado';
  IF NOT v_apply_price AND NOT v_feature_product THEN
    RAISE EXCEPTION 'Esta recomendacion no tiene una accion automatica verificable';
  END IF;

  SELECT product.* INTO v_product
  FROM public.products product
  WHERE product.id = v_recommendation.product_id
    AND product.org_id = v_recommendation.org_id
    AND product.is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto de la recomendacion ya no esta activo';
  END IF;

  SELECT
    COALESCE(settings.max_ai_discount_percent, 35),
    COALESCE(settings.margin_alert_percent, 30)
  INTO v_max_discount_percent, v_min_margin_percent
  FROM public.settings settings
  WHERE settings.org_id = v_recommendation.org_id
  LIMIT 1;
  v_max_discount_percent := COALESCE(v_max_discount_percent, 35);
  v_min_margin_percent := COALESCE(v_min_margin_percent, 30);

  IF v_apply_price THEN
    v_authority := public.precio_pos_autoritativo(
      v_recommendation.org_id,
      v_recommendation.product_id,
      NULL,
      1
    );
    v_cost_ars := COALESCE((v_authority->>'costo_ars')::numeric, 0);

    IF v_recommendation.suggested_price_ars <= 0
       OR COALESCE(v_product.sale_price_ars, 0) <= 0
       OR v_recommendation.suggested_price_ars >= v_product.sale_price_ars THEN
      RAISE EXCEPTION 'El precio sugerido debe ser mayor a cero y menor al precio de lista';
    END IF;
    IF COALESCE(v_product.discount_price_ars, 0) > 0
       AND (v_product.offer_expires_at IS NULL OR v_product.offer_expires_at > v_applied_at)
       AND v_recommendation.suggested_price_ars >= v_product.discount_price_ars THEN
      RAISE EXCEPTION 'La oferta sugerida no mejora el descuento vigente';
    END IF;

    v_discount_percent := (v_product.sale_price_ars - v_recommendation.suggested_price_ars)
      / v_product.sale_price_ars * 100;
    v_resulting_margin_percent := CASE
      WHEN v_recommendation.suggested_price_ars > 0 THEN
        (v_recommendation.suggested_price_ars - v_cost_ars)
          / v_recommendation.suggested_price_ars * 100
      ELSE NULL
    END;

    IF v_discount_percent > v_max_discount_percent THEN
      RAISE EXCEPTION 'El descuento sugerido supera el maximo configurado para IA';
    END IF;
    IF v_resulting_margin_percent < v_min_margin_percent THEN
      RAISE EXCEPTION 'El precio sugerido deja un margen menor al minimo configurado';
    END IF;
    IF v_recommendation.duration_hours IS NOT NULL
       AND v_recommendation.duration_hours < 1 THEN
      RAISE EXCEPTION 'La duracion de una oferta debe ser de al menos una hora';
    END IF;

    v_window_hours := LEAST(GREATEST(COALESCE(v_recommendation.duration_hours, 336), 1), 720);
    v_baseline_start := v_applied_at - make_interval(hours => v_window_hours);
    v_baseline := public.price_change_window_metrics(
      v_recommendation.org_id,
      v_recommendation.product_id,
      v_baseline_start,
      v_applied_at
    );
  END IF;

  UPDATE public.products
  SET discount_price_ars = CASE
        WHEN v_apply_price THEN v_recommendation.suggested_price_ars
        ELSE discount_price_ars
      END,
      offer_expires_at = CASE
        WHEN NOT v_apply_price THEN offer_expires_at
        WHEN v_recommendation.duration_hours IS NULL THEN NULL
        ELSE v_applied_at + make_interval(hours => v_recommendation.duration_hours)
      END,
      featured = CASE WHEN v_feature_product THEN true ELSE featured END
  WHERE id = v_product.id AND org_id = v_product.org_id;

  UPDATE public.ai_offer_recommendations
  SET status = 'applied',
      applied_at = v_applied_at,
      applied_by = auth.uid(),
      dismissed_at = NULL,
      original_sale_price_ars = v_product.sale_price_ars,
      original_discount_price_ars = v_product.discount_price_ars,
      original_offer_expires_at = v_product.offer_expires_at,
      original_featured = v_product.featured,
      applied_price_ars = CASE WHEN v_apply_price THEN suggested_price_ars END,
      resulting_margin_percent = CASE
        WHEN v_apply_price THEN round(v_resulting_margin_percent, 2)
        ELSE resulting_margin_percent
      END,
      measurement_window_hours = v_window_hours,
      measurement_due_at = CASE
        WHEN v_apply_price THEN v_applied_at + make_interval(hours => v_window_hours)
      END,
      reverted_at = NULL,
      reverted_by = NULL,
      revert_reason = NULL
  WHERE id = v_recommendation.id;

  IF v_apply_price THEN
    INSERT INTO public.price_change_impact_events (
      org_id, recommendation_id, product_id, event_type, occurred_at, actor_id,
      window_start_at, window_end_at, window_days, is_mature,
      baseline_units, baseline_revenue_ars, baseline_contribution_ars,
      baseline_explainable_revenue_ars, baseline_coverage_pct, metadata
    ) VALUES (
      v_recommendation.org_id, v_recommendation.id, v_recommendation.product_id,
      'applied', v_applied_at, auth.uid(), v_baseline_start, v_applied_at,
      v_window_hours / 24.0, true,
      COALESCE((v_baseline->>'units')::numeric, 0),
      COALESCE((v_baseline->>'revenue_ars')::numeric, 0),
      (v_baseline->>'contribution_ars')::numeric,
      COALESCE((v_baseline->>'explainable_revenue_ars')::numeric, 0),
      (v_baseline->>'coverage_pct')::numeric,
      jsonb_build_object(
        'original_sale_price_ars', v_product.sale_price_ars,
        'original_discount_price_ars', v_product.discount_price_ars,
        'applied_price_ars', v_recommendation.suggested_price_ars,
        'cost_snapshot_ars', v_cost_ars,
        'resulting_margin_percent', round(v_resulting_margin_percent, 2),
        'baseline_line_count', COALESCE((v_baseline->>'line_count')::integer, 0),
        'baseline_explainable_line_count', COALESCE((v_baseline->>'explainable_line_count')::integer, 0)
      )
    )
    ON CONFLICT (recommendation_id, event_type) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, entity_label,
    old_values, new_values, details, severity, tags
  ) VALUES (
    auth.uid(), v_recommendation.org_id, 'apply', 'price_change_proposal',
    v_recommendation.id::text, v_product.name,
    jsonb_build_object(
      'sale_price_ars', v_product.sale_price_ars,
      'discount_price_ars', v_product.discount_price_ars,
      'offer_expires_at', v_product.offer_expires_at,
      'featured', v_product.featured
    ),
    jsonb_build_object(
      'discount_price_ars', CASE WHEN v_apply_price THEN v_recommendation.suggested_price_ars ELSE v_product.discount_price_ars END,
      'offer_expires_at', CASE WHEN v_apply_price AND v_recommendation.duration_hours IS NOT NULL
        THEN v_applied_at + make_interval(hours => v_recommendation.duration_hours)
        ELSE v_product.offer_expires_at END,
      'featured', CASE WHEN v_feature_product THEN true ELSE v_product.featured END
    ),
    jsonb_build_object(
      'recommendation_reason', v_recommendation.reason,
      'measurement_due_at', CASE WHEN v_apply_price THEN v_applied_at + make_interval(hours => v_window_hours) END,
      'interpretation', 'observed_not_causal'
    ),
    'info', ARRAY['pricing', 'ai_action', 'approval']::text[]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'recommendation_id', v_recommendation.id,
    'price_applied', v_apply_price,
    'featured_applied', v_feature_product,
    'measurement_due_at', CASE WHEN v_apply_price
      THEN v_applied_at + make_interval(hours => v_window_hours) END,
    'baseline', v_baseline
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.revert_price_change_proposal(p_recommendation_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recommendation public.ai_offer_recommendations%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_reverted_at timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_recommendation
  FROM public.ai_offer_recommendations recommendation
  WHERE recommendation.id = p_recommendation_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'La propuesta no existe'; END IF;
  IF auth.uid() IS NULL
     OR NOT public.has_permission(v_recommendation.org_id, 'marketing', 'edit') THEN
    RAISE EXCEPTION 'No tenes permiso para revertir esta propuesta'
      USING ERRCODE = '42501';
  END IF;
  IF v_recommendation.status = 'reverted' THEN
    RETURN jsonb_build_object('ok', true, 'already_reverted', true);
  END IF;
  IF v_recommendation.status IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'Solo se puede revertir una propuesta aplicada';
  END IF;

  SELECT product.* INTO v_product
  FROM public.products product
  WHERE product.id = v_recommendation.product_id
    AND product.org_id = v_recommendation.org_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El producto ya no existe'; END IF;

  IF v_recommendation.applied_price_ars IS NOT NULL
     AND (
       v_product.discount_price_ars IS DISTINCT FROM v_recommendation.applied_price_ars
       OR v_product.offer_expires_at IS DISTINCT FROM (
         CASE WHEN v_recommendation.duration_hours IS NULL THEN NULL
           ELSE v_recommendation.applied_at
             + make_interval(hours => v_recommendation.duration_hours) END
       )
     ) THEN
    RAISE EXCEPTION 'El precio cambio despues de aplicar la propuesta; revisalo manualmente antes de revertir'
      USING ERRCODE = '40001';
  END IF;
  IF v_recommendation.offer_type = 'destacado'
     AND v_product.featured IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'El destacado cambio despues de aplicar la propuesta; no se puede pisar';
  END IF;

  UPDATE public.products
  SET discount_price_ars = CASE
        WHEN v_recommendation.applied_price_ars IS NOT NULL
          THEN v_recommendation.original_discount_price_ars
        ELSE discount_price_ars
      END,
      offer_expires_at = CASE
        WHEN v_recommendation.applied_price_ars IS NOT NULL
          THEN v_recommendation.original_offer_expires_at
        ELSE offer_expires_at
      END,
      featured = CASE
        WHEN v_recommendation.offer_type = 'destacado'
          THEN COALESCE(v_recommendation.original_featured, false)
        ELSE featured
      END
  WHERE id = v_product.id AND org_id = v_product.org_id;

  UPDATE public.ai_offer_recommendations
  SET status = 'reverted',
      reverted_at = v_reverted_at,
      reverted_by = auth.uid(),
      revert_reason = NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '')
  WHERE id = v_recommendation.id;

  IF v_recommendation.applied_price_ars IS NOT NULL THEN
    INSERT INTO public.price_change_impact_events (
      org_id, recommendation_id, product_id, event_type, occurred_at, actor_id,
      is_mature, baseline_units, baseline_revenue_ars,
      baseline_explainable_revenue_ars, interpretation, metadata
    ) VALUES (
      v_recommendation.org_id, v_recommendation.id, v_recommendation.product_id,
      'reverted', v_reverted_at, auth.uid(), false, 0, 0, 0,
      'observed_not_causal',
      jsonb_build_object(
        'restored_discount_price_ars', v_recommendation.original_discount_price_ars,
        'restored_offer_expires_at', v_recommendation.original_offer_expires_at,
        'reason', NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '')
      )
    )
    ON CONFLICT (recommendation_id, event_type) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, entity_label,
    old_values, new_values, details, severity, tags
  ) VALUES (
    auth.uid(), v_recommendation.org_id, 'revert', 'price_change_proposal',
    v_recommendation.id::text, v_product.name,
    jsonb_build_object(
      'discount_price_ars', v_product.discount_price_ars,
      'offer_expires_at', v_product.offer_expires_at,
      'featured', v_product.featured
    ),
    jsonb_build_object(
      'discount_price_ars', v_recommendation.original_discount_price_ars,
      'offer_expires_at', v_recommendation.original_offer_expires_at,
      'featured', v_recommendation.original_featured
    ),
    jsonb_build_object(
      'reason', NULLIF(left(btrim(COALESCE(p_reason, '')), 500), ''),
      'concurrent_change_guard', true
    ),
    'warning', ARRAY['pricing', 'reversal']::text[]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_reverted', false,
    'recommendation_id', v_recommendation.id,
    'restored_discount_price_ars', v_recommendation.original_discount_price_ars,
    'restored_offer_expires_at', v_recommendation.original_offer_expires_at
  );
END;
$function$
;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_notnull boolean;
  v_nulos   int;
  v_apply   text;
  v_revert  text;
  v_org     uuid;
  v_prod    uuid;
  v_usr     uuid;
  v_tipo    text;
  v_nueva   uuid;
  v_antes   int;
BEGIN
  SELECT a.attnotnull INTO v_notnull
    FROM pg_attribute a
   WHERE a.attrelid = 'public.ai_offer_recommendations'::regclass
     AND a.attname = 'status';
  ASSERT v_notnull, 'status sigue aceptando NULL';

  SELECT count(*) INTO v_nulos
    FROM public.ai_offer_recommendations WHERE status IS NULL;
  ASSERT v_nulos = 0, 'quedaron ' || v_nulos || ' filas con status NULL';

  -- Los dos guards quedaron a prueba de NULL.
  SELECT pg_get_functiondef(p.oid) INTO v_apply
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_ai_offer_recommendation';
  ASSERT v_apply LIKE '%status IS DISTINCT FROM ''pending''%',
    'apply_ai_offer_recommendation sigue comparando con <>';
  ASSERT v_apply NOT LIKE '%v_recommendation.status <> ''pending''%',
    'quedo la comparacion vieja en apply_ai_offer_recommendation';

  SELECT pg_get_functiondef(p.oid) INTO v_revert
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'revert_price_change_proposal';
  ASSERT v_revert LIKE '%status IS DISTINCT FROM ''applied''%',
    'revert_price_change_proposal sigue comparando con <>';

  -- ⚠️ Y en el otro sentido: la tabla tiene que seguir aceptando lo normal. Una
  --    migracion que rompiera el INSERT normal tambien pasaria los asserts de
  --    arriba.
  --
  --    ⚠️ Se inserta una fila ZZ propia y se borra POR ID. Nunca "la mas
  --    reciente": esta tabla tiene 25 filas reales y un DELETE por orden podria
  --    llevarse una que no es mia.
  SELECT count(*) INTO v_antes FROM public.ai_offer_recommendations;

  SELECT r.org_id, r.product_id, r.user_id, r.offer_type
    INTO v_org, v_prod, v_usr, v_tipo
    FROM public.ai_offer_recommendations r LIMIT 1;

  IF v_org IS NOT NULL THEN
    BEGIN
      INSERT INTO public.ai_offer_recommendations
        (org_id, product_id, user_id, offer_type, reason, status)
      VALUES (v_org, v_prod, v_usr, v_tipo, 'ZZ verificacion de migracion', 'pending')
      RETURNING id INTO v_nueva;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'un insert normal dejo de funcionar: %', SQLERRM;
    END;

    -- Y el default sigue puesto: sin status explicito tiene que quedar pending.
    ASSERT (SELECT status FROM public.ai_offer_recommendations WHERE id = v_nueva) = 'pending',
      'el insert no quedo en pending';

    DELETE FROM public.ai_offer_recommendations WHERE id = v_nueva;

    ASSERT (SELECT count(*) FROM public.ai_offer_recommendations) = v_antes,
      'quedo un resto: habia ' || v_antes || ' filas y ahora hay '
      || (SELECT count(*) FROM public.ai_offer_recommendations);
  END IF;

  RAISE NOTICE 'OK: status NOT NULL, los dos guards con IS DISTINCT FROM, el insert normal anda y no quedaron restos';
END $verif$;
