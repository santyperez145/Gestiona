-- F2 / Price Change Proposals e impact outcomes.
--
-- La recomendacion de ofertas ya exigia aprobacion humana y aplicaba el
-- descuento en servidor, pero perdia tres pruebas necesarias para afirmar que
-- el Business Copilot creo valor: el estado anterior, una reversion segura y
-- una ventana comparable de resultado. Este slice conserva esas pruebas sin
-- presentar un antes/despues observacional como causalidad.

ALTER TABLE public.ai_offer_recommendations
  ADD COLUMN IF NOT EXISTS applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_sale_price_ars numeric(14,4),
  ADD COLUMN IF NOT EXISTS original_discount_price_ars numeric(14,4),
  ADD COLUMN IF NOT EXISTS original_offer_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_featured boolean,
  ADD COLUMN IF NOT EXISTS applied_price_ars numeric(14,4),
  ADD COLUMN IF NOT EXISTS measurement_window_hours integer,
  ADD COLUMN IF NOT EXISTS measurement_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revert_reason text;

ALTER TABLE public.ai_offer_recommendations
  DROP CONSTRAINT IF EXISTS ai_offer_recommendations_status_chk;
ALTER TABLE public.ai_offer_recommendations
  ADD CONSTRAINT ai_offer_recommendations_status_chk
  CHECK (status IN ('pending', 'applied', 'dismissed', 'reverted'));

ALTER TABLE public.ai_offer_recommendations
  DROP CONSTRAINT IF EXISTS ai_offer_recommendations_measurement_window_chk;
ALTER TABLE public.ai_offer_recommendations
  ADD CONSTRAINT ai_offer_recommendations_measurement_window_chk
  CHECK (measurement_window_hours IS NULL OR measurement_window_hours BETWEEN 1 AND 720);

-- Hotfix descubierto por la verificacion real de este slice: al agregar
-- `override_de_precio NOT NULL`, v2 solo mandaba el campo cuando habia
-- override. `jsonb_populate_record` construye el composite con NULL explicito
-- y no aplica el DEFAULT de la tabla, por lo que una venta al precio normal
-- quedaba bloqueada. Siempre se persisten ahora baseline y booleano.
CREATE OR REPLACE FUNCTION public.create_sales_transaction_v2(
  p_org_id uuid,
  p_sales jsonb,
  p_source text DEFAULT 'pos'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_linea jsonb;
  v_precios jsonb;
  v_salida jsonb := '[]'::jsonb;
  v_qty numeric;
  v_precio numeric;
  v_pedido numeric;
  v_costo_ars numeric;
  v_overrides integer := 0;
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No tenes permiso para registrar ventas en esta organizacion';
  END IF;

  FOR v_linea IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_sales, '[]'::jsonb))
  LOOP
    v_qty := GREATEST(COALESCE((v_linea->>'quantity')::numeric, 0), 0);
    v_precios := public.precio_pos_autoritativo(
      p_org_id,
      NULLIF(v_linea->>'product_id', '')::uuid,
      NULLIF(v_linea->>'variant_id', '')::uuid,
      v_qty
    );
    v_precio := (v_precios->>'precio_vigente')::numeric;
    v_costo_ars := (v_precios->>'costo_ars')::numeric * v_qty;
    v_pedido := NULLIF(v_linea->>'unit_price_ars', '')::numeric;

    IF v_pedido IS NOT NULL AND abs(v_pedido - v_precio) > 0.01 THEN
      v_overrides := v_overrides + 1;
      v_linea := v_linea || jsonb_build_object(
        'unit_price_ars', v_pedido,
        'precio_autoritativo', v_precio,
        'override_de_precio', true
      );
      v_precio := v_pedido;
    ELSE
      v_linea := v_linea || jsonb_build_object(
        'unit_price_ars', v_precio,
        'precio_autoritativo', v_precio,
        'override_de_precio', false
      );
    END IF;

    v_linea := v_linea || jsonb_build_object(
      'total_ars', public.redondear_moneda(v_precio * v_qty, 'ARS'),
      'cost_per_unit_usd', (v_precios->>'costo_usd')::numeric,
      'cost_of_goods_ars', public.redondear_moneda(v_costo_ars, 'ARS'),
      'profit_ars', public.redondear_moneda(v_precio * v_qty - v_costo_ars, 'ARS')
    );

    IF COALESCE((v_precios->>'tipo_cambio')::numeric, 0) > 0 THEN
      v_linea := v_linea || jsonb_build_object(
        'profit_usd', round(
          (v_precio * v_qty - v_costo_ars) / (v_precios->>'tipo_cambio')::numeric,
          2
        )
      );
    ELSE
      v_linea := v_linea || jsonb_build_object('profit_usd', 0);
    END IF;

    v_salida := v_salida || jsonb_build_array(v_linea);
  END LOOP;

  RETURN public.create_sales_transaction(p_org_id, v_salida, p_source)
    || jsonb_build_object('overrides_de_precio', v_overrides);
END;
$function$;

COMMENT ON FUNCTION public.create_sales_transaction_v2(uuid, jsonb, text) IS
  'Venta POS con precio/costo server-side. Persiste siempre precio autoritativo y override booleano para que el composite nunca anule el default.';

REVOKE ALL ON FUNCTION public.create_sales_transaction_v2(uuid, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_transaction_v2(uuid, jsonb, text)
  TO authenticated;

CREATE TABLE IF NOT EXISTS public.price_change_impact_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recommendation_id uuid NOT NULL REFERENCES public.ai_offer_recommendations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('applied', 'measured', 'reverted')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  window_start_at timestamptz,
  window_end_at timestamptz,
  window_days numeric(12,6),
  is_mature boolean NOT NULL DEFAULT false,
  baseline_units numeric(14,4) NOT NULL DEFAULT 0,
  baseline_revenue_ars numeric(16,2) NOT NULL DEFAULT 0,
  baseline_contribution_ars numeric(16,2),
  baseline_explainable_revenue_ars numeric(16,2) NOT NULL DEFAULT 0,
  baseline_coverage_pct numeric(5,1),
  observed_units numeric(14,4),
  observed_revenue_ars numeric(16,2),
  observed_contribution_ars numeric(16,2),
  observed_explainable_revenue_ars numeric(16,2),
  observed_coverage_pct numeric(5,1),
  units_per_day_delta numeric(16,4),
  revenue_per_day_delta_ars numeric(16,2),
  contribution_per_day_delta_ars numeric(16,2),
  interpretation text NOT NULL DEFAULT 'observed_not_causal'
    CHECK (interpretation = 'observed_not_causal'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recommendation_id, event_type)
);

CREATE INDEX IF NOT EXISTS price_change_impact_events_org_occurred_idx
  ON public.price_change_impact_events (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS price_change_impact_events_product_idx
  ON public.price_change_impact_events (org_id, product_id, occurred_at DESC);

ALTER TABLE public.price_change_impact_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read price impact" ON public.price_change_impact_events;
CREATE POLICY "Org members read price impact"
  ON public.price_change_impact_events
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

REVOKE ALL ON TABLE public.price_change_impact_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.price_change_impact_events TO authenticated;

COMMENT ON TABLE public.price_change_impact_events IS
  'Evidencia append-like del action loop de precio. El resultado es observacional y nunca se etiqueta como causal sin experimento controlado.';

CREATE OR REPLACE FUNCTION public.price_change_window_metrics(
  p_org_id uuid,
  p_product_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH normalized AS (
    SELECT
      fact.*,
      GREATEST(fact.quantity - COALESCE(fact.returned_quantity, 0), 0) AS net_units,
      round(
        fact.revenue_ars * GREATEST(
          fact.quantity - COALESCE(fact.returned_quantity, 0), 0
        ) / NULLIF(fact.quantity, 0),
        2
      ) AS net_revenue_ars
    FROM public._sale_margin_facts_effective fact
    WHERE fact.org_id = p_org_id
      AND fact.product_id = p_product_id
      AND fact.sold_at >= p_window_start
      AND fact.sold_at < p_window_end
  )
  SELECT jsonb_build_object(
    'units', COALESCE(sum(fact.net_units), 0),
    'revenue_ars', round(COALESCE(sum(fact.net_revenue_ars), 0), 2),
    'contribution_ars', round(sum(fact.contribution_margin_ars)
      FILTER (WHERE fact.is_explainable), 2),
    'explainable_revenue_ars', round(COALESCE(sum(fact.net_revenue_ars)
      FILTER (WHERE fact.is_explainable), 0), 2),
    'coverage_pct', CASE
      WHEN COALESCE(sum(fact.net_revenue_ars), 0) > 0 THEN round(
        sum(fact.net_revenue_ars * fact.coverage_pct) / sum(fact.net_revenue_ars), 1)
      ELSE NULL
    END,
    'line_count', count(fact.sale_id),
    'explainable_line_count', count(fact.sale_id) FILTER (WHERE fact.is_explainable),
    'returned_units', COALESCE(sum(fact.returned_quantity), 0)
  )
  FROM normalized fact;
$function$;

COMMENT ON FUNCTION public.price_change_window_metrics(uuid, uuid, timestamptz, timestamptz) IS
  'Agregado interno de unidades, ingreso y contribucion canonica para una ventana de impacto.';

REVOKE ALL ON FUNCTION public.price_change_window_metrics(uuid, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_ai_offer_recommendation(
  p_recommendation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  IF v_recommendation.status <> 'pending' THEN
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
$function$;

REVOKE ALL ON FUNCTION public.apply_ai_offer_recommendation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_ai_offer_recommendation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.measure_price_change_outcome(
  p_recommendation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_recommendation public.ai_offer_recommendations%ROWTYPE;
  v_applied public.price_change_impact_events%ROWTYPE;
  v_observed jsonb;
  v_observed_end timestamptz;
  v_window_days numeric;
  v_mature boolean;
  v_baseline_days numeric;
  v_units_delta numeric;
  v_revenue_delta numeric;
  v_contribution_delta numeric;
  v_event_id uuid;
BEGIN
  SELECT * INTO v_recommendation
  FROM public.ai_offer_recommendations recommendation
  WHERE recommendation.id = p_recommendation_id
  FOR UPDATE;

  IF NOT FOUND OR v_recommendation.applied_price_ars IS NULL THEN
    RAISE EXCEPTION 'La propuesta de precio aplicada no existe';
  END IF;
  IF auth.uid() IS NULL
     OR NOT public.has_permission(v_recommendation.org_id, 'marketing', 'edit') THEN
    RAISE EXCEPTION 'No tenes permiso para medir esta propuesta'
      USING ERRCODE = '42501';
  END IF;
  IF v_recommendation.status NOT IN ('applied', 'reverted') THEN
    RAISE EXCEPTION 'La propuesta todavia no fue aplicada';
  END IF;

  SELECT * INTO v_applied
  FROM public.price_change_impact_events event
  WHERE event.recommendation_id = v_recommendation.id
    AND event.event_type = 'applied';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La propuesta no tiene una linea de base auditable';
  END IF;

  v_observed_end := LEAST(
    clock_timestamp(),
    COALESCE(v_recommendation.reverted_at, 'infinity'::timestamptz),
    v_recommendation.measurement_due_at
  );
  v_window_days := GREATEST(
    extract(epoch FROM (v_observed_end - v_recommendation.applied_at)) / 86400.0,
    0.000001
  );
  v_baseline_days := GREATEST(COALESCE(v_applied.window_days, 0), 0.000001);
  v_mature := v_observed_end >= v_recommendation.measurement_due_at;
  v_observed := public.price_change_window_metrics(
    v_recommendation.org_id,
    v_recommendation.product_id,
    v_recommendation.applied_at,
    v_observed_end + interval '1 microsecond'
  );

  v_units_delta := round(
    COALESCE((v_observed->>'units')::numeric, 0) / v_window_days
      - v_applied.baseline_units / v_baseline_days,
    4
  );
  v_revenue_delta := round(
    COALESCE((v_observed->>'revenue_ars')::numeric, 0) / v_window_days
      - v_applied.baseline_revenue_ars / v_baseline_days,
    2
  );
  v_contribution_delta := CASE
    WHEN v_applied.baseline_contribution_ars IS NOT NULL
     AND (v_observed->>'contribution_ars') IS NOT NULL THEN round(
      (v_observed->>'contribution_ars')::numeric / v_window_days
        - v_applied.baseline_contribution_ars / v_baseline_days,
      2
    )
  END;

  INSERT INTO public.price_change_impact_events (
    org_id, recommendation_id, product_id, event_type, occurred_at, actor_id,
    window_start_at, window_end_at, window_days, is_mature,
    baseline_units, baseline_revenue_ars, baseline_contribution_ars,
    baseline_explainable_revenue_ars, baseline_coverage_pct,
    observed_units, observed_revenue_ars, observed_contribution_ars,
    observed_explainable_revenue_ars, observed_coverage_pct,
    units_per_day_delta, revenue_per_day_delta_ars,
    contribution_per_day_delta_ars, metadata, updated_at
  ) VALUES (
    v_recommendation.org_id, v_recommendation.id, v_recommendation.product_id,
    'measured', clock_timestamp(), auth.uid(), v_recommendation.applied_at,
    v_observed_end, v_window_days, v_mature,
    v_applied.baseline_units, v_applied.baseline_revenue_ars,
    v_applied.baseline_contribution_ars,
    v_applied.baseline_explainable_revenue_ars, v_applied.baseline_coverage_pct,
    COALESCE((v_observed->>'units')::numeric, 0),
    COALESCE((v_observed->>'revenue_ars')::numeric, 0),
    (v_observed->>'contribution_ars')::numeric,
    COALESCE((v_observed->>'explainable_revenue_ars')::numeric, 0),
    (v_observed->>'coverage_pct')::numeric,
    v_units_delta, v_revenue_delta, v_contribution_delta,
    jsonb_build_object(
      'observation_line_count', COALESCE((v_observed->>'line_count')::integer, 0),
      'observation_explainable_line_count', COALESCE((v_observed->>'explainable_line_count')::integer, 0),
      'planned_window_hours', v_recommendation.measurement_window_hours,
      'ended_by_reversal', v_recommendation.reverted_at IS NOT NULL
    ),
    clock_timestamp()
  )
  ON CONFLICT (recommendation_id, event_type) DO UPDATE SET
    occurred_at = EXCLUDED.occurred_at,
    actor_id = EXCLUDED.actor_id,
    window_end_at = EXCLUDED.window_end_at,
    window_days = EXCLUDED.window_days,
    is_mature = EXCLUDED.is_mature,
    observed_units = EXCLUDED.observed_units,
    observed_revenue_ars = EXCLUDED.observed_revenue_ars,
    observed_contribution_ars = EXCLUDED.observed_contribution_ars,
    observed_explainable_revenue_ars = EXCLUDED.observed_explainable_revenue_ars,
    observed_coverage_pct = EXCLUDED.observed_coverage_pct,
    units_per_day_delta = EXCLUDED.units_per_day_delta,
    revenue_per_day_delta_ars = EXCLUDED.revenue_per_day_delta_ars,
    contribution_per_day_delta_ars = EXCLUDED.contribution_per_day_delta_ars,
    metadata = EXCLUDED.metadata,
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_event_id;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, entity_label,
    details, severity, tags
  ) VALUES (
    auth.uid(), v_recommendation.org_id, 'measure', 'price_change_outcome',
    v_event_id::text, v_recommendation.id::text,
    jsonb_build_object(
      'recommendation_id', v_recommendation.id,
      'is_mature', v_mature,
      'window_days', round(v_window_days, 4),
      'units_per_day_delta', v_units_delta,
      'revenue_per_day_delta_ars', v_revenue_delta,
      'contribution_per_day_delta_ars', v_contribution_delta,
      'interpretation', 'observed_not_causal'
    ),
    'info', ARRAY['pricing', 'impact', 'observation']::text[]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'is_mature', v_mature,
    'window_days', round(v_window_days, 4),
    'units_per_day_delta', v_units_delta,
    'revenue_per_day_delta_ars', v_revenue_delta,
    'contribution_per_day_delta_ars', v_contribution_delta,
    'interpretation', 'observed_not_causal'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.measure_price_change_outcome(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.measure_price_change_outcome(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revert_price_change_proposal(
  p_recommendation_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  IF v_recommendation.status <> 'applied' THEN
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
$function$;

REVOKE ALL ON FUNCTION public.revert_price_change_proposal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_price_change_proposal(uuid, text) TO authenticated;

CREATE OR REPLACE VIEW public.price_change_proposal_outcomes
WITH (security_barrier = true)
AS
SELECT
  recommendation.id AS recommendation_id,
  recommendation.org_id,
  recommendation.product_id,
  product.name AS product_name,
  recommendation.reason,
  recommendation.status,
  recommendation.created_at,
  recommendation.applied_at,
  recommendation.applied_by,
  recommendation.applied_price_ars,
  recommendation.original_sale_price_ars,
  recommendation.original_discount_price_ars,
  recommendation.original_offer_expires_at,
  recommendation.measurement_window_hours,
  recommendation.measurement_due_at,
  recommendation.reverted_at,
  recommendation.reverted_by,
  recommendation.revert_reason,
  applied.baseline_units,
  applied.baseline_revenue_ars,
  applied.baseline_contribution_ars,
  applied.baseline_explainable_revenue_ars,
  applied.baseline_coverage_pct,
  measured.window_end_at AS observed_until,
  measured.window_days AS observed_window_days,
  measured.is_mature,
  measured.observed_units,
  measured.observed_revenue_ars,
  measured.observed_contribution_ars,
  measured.observed_explainable_revenue_ars,
  measured.observed_coverage_pct,
  measured.units_per_day_delta,
  measured.revenue_per_day_delta_ars,
  measured.contribution_per_day_delta_ars,
  measured.interpretation,
  measured.updated_at AS outcome_updated_at
FROM public.ai_offer_recommendations recommendation
JOIN public.products product
  ON product.id = recommendation.product_id
 AND product.org_id = recommendation.org_id
LEFT JOIN public.price_change_impact_events applied
  ON applied.recommendation_id = recommendation.id
 AND applied.event_type = 'applied'
LEFT JOIN public.price_change_impact_events measured
  ON measured.recommendation_id = recommendation.id
 AND measured.event_type = 'measured'
WHERE recommendation.applied_price_ars IS NOT NULL
  AND public.is_org_member(recommendation.org_id, auth.uid());

REVOKE ALL ON TABLE public.price_change_proposal_outcomes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.price_change_proposal_outcomes TO authenticated;

COMMENT ON VIEW public.price_change_proposal_outcomes IS
  'Propuesta, baseline congelada, estado reversible y resultado observado. Los deltas no prueban causalidad.';

DO $guard$
BEGIN
  IF has_function_privilege(
       'anon', 'public.apply_ai_offer_recommendation(uuid)', 'EXECUTE')
     OR has_function_privilege(
       'anon', 'public.measure_price_change_outcome(uuid)', 'EXECUTE')
     OR has_function_privilege(
       'anon', 'public.revert_price_change_proposal(uuid,text)', 'EXECUTE')
     OR has_function_privilege(
       'authenticated', 'public.price_change_window_metrics(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE')
     OR has_table_privilege(
       'anon', 'public.price_change_proposal_outcomes', 'SELECT')
     OR has_table_privilege(
       'authenticated', 'public.price_change_impact_events', 'INSERT')
     OR NOT has_function_privilege(
       'authenticated', 'public.measure_price_change_outcome(uuid)', 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated', 'public.revert_price_change_proposal(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Price impact loop privileges are unsafe';
  END IF;
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260822000007', 'price_change_impact_loop')
ON CONFLICT DO NOTHING;
