-- ═══════════════════════════════════════════════════════════════════════════
-- Cuánto le cuesta cobrar al comercio, por medio de pago
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La plataforma tenía un simulador de comisiones en `/platform/comisiones`. El
-- comercio no tenía nada: no había forma de que supiera que cobrar con tarjeta
-- en 12 cuotas le deja **mucho menos** que cobrar por transferencia.
--
-- Y es un dato que decide precios. Un comercio que no sabe que MercadoPago se
-- lleva ~6% + IVA en crédito publica el mismo precio para todos los medios y
-- descubre el agujero a fin de mes, cuando ya no puede recuperarlo.
--
-- ── La distinción que ordena todo: estimado vs cobrado ─────────────────────
--
-- `payment_provider_fees` es una **estimación**: sirve ANTES de la venta, para
-- decidir qué medios ofrecer y a qué precio.
--
-- `payment_transactions.provider_fee` es la **verdad**: es lo que el proveedor
-- informó que se llevó, y llega con cada cobro.
--
-- ⚠️ Y hoy no coinciden. La tabla dice que crédito en 1 pago cuesta 6,29% y los
-- dos cobros reales de 2026-08-11 informaron **$0,08 sobre $1** — que es ~8%.
-- Con montos de ARS 1 el redondeo a dos decimales domina cualquier porcentaje,
-- así que **no alcanza para concluir que la tabla esté mal**; alcanza para
-- saber que nadie lo verificó nunca contra un cobro de tamaño normal.
--
-- Por eso se muestran las dos cosas. Un estimado presentado como verdad es peor
-- que un estimado que dice que lo es.
--
-- 📌 **Las tarifas cargadas no están verificadas contra la tarifa oficial de
-- MercadoPago.** Se cargaron el 2026-07-30. Un relevamiento del 2026-08-26
-- encontró cifras publicadas distintas —~3,99% crédito, ~3,29% débito— pero en
-- una fuente secundaria, no en la página oficial de tarifas. **No se
-- reemplazan**: cambiar un número sin verificar por otro sin verificar no es
-- una mejora. Se marcan como lo que son.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. De dónde salió cada tarifa ──────────────────────────────────────────

ALTER TABLE public.payment_provider_fees
  ADD COLUMN IF NOT EXISTS fuente text,
  ADD COLUMN IF NOT EXISTS verificada_el date;

COMMENT ON COLUMN public.payment_provider_fees.fuente IS
  'De donde salio esta tarifa. Sin fuente es una estimacion sin respaldo, y la UI tiene que decirlo.';
COMMENT ON COLUMN public.payment_provider_fees.verificada_el IS
  'Ultima vez que se comparo contra la tarifa publicada del proveedor. NULL = nunca.';

UPDATE public.payment_provider_fees
   SET fuente = COALESCE(fuente, 'carga inicial 2026-07-30, sin verificar contra la tarifa oficial')
 WHERE provider = 'mercadopago' AND fuente IS NULL;

-- ── 2. Lo que le cuesta cobrar, por medio ──────────────────────────────────
--
-- Espejo en SQL de `computeSettlement` (`src/lib/paymentFees.ts`), que es la
-- función pura y testeada. Si se toca una, se toca la otra.

CREATE OR REPLACE VIEW public.costos_por_medio_de_pago AS
WITH regla AS (
  SELECT percent, fixed, min_per_transaction, max_per_transaction, tax_rate_pct, is_active
    FROM public.platform_commission_rules
   WHERE is_active AND applies_to IN ('online', 'todos')
   ORDER BY created_at DESC LIMIT 1
),
habilitados AS (
  SELECT o.org_id, pp.codigo AS provider, pp.nombre AS proveedor
    FROM public.org_payment_providers o
    JOIN public.payment_providers pp ON pp.codigo = o.provider
   WHERE o.habilitado
  UNION
  -- Efectivo y transferencia no necesitan habilitarse: siempre están.
  SELECT s.org_id, pp.codigo, pp.nombre
    FROM public.settings s
   CROSS JOIN public.payment_providers pp
   WHERE pp.conexion = 'ninguna'
)
SELECT
  h.org_id,
  h.provider,
  h.proveedor,
  f.method                                   AS medio,
  f.installments                             AS cuotas,
  f.percent_fee                              AS comision_pct,
  f.fixed_fee                                AS comision_fija,
  f.iva_on_fee_pct                           AS iva_sobre_comision_pct,
  -- El costo del proveedor con su IVA, en porcentaje del bruto.
  ROUND(f.percent_fee * (1 + f.iva_on_fee_pct / 100.0), 4) AS costo_proveedor_pct,
  -- La comisión de la plataforma, sólo si la regla está activa.
  COALESCE((SELECT r.percent * (1 + COALESCE(r.tax_rate_pct, 0) / 100.0) FROM regla r), 0) AS comision_plataforma_pct,
  -- ⚠️ El total es lo único que le importa al comercio para decidir un precio.
  ROUND(
    f.percent_fee * (1 + f.iva_on_fee_pct / 100.0)
    + COALESCE((SELECT r.percent * (1 + COALESCE(r.tax_rate_pct, 0) / 100.0) FROM regla r), 0)
  , 4)                                       AS costo_total_pct,
  -- Y cuánto le queda de cada $100.
  ROUND(100 - (
    f.percent_fee * (1 + f.iva_on_fee_pct / 100.0)
    + COALESCE((SELECT r.percent * (1 + COALESCE(r.tax_rate_pct, 0) / 100.0) FROM regla r), 0)
  ), 2)                                      AS neto_cada_100,
  f.release_days                             AS dias_para_cobrar,
  f.currency                                 AS moneda,
  f.notes                                    AS detalle,
  f.fuente,
  f.verificada_el,
  -- El dato que evita presentar una estimación como verdad.
  (f.verificada_el IS NULL)                  AS sin_verificar
FROM habilitados h
JOIN public.payment_provider_fees f
  ON f.provider = h.provider
 AND (f.effective_from IS NULL OR f.effective_from <= CURRENT_DATE)
WHERE public.is_org_member(h.org_id, auth.uid());

COMMENT ON VIEW public.costos_por_medio_de_pago IS
  'Cuanto le cuesta al comercio cobrar por cada medio: comision del proveedor con IVA, comision de plataforma y total. ESTIMACION: la verdad de cada cobro esta en comisiones_cobradas. Espejo de computeSettlement en src/lib/paymentFees.ts.';

GRANT SELECT ON public.costos_por_medio_de_pago TO authenticated;

-- ── 3. Lo que el proveedor cobró de verdad ─────────────────────────────────

CREATE OR REPLACE VIEW public.comisiones_cobradas AS
SELECT
  t.org_id,
  t.id                    AS transaccion_id,
  t.provider              AS proveedor,
  t.method                AS medio,
  t.created_at            AS fecha,
  t.gross_amount          AS bruto,
  t.provider_fee          AS comision_proveedor,
  t.provider_fee_iva      AS iva_comision,
  t.platform_fee          AS comision_plataforma,
  t.net_amount            AS neto,
  -- Lo cobrado, en porcentaje. Es el número comparable con la estimación.
  CASE WHEN COALESCE(t.gross_amount, 0) > 0
       THEN ROUND((COALESCE(t.provider_fee, 0) + COALESCE(t.provider_fee_iva, 0))
                  * 100 / t.gross_amount, 2)
  END                     AS costo_proveedor_real_pct,
  CASE WHEN COALESCE(t.gross_amount, 0) > 0
       THEN ROUND((COALESCE(t.provider_fee, 0) + COALESCE(t.provider_fee_iva, 0)
                   + COALESCE(t.platform_fee, 0)) * 100 / t.gross_amount, 2)
  END                     AS costo_total_real_pct,
  -- ⚠️ Con importes chicos el redondeo a dos decimales distorsiona cualquier
  -- porcentaje: $0,08 sobre $1 puede ser 6,29% redondeado. Debajo de este
  -- monto el porcentaje no se puede comparar con la estimación.
  (COALESCE(t.gross_amount, 0) < 1000) AS monto_muy_chico_para_comparar
FROM public.payment_transactions t
WHERE public.is_org_member(t.org_id, auth.uid());

COMMENT ON VIEW public.comisiones_cobradas IS
  'Lo que el proveedor informo que se llevo en cada cobro. Es la VERDAD; costos_por_medio_de_pago es la estimacion. Con importes chicos el redondeo distorsiona el porcentaje y la vista lo marca.';

GRANT SELECT ON public.comisiones_cobradas TO authenticated;

-- ── 4. Cuando el estimado y lo cobrado no coinciden ────────────────────────
--
-- Una tarifa mal cargada no se nota vendiendo: se nota cuando el margen del mes
-- no da. Esta vista lo pone del lado del comercio antes de eso.

CREATE OR REPLACE VIEW public.desvio_de_comisiones AS
SELECT
  c.org_id,
  c.proveedor,
  c.medio,
  count(*)::int                              AS cobros,
  ROUND(AVG(c.costo_proveedor_real_pct), 2)  AS real_promedio_pct,
  MAX(e.costo_proveedor_pct)                 AS estimado_pct,
  ROUND(AVG(c.costo_proveedor_real_pct) - MAX(e.costo_proveedor_pct), 2) AS desvio_pct,
  bool_and(c.monto_muy_chico_para_comparar)  AS solo_montos_chicos
FROM public.comisiones_cobradas c
LEFT JOIN public.costos_por_medio_de_pago e
  ON e.org_id = c.org_id AND e.provider = c.proveedor AND e.medio = c.medio AND e.cuotas = 0
WHERE c.costo_proveedor_real_pct IS NOT NULL
GROUP BY c.org_id, c.proveedor, c.medio;

COMMENT ON VIEW public.desvio_de_comisiones IS
  'Diferencia entre lo que la tarifa cargada estima y lo que el proveedor cobro. Si solo_montos_chicos es true, el desvio puede ser puro redondeo y no significa nada.';

GRANT SELECT ON public.desvio_de_comisiones TO authenticated;

-- Verificado: `anon` podia consultarlas (0 filas por el filtro de tenant, pero
-- el permiso estaba). Los costos de un comercio no son superficie publica.
REVOKE ALL ON public.costos_por_medio_de_pago FROM anon;
REVOKE ALL ON public.comisiones_cobradas FROM anon;
REVOKE ALL ON public.desvio_de_comisiones FROM anon;
