-- ═══════════════════════════════════════════════════════════════════════════
-- Cobrar la comisión, no sólo registrarla
--
-- `record_payment_settlement()` deja anotado cuánto le corresponde a la
-- plataforma de cada venta, pero eso es contabilidad: la plata entra entera a
-- la cuenta del comercio y nadie la separa nunca. Para cobrarla de verdad hay
-- que decírselo a MercadoPago **al crear la preferencia**, con `marketplace_fee`.
--
-- Esta migración extrae la resolución de la comisión a una función propia para
-- que la use tanto el checkout (antes de cobrar) como la liquidación (después).
-- Tener la misma cuenta escrita dos veces es cómo se termina cobrando un número
-- y registrando otro.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Cuánto le toca a la plataforma por una venta ──────────────────────────
--
-- Resuelve la regla de más específica a más general (acuerdo por org > plan >
-- regla base) y aplica piso y techo. Espejo de `platformFeeFor()` +
-- `resolvePlatformRule()` en src/lib/paymentFees.ts, que están testeados.
CREATE OR REPLACE FUNCTION public.platform_commission_amount(
  p_org_id  uuid,
  p_gross   numeric,
  p_channel text DEFAULT 'online'
)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule record;
  v_plan uuid;
  v_fee  numeric := 0;
BEGIN
  IF p_gross IS NULL OR p_gross <= 0 THEN RETURN 0; END IF;

  SELECT o.plan_id INTO v_plan FROM public.organizations o WHERE o.id = p_org_id;

  SELECT r.percent, r.fixed, r.max_per_transaction, r.min_per_transaction
  INTO v_rule
  FROM public.platform_commission_rules r
  WHERE r.is_active
    AND (r.applies_to = 'all' OR r.applies_to = p_channel)
    AND (r.org_id IS NULL OR r.org_id = p_org_id)
    AND (r.plan_id IS NULL OR r.plan_id = v_plan)
  ORDER BY
    (r.org_id IS NOT NULL)::int * 4
    + (r.plan_id IS NOT NULL)::int * 2
    + (r.applies_to <> 'all')::int DESC
  LIMIT 1;

  IF v_rule.percent IS NULL AND v_rule.fixed IS NULL THEN RETURN 0; END IF;

  v_fee := p_gross * COALESCE(v_rule.percent, 0) / 100.0 + COALESCE(v_rule.fixed, 0);
  IF v_rule.max_per_transaction IS NOT NULL THEN
    v_fee := LEAST(v_fee, v_rule.max_per_transaction);
  END IF;
  IF COALESCE(v_rule.min_per_transaction, 0) > 0 THEN
    v_fee := GREATEST(v_fee, v_rule.min_per_transaction);
  END IF;

  RETURN round(LEAST(v_fee, p_gross), 2);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_commission_amount(uuid, numeric, text) FROM PUBLIC;
-- Sólo service_role: la usan `store-pay` al crear la preferencia y el webhook
-- al liquidar. El navegador no tiene por qué poder consultarla.

COMMENT ON FUNCTION public.platform_commission_amount IS
  'Comisión de plataforma para una venta. La usan store-pay (marketplace_fee) y record_payment_settlement: si divergen, se cobra un número y se registra otro.';

-- ── La liquidación pasa a usar la misma función ───────────────────────────
-- Antes repetía la resolución de la regla inline.
CREATE OR REPLACE FUNCTION public.record_payment_settlement(
  p_org_id       uuid,
  p_source       text,
  p_source_id    uuid,
  p_provider     text,
  p_method       text,
  p_installments int,
  p_gross        numeric,
  p_external_id  text DEFAULT NULL,
  p_actual_fee   numeric DEFAULT NULL,
  p_currency     text DEFAULT 'ARS',
  p_status       text DEFAULT 'approved'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fee      record;
  v_channel  text;
  v_provfee  numeric := 0;
  v_iva      numeric := 0;
  v_platform numeric := 0;
  v_net      numeric;
  v_release  int := 0;
  v_id       uuid;
BEGIN
  IF p_gross IS NULL OR p_gross <= 0 THEN RETURN NULL; END IF;

  v_channel := CASE WHEN p_source = 'pos' THEN 'pos' ELSE 'online' END;

  -- Arancel del procesador, de más específico a más general
  SELECT f.percent_fee, f.fixed_fee, f.iva_on_fee_pct, f.release_days
  INTO v_fee
  FROM public.payment_provider_fees f
  WHERE f.provider = p_provider
    AND f.currency = p_currency
    AND f.effective_from <= CURRENT_DATE
    AND (
      (f.method = p_method AND f.installments = COALESCE(p_installments, 0))
      OR (f.method = p_method AND f.installments = 0)
      OR f.method = 'default'
    )
  ORDER BY
    (f.method = p_method AND f.installments = COALESCE(p_installments, 0)) DESC,
    (f.method = p_method) DESC,
    f.effective_from DESC
  LIMIT 1;

  -- Si el procesador informó lo que cobró de verdad, ese número gana sobre el
  -- tarifario: es el que efectivamente salió de la cuenta.
  IF p_actual_fee IS NOT NULL AND p_actual_fee >= 0 THEN
    v_provfee := round(p_actual_fee, 2);
  ELSE
    v_provfee := round(p_gross * COALESCE(v_fee.percent_fee, 0) / 100.0
                       + COALESCE(v_fee.fixed_fee, 0), 2);
  END IF;
  v_iva     := round(v_provfee * COALESCE(v_fee.iva_on_fee_pct, 0) / 100.0, 2);
  v_release := COALESCE(v_fee.release_days, 0);

  -- Misma función que usó el checkout para el marketplace_fee
  v_platform := public.platform_commission_amount(p_org_id, p_gross, v_channel);

  -- Nunca un neto negativo: sería un dato inventado que descuadra la contabilidad
  v_net := round(GREATEST(0, p_gross - v_provfee - v_iva - v_platform), 2);

  INSERT INTO public.payment_transactions (
    org_id, source, source_id, provider, method, installments,
    gross_amount, provider_fee, provider_fee_iva, platform_fee, net_amount,
    currency, status, external_id, expected_release_at, released_at
  ) VALUES (
    p_org_id, p_source, p_source_id, p_provider, COALESCE(p_method, 'default'),
    COALESCE(p_installments, 0),
    round(p_gross, 2), v_provfee, v_iva, v_platform, v_net,
    p_currency, p_status, p_external_id,
    CURRENT_DATE + v_release,
    CASE WHEN p_status = 'approved' AND v_release = 0 THEN now() ELSE NULL END
  )
  ON CONFLICT (provider, external_id) DO UPDATE
    SET status = EXCLUDED.status, updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_settlement(
  uuid, text, uuid, text, text, int, numeric, text, numeric, text, text) FROM PUBLIC;
