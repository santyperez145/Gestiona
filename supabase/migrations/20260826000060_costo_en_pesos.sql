-- ═══════════════════════════════════════════════════════════════════════════
-- Un producto que se compra en pesos no tiene por qué pasar por el dólar
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Todo el modelo de costo es en dólares. Medido el 2026-08-26:
-- `products` tiene **sólo** `cost_usd` y `total_cost_usd`; `stock_movements`
-- **sólo** `unit_cost_usd`; `purchases` **sólo** `unit_cost_usd`. Y once
-- funciones multiplican por el tipo de cambio.
--
-- Eso es correcto para el comercio que nació este producto —importa, y su costo
-- de reposición **es** dólar— y es un problema para cualquier otro. Una
-- panadería que compra harina en pesos tiene dos salidas, las dos malas:
--
--   dividir su costo en pesos por la cotización y guardarlo como dólares — y
--   entonces su costo **crece solo** cada vez que se mueve el dólar, sin haber
--   comprado nada, y el margen se vuelve ficción;
--
--   dejar el costo en cero y perder margen, ganancia y valuación de stock.
--
-- ── Cómo lo resuelven los ERP que ya funcionan ────────────────────────────
--
-- El estándar —Odoo, SAP Business One, Dynamics— es el mismo en los tres:
-- **el costo del artículo se mantiene en la moneda de la empresa**. Una compra
-- en moneda extranjera se convierte **una vez, a la cotización del día de la
-- compra**, y ese número convertido es el costo. La historia no se vuelve a
-- convertir nunca.
--
-- Por eso este cambio no es sólo "agregar una columna de pesos": es que el
-- movimiento de stock **congele** el costo en pesos del momento. Sin eso, un
-- producto en pesos entra al ledger con costo cero, que es el bug que este repo
-- ya arregló dos veces por otras puertas.
--
-- ── Y la fórmula comercial ────────────────────────────────────────────────
--
-- ⚠️ "50% de ganancia" significa dos cosas distintas y confundirlas cuesta
-- plata:
--
--   **markup sobre el costo**: precio = costo × (1 + m). Costo 100, m=50% → 150.
--   **margen sobre el precio**: precio = costo / (1 - m). Costo 100, m=50% → 200.
--
-- Los ERP soportan las dos y las nombran distinto justamente porque nadie se
-- pone de acuerdo en cuál es "la" ganancia. Acá van las dos, con nombre
-- explícito, y el producto guarda cuál usa.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El costo en la moneda en que se compra ──────────────────────────────

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_ars       numeric,
  ADD COLUMN IF NOT EXISTS cost_currency  text,
  ADD COLUMN IF NOT EXISTS markup_pct     numeric,
  ADD COLUMN IF NOT EXISTS markup_mode    text;

DO $blk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_cost_currency_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_cost_currency_check
      CHECK (cost_currency IS NULL OR cost_currency IN ('ARS', 'USD'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_markup_mode_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_markup_mode_check
      CHECK (markup_mode IS NULL OR markup_mode IN ('sobre_costo', 'sobre_precio'));
  END IF;
END $blk$;

COMMENT ON COLUMN public.products.cost_ars IS
  'Costo unitario en pesos, para el comercio que compra en pesos. No pasa por el tipo de cambio.';
COMMENT ON COLUMN public.products.cost_currency IS
  'ARS o USD: cual es la moneda AUTORITATIVA del costo. NULL = se deduce (ARS si hay cost_ars, USD si no). No tiene default: adivinar la moneda del costo es adivinar el margen.';
COMMENT ON COLUMN public.products.markup_pct IS
  'Ganancia deseada sobre el costo, en porcentaje. Se interpreta segun markup_mode.';
COMMENT ON COLUMN public.products.markup_mode IS
  'sobre_costo: precio = costo * (1 + m). sobre_precio: precio = costo / (1 - m). Son numeros distintos y confundirlos cuesta plata.';

-- ── 2. El costo histórico se congela en pesos ──────────────────────────────
--
-- ⚠️ Ésta es la mitad que hace que el cambio sirva. El movimiento ya guardaba
-- `unit_cost_usd`, y el ledger lo multiplicaba por la cotización **de hoy**:
-- una devaluación reescribía el margen de las ventas del mes pasado. Con el
-- costo en pesos congelado en el movimiento, la historia queda quieta.

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS unit_cost_ars numeric;

COMMENT ON COLUMN public.stock_movements.unit_cost_ars IS
  'Costo unitario en pesos EN EL MOMENTO del movimiento. Congelado: la historia no se vuelve a convertir. Es lo que debe leer el ledger.';

-- ── 3. El resolver: cuánto cuesta este producto, en pesos ──────────────────

CREATE OR REPLACE FUNCTION public.costo_unitario_ars(
  p_org uuid,
  p_product_id uuid,
  p_variant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_p        public.products;
  v_moneda   text;
  v_costo    numeric;
  v_tc       numeric;
  v_costo_ars numeric;
BEGIN
  SELECT * INTO v_p FROM public.products WHERE id = p_product_id AND org_id = p_org;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('error', 'El producto no existe en esta organizacion');
  END IF;

  -- La moneda declarada manda. Si no hay ninguna declarada, se deduce de dónde
  -- está el número — y NO se adivina: si hay costo en pesos, es en pesos.
  v_moneda := COALESCE(
    v_p.cost_currency,
    CASE WHEN COALESCE(v_p.cost_ars, 0) > 0 THEN 'ARS' ELSE 'USD' END);

  IF v_moneda = 'ARS' THEN
    -- ⚠️ Sin tipo de cambio de por medio. Ése es todo el punto: el costo en
    -- pesos de quien compra en pesos no cambia porque se movio el dolar.
    v_costo_ars := public.redondear_moneda(COALESCE(v_p.cost_ars, 0), 'ARS');
    RETURN jsonb_build_object(
      'costo_ars',   v_costo_ars,
      'moneda',      'ARS',
      'tipo_cambio', NULL,
      'fuente',      'costo en pesos del producto');
  END IF;

  v_costo := COALESCE(NULLIF(v_p.total_cost_usd, 0), v_p.cost_usd, 0);

  SELECT er.usd_ars INTO v_tc
    FROM public.exchange_rates er
   WHERE er.org_id = p_org AND er.date <= CURRENT_DATE AND COALESCE(er.usd_ars, 0) > 0
   ORDER BY er.date DESC LIMIT 1;
  IF v_tc IS NULL THEN
    SELECT s.exchange_rate INTO v_tc FROM public.settings s WHERE s.org_id = p_org LIMIT 1;
  END IF;

  -- ⚠️ Sin cotización el costo NO es cero: es desconocido. Devolver 0 aca haria
  -- que el margen salga perfecto y falso, que es peor que no tener el dato.
  IF COALESCE(v_tc, 0) <= 0 AND v_costo > 0 THEN
    RETURN jsonb_build_object(
      'costo_ars',   NULL,
      'moneda',      'USD',
      'costo_usd',   v_costo,
      'tipo_cambio', NULL,
      'fuente',      'costo en dolares sin cotizacion cargada',
      'error',       'falta el tipo de cambio para convertir el costo');
  END IF;

  RETURN jsonb_build_object(
    'costo_ars',   public.redondear_moneda(v_costo * COALESCE(v_tc, 0), 'ARS'),
    'moneda',      'USD',
    'costo_usd',   v_costo,
    'tipo_cambio', v_tc,
    'fuente',      'costo en dolares convertido a la cotizacion vigente');
END;
$fn$;

REVOKE ALL ON FUNCTION public.costo_unitario_ars(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.costo_unitario_ars(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.costo_unitario_ars(uuid, uuid, uuid) IS
  'Costo unitario en pesos de un producto, respetando su moneda. Si el costo es en pesos NO pasa por el tipo de cambio. Si es en dolares y no hay cotizacion, devuelve error en vez de cero.';

-- ── 4. El precio sugerido, con las dos convenciones ────────────────────────

CREATE OR REPLACE FUNCTION public.precio_sugerido(
  p_costo_ars numeric,
  p_markup_pct numeric,
  p_modo text DEFAULT 'sobre_costo')
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $fn$
BEGIN
  IF COALESCE(p_costo_ars, 0) <= 0 OR p_markup_pct IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_modo = 'sobre_precio' THEN
    -- Margen sobre el precio de venta: el clasico "quiero ganar 40% de lo que
    -- vendo". Con 100% o mas no tiene solucion: el precio se iria a infinito.
    IF p_markup_pct >= 100 THEN RETURN NULL; END IF;
    RETURN public.redondear_moneda(p_costo_ars / (1 - p_markup_pct / 100.0), 'ARS');
  END IF;

  -- Markup sobre el costo: "le pongo 50% arriba".
  RETURN public.redondear_moneda(p_costo_ars * (1 + p_markup_pct / 100.0), 'ARS');
END;
$fn$;

COMMENT ON FUNCTION public.precio_sugerido(numeric, numeric, text) IS
  'Precio a partir del costo y la ganancia. sobre_costo: costo*(1+m). sobre_precio: costo/(1-m). Costo 100 con 50%: 150 y 200 respectivamente — por eso el modo es explicito.';

-- ── 5. Qué productos no tienen costo utilizable ────────────────────────────

CREATE OR REPLACE VIEW public.productos_sin_costo_utilizable AS
SELECT
  p.org_id,
  p.id AS product_id,
  p.name AS producto,
  p.sku,
  p.sale_price_ars AS precio,
  COALESCE(p.cost_currency,
    CASE WHEN COALESCE(p.cost_ars, 0) > 0 THEN 'ARS' ELSE 'USD' END) AS moneda_del_costo,
  CASE
    WHEN COALESCE(p.cost_ars, 0) = 0
     AND COALESCE(p.cost_usd, 0) = 0
     AND COALESCE(p.total_cost_usd, 0) = 0
      THEN 'sin costo cargado en ninguna moneda'
    WHEN COALESCE(p.cost_currency, 'USD') = 'USD'
     AND COALESCE(p.cost_ars, 0) = 0
     AND NOT EXISTS (SELECT 1 FROM public.settings s
                      WHERE s.org_id = p.org_id AND COALESCE(s.exchange_rate, 0) > 0)
     AND NOT EXISTS (SELECT 1 FROM public.exchange_rates e
                      WHERE e.org_id = p.org_id AND COALESCE(e.usd_ars, 0) > 0)
      THEN 'costo en dolares y la organizacion no tiene cotizacion cargada'
    ELSE NULL
  END AS motivo
FROM public.products p
WHERE public.is_org_member(p.org_id, auth.uid())
  AND (
    (COALESCE(p.cost_ars, 0) = 0 AND COALESCE(p.cost_usd, 0) = 0 AND COALESCE(p.total_cost_usd, 0) = 0)
    OR (COALESCE(p.cost_currency, 'USD') = 'USD'
        AND COALESCE(p.cost_ars, 0) = 0
        AND NOT EXISTS (SELECT 1 FROM public.settings s
                         WHERE s.org_id = p.org_id AND COALESCE(s.exchange_rate, 0) > 0)
        AND NOT EXISTS (SELECT 1 FROM public.exchange_rates e
                         WHERE e.org_id = p.org_id AND COALESCE(e.usd_ars, 0) > 0))
  );

COMMENT ON VIEW public.productos_sin_costo_utilizable IS
  'Productos cuyo costo no se puede resolver a pesos, con el motivo. Cada uno es una venta que va a asentar margen equivocado.';

REVOKE ALL ON public.productos_sin_costo_utilizable FROM anon;
GRANT SELECT ON public.productos_sin_costo_utilizable TO authenticated;
