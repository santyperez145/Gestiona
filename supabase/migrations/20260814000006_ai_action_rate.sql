-- G8 / AI Action Rate: una recomendación sólo cuenta como acción cuando el
-- servidor aplicó un cambio concreto al producto. La UI no escribe precios.
-- La métrica cubre por ahora el recomendador de ofertas, que es el flujo de IA
-- que ya persiste tanto la recomendación como el resultado de aplicarla.

CREATE INDEX IF NOT EXISTS ai_offer_recommendations_org_status_created_idx
  ON public.ai_offer_recommendations (org_id, status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ai_offer_recommendations'::regclass
      AND conname = 'ai_offer_recommendations_status_chk'
  ) THEN
    ALTER TABLE public.ai_offer_recommendations
      ADD CONSTRAINT ai_offer_recommendations_status_chk
      CHECK (status IN ('pending', 'applied', 'dismissed'));
  END IF;
END;
$$;

-- Antes, una policy FOR ALL permitía que el cliente marcara una recomendación
-- como aplicada sin haber ejecutado ninguna acción. Sólo se permite descartar
-- directo; aplicar pasa por el RPC de abajo, que también valida margen y precio.
DROP POLICY IF EXISTS "Org admins manage AI recs" ON public.ai_offer_recommendations;
DROP POLICY IF EXISTS "Org admins dismiss AI recs" ON public.ai_offer_recommendations;
CREATE POLICY "Org admins dismiss AI recs"
  ON public.ai_offer_recommendations
  FOR UPDATE TO authenticated
  USING (
    public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin'])
    AND status = 'pending'
  )
  WITH CHECK (
    public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin'])
    AND status = 'dismissed'
    AND applied_at IS NULL
  );

CREATE OR REPLACE FUNCTION public.apply_ai_offer_recommendation(
  p_recommendation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recommendation public.ai_offer_recommendations%ROWTYPE;
  v_sale_price numeric;
  v_profit_per_unit numeric;
  v_discount_percent numeric;
  v_resulting_margin_percent numeric;
  v_max_discount_percent numeric;
  v_min_margin_percent numeric;
  v_apply_price boolean;
  v_feature_product boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitás iniciar sesión para aplicar una recomendación';
  END IF;

  SELECT * INTO v_recommendation
  FROM public.ai_offer_recommendations
  WHERE id = p_recommendation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La recomendación no existe';
  END IF;

  IF NOT public.has_org_role(v_recommendation.org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'No tenés permiso para aplicar esta recomendación';
  END IF;

  IF v_recommendation.status = 'applied' THEN
    RETURN jsonb_build_object('ok', true, 'already_applied', true);
  END IF;

  IF v_recommendation.status <> 'pending' THEN
    RAISE EXCEPTION 'La recomendación ya fue descartada y no se puede aplicar';
  END IF;

  IF v_recommendation.product_id IS NULL THEN
    RAISE EXCEPTION 'La recomendación no tiene un producto al que aplicar';
  END IF;

  v_apply_price := v_recommendation.suggested_price_ars IS NOT NULL;
  v_feature_product := v_recommendation.offer_type = 'destacado';

  IF NOT v_apply_price AND NOT v_feature_product THEN
    RAISE EXCEPTION 'Esta recomendación no tiene una acción automática verificable';
  END IF;

  SELECT
    p.sale_price_ars,
    p.profit_per_unit_ars,
    COALESCE(s.max_ai_discount_percent, 35),
    COALESCE(s.margin_alert_percent, 30)
  INTO
    v_sale_price,
    v_profit_per_unit,
    v_max_discount_percent,
    v_min_margin_percent
  FROM public.products p
  LEFT JOIN public.settings s ON s.org_id = p.org_id
  WHERE p.id = v_recommendation.product_id
    AND p.org_id = v_recommendation.org_id
    AND p.is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto de la recomendación ya no está activo';
  END IF;

  IF v_apply_price THEN
    IF v_recommendation.suggested_price_ars <= 0
       OR v_sale_price <= 0
       OR v_recommendation.suggested_price_ars >= v_sale_price THEN
      RAISE EXCEPTION 'El precio sugerido debe ser mayor a cero y menor al precio de lista';
    END IF;

    v_discount_percent := (v_sale_price - v_recommendation.suggested_price_ars)
      / v_sale_price * 100;
    v_resulting_margin_percent := (
      v_recommendation.suggested_price_ars - (v_sale_price - v_profit_per_unit)
    ) / v_recommendation.suggested_price_ars * 100;

    IF v_discount_percent > v_max_discount_percent THEN
      RAISE EXCEPTION 'El descuento sugerido supera el máximo configurado para IA';
    END IF;

    IF v_resulting_margin_percent < v_min_margin_percent THEN
      RAISE EXCEPTION 'El precio sugerido deja un margen menor al mínimo configurado';
    END IF;

    IF v_recommendation.duration_hours IS NOT NULL
       AND v_recommendation.duration_hours < 1 THEN
      RAISE EXCEPTION 'La duración de una oferta debe ser de al menos una hora';
    END IF;
  END IF;

  -- Sólo la base aplica el precio temporal. No toca stock ni totales.
  UPDATE public.products
  SET
    discount_price_ars = CASE
      WHEN v_apply_price THEN v_recommendation.suggested_price_ars
      ELSE discount_price_ars
    END,
    offer_expires_at = CASE
      WHEN NOT v_apply_price THEN offer_expires_at
      WHEN v_recommendation.duration_hours IS NULL THEN NULL
      ELSE now() + make_interval(hours => v_recommendation.duration_hours)
    END,
    featured = CASE WHEN v_feature_product THEN true ELSE featured END
  WHERE id = v_recommendation.product_id
    AND org_id = v_recommendation.org_id;

  UPDATE public.ai_offer_recommendations
  SET status = 'applied', applied_at = now(), dismissed_at = NULL
  WHERE id = v_recommendation.id;

  RETURN jsonb_build_object(
    'ok', true,
    'recommendation_id', v_recommendation.id,
    'price_applied', v_apply_price,
    'featured_applied', v_feature_product
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ai_offer_recommendation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_ai_offer_recommendation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_ai_offer_recommendation(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.platform_org_ai_actions AS
WITH recommendation_counts AS (
  SELECT
    org_id,
    COUNT(*)::integer AS recommendations_total,
    COUNT(*) FILTER (WHERE status = 'applied')::integer AS recommendations_applied,
    COUNT(*) FILTER (WHERE status = 'dismissed')::integer AS recommendations_dismissed,
    COUNT(*) FILTER (WHERE status = 'pending')::integer AS recommendations_pending,
    MIN(created_at) AS first_recommendation_at,
    MAX(created_at) AS last_recommendation_at,
    MAX(applied_at) AS last_applied_at
  FROM public.ai_offer_recommendations
  GROUP BY org_id
)
SELECT
  o.id AS org_id,
  o.name AS org_name,
  o.slug,
  COALESCE(rc.recommendations_total, 0) AS recommendations_total,
  COALESCE(rc.recommendations_applied, 0) AS recommendations_applied,
  COALESCE(rc.recommendations_dismissed, 0) AS recommendations_dismissed,
  COALESCE(rc.recommendations_pending, 0) AS recommendations_pending,
  CASE
    WHEN COALESCE(rc.recommendations_total, 0) > 0 THEN ROUND(
      rc.recommendations_applied::numeric / rc.recommendations_total::numeric * 100,
      1
    )
    ELSE NULL
  END AS action_rate_pct,
  rc.first_recommendation_at,
  rc.last_recommendation_at,
  rc.last_applied_at
FROM public.organizations o
LEFT JOIN recommendation_counts rc ON rc.org_id = o.id
WHERE public.is_platform_admin(auth.uid());

REVOKE ALL ON public.platform_org_ai_actions FROM PUBLIC;
REVOKE ALL ON public.platform_org_ai_actions FROM anon;
GRANT SELECT ON public.platform_org_ai_actions TO authenticated;

COMMENT ON VIEW public.platform_org_ai_actions IS
  'AI Action Rate del recomendador de ofertas: aplicada / recomendaciones persistidas. '
  'Sólo cuenta cambios ejecutados por apply_ai_offer_recommendation; no representa chats ni sugerencias no persistidas.';

-- Verificación contra la base real: crea un producto y una recomendación ZZ,
-- llama al RPC como un owner/admin real y borra ambos registros antes de salir.
DO $verificar$
DECLARE
  v_member record;
  v_product_id uuid;
  v_recommendation_id uuid;
  v_result jsonb;
  v_discount_price numeric;
  v_status text;
BEGIN
  SELECT org_id, user_id INTO v_member
  FROM public.memberships
  WHERE role::text IN ('owner', 'admin')
  ORDER BY created_at
  LIMIT 1;

  IF v_member.org_id IS NULL THEN
    RAISE EXCEPTION 'No hay owner o admin para verificar G8';
  END IF;

  INSERT INTO public.products (
    org_id, user_id, name, sku, sale_price_ars, profit_per_unit_ars, stock
  ) VALUES (
    v_member.org_id, v_member.user_id, 'ZZ G8 recomendación de oferta',
    'ZZ-G8-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
    10000, 5000, 0
  ) RETURNING id INTO v_product_id;

  INSERT INTO public.ai_offer_recommendations (
    org_id, user_id, product_id, offer_type, reason,
    suggested_discount_percent, suggested_price_ars, duration_hours,
    resulting_margin_percent, probability, recommended_channel
  ) VALUES (
    v_member.org_id, v_member.user_id, v_product_id, 'flash', 'ZZ G8',
    10, 9000, 24, 44.4, 'alta', 'catalogo_destacado'
  ) RETURNING id INTO v_recommendation_id;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_member.user_id::text, 'role', 'authenticated')::text,
    true
  );
  v_result := public.apply_ai_offer_recommendation(v_recommendation_id);

  SELECT discount_price_ars INTO v_discount_price
  FROM public.products WHERE id = v_product_id;
  SELECT status INTO v_status
  FROM public.ai_offer_recommendations WHERE id = v_recommendation_id;

  IF v_result->>'ok' <> 'true'
     OR v_discount_price <> 9000
     OR v_status <> 'applied' THEN
    RAISE EXCEPTION 'G8 no aplicó la recomendación de forma verificable';
  END IF;

  IF has_function_privilege('anon', 'public.apply_ai_offer_recommendation(uuid)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.platform_org_ai_actions', 'SELECT') THEN
    RAISE EXCEPTION 'G8 dejó permisos anónimos sobre la acción o la métrica';
  END IF;

  DELETE FROM public.ai_offer_recommendations WHERE id = v_recommendation_id;
  DELETE FROM public.products WHERE id = v_product_id;

  IF EXISTS (SELECT 1 FROM public.ai_offer_recommendations WHERE id = v_recommendation_id)
     OR EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id)
  THEN
    RAISE EXCEPTION 'Quedaron datos ZZ de la verificación G8';
  END IF;
END;
$verificar$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260814000006', 'ai_action_rate') ON CONFLICT DO NOTHING;
