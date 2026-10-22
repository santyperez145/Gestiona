-- La comisión de Nerqia, sólo sobre ventas de la tienda online.
--
-- Decisión del dueño (2026-10-22): «lo que son las comisiones del sistema
-- debería ser únicamente para las ventas por tienda online». Hasta acá la
-- regla se resolvía por canal y una regla `all` (o `pos`) habría cobrado
-- también en el local —QR de la caja— y en los links de pago, que se usan
-- para presupuestos y cuentas corrientes: plata de la gestión, no de la
-- tienda.
--
-- 1. `platform_commission_amount` devuelve 0 para todo canal que no sea
--    `online`. Es la única fuente: la usan el checkout de la tienda, el QR,
--    los links y la liquidación.
-- 2. `record_payment_settlement` deja de tratar un link de pago como
--    «online»: el canal sale de la fuente (`ecommerce` → online).
-- 3. `mercadopago-link` pide la comisión con canal `link` (cambio en la Edge).
--
-- Las reglas guardadas no se tocan: una `all` sigue cobrando en la tienda.
-- Reversible: volver a las definiciones de 20260821000058 y 20260731000013.
BEGIN;

CREATE OR REPLACE FUNCTION public.platform_commission_amount(
  p_org_id uuid,
  p_gross numeric,
  p_channel text DEFAULT 'online'
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rule record;
  v_plan uuid;
  v_fee numeric := 0;
BEGIN
  IF p_gross IS NULL OR p_gross <= 0 THEN RETURN 0; END IF;
  -- Sólo la tienda online paga comisión. El local (caja, QR) y los links de
  -- pago (presupuestos, cuentas corrientes) nunca: lo decidió el dueño el
  -- 2026-10-22. Una regla `pos` o `all` ya no cobra fuera de la tienda.
  IF p_channel IS DISTINCT FROM 'online' THEN RETURN 0; END IF;

  SELECT o.plan_id INTO v_plan FROM public.organizations o WHERE o.id = p_org_id;

  SELECT r.percent, r.fixed, r.max_per_transaction, r.min_per_transaction,
         r.tax_treatment, r.tax_rate_pct
  INTO v_rule
  FROM public.platform_commission_rules r
  WHERE r.is_active
    AND r.approval_status = 'approved'
    AND r.effective_from IS NOT NULL
    AND r.effective_from <= now()
    AND (r.effective_until IS NULL OR r.effective_until > now())
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
  -- Piso y techo limitan la tarifa comercial. Sólo un tratamiento aprobado
  -- como `added` suma el impuesto por encima de esa base.
  IF v_rule.tax_treatment = 'added' THEN
    v_fee := v_fee * (1 + COALESCE(v_rule.tax_rate_pct, 0) / 100.0);
  END IF;

  RETURN round(LEAST(v_fee, p_gross), 2);
END;
$$;

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
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

  -- Sólo el cobro de un pedido de la tienda es «online». Un link de pago era
  -- «online» también y se habría anotado una comisión que el link no cobra.
  v_channel := CASE p_source WHEN 'ecommerce' THEN 'online' WHEN 'pos' THEN 'pos' ELSE coalesce(p_source, 'otro') END;

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

REVOKE ALL ON FUNCTION public.platform_commission_amount(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_commission_amount(uuid, numeric, text) TO service_role;
REVOKE ALL ON FUNCTION public.record_payment_settlement(uuid, text, uuid, text, text, int, numeric, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_settlement(uuid, text, uuid, text, text, int, numeric, text, numeric, text, text) TO service_role;

COMMENT ON COLUMN public.platform_commission_rules.applies_to IS
  'Desde 2026-10-22 sólo cobra en la tienda online: `online` y `all` aplican a la tienda; el local (pos) y los links de pago no pagan comisión.';

COMMIT;
