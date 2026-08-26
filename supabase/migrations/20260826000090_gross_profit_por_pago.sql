-- ═══════════════════════════════════════════════════════════════════════════
-- P0-09 — cuánto gana la plataforma en cada pago
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Último punto del economics gate: *"Gross profit por pago visible"*. Todo lo
-- demás ya estaba —comisión inactiva por defecto, regla versionada con
-- aprobación, simulador, `docs/ECONOMICS.md` separando medido de modelado— y
-- faltaba el número por transacción: `platform_revenue_monthly` lo agrega por
-- mes, que sirve para un tablero y no para entender **de dónde** sale.
--
-- ── Qué es gross profit acá, y qué no ─────────────────────────────────────
--
-- La plataforma cobra `platform_fee`. Contra eso hay que restar lo que le
-- cuesta ese pago:
--
--   **IVA sobre la comisión.** Si el tratamiento fiscal es `included`, el IVA
--   sale de adentro de lo cobrado y **no es ingreso**: es del fisco. Si es
--   `added`, se cobró aparte y tampoco lo es. En los dos casos se resta.
--
-- ⚠️ **Lo que NO se resta, y es deliberado:** la comisión del proveedor
-- (`provider_fee`) **no la paga la plataforma, la paga el comercio**. Restarla
-- del gross profit de la plataforma sería contar un costo ajeno y daría un
-- margen falsamente bajo. El modelo marketplace de MercadoPago acredita el neto
-- al vendedor y el `marketplace_fee` al dueño de la aplicación: son dos flujos
-- distintos.
--
-- 📌 Lo que sí falta para un gross profit completo es la infraestructura por
-- transacción —Supabase, Vercel, el costo de una Edge Function—. Hoy no está
-- medido y **no se estima**: un costo inventado convertiría este número en otra
-- cosa que hay que verificar. La vista dice que es *contribución antes de
-- infraestructura*, que es exactamente lo que es.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.platform_gross_profit_por_pago AS
SELECT
  t.id                       AS transaccion_id,
  t.org_id,
  (SELECT o.name FROM public.organizations o WHERE o.id = t.org_id) AS comercio,
  t.provider                 AS proveedor,
  t.method                   AS medio,
  t.installments             AS cuotas,
  t.created_at               AS fecha,
  t.currency                 AS moneda,
  t.gross_amount             AS bruto_procesado,

  -- Lo que cobra la plataforma.
  COALESCE(t.platform_fee, 0)                          AS comision_plataforma,

  -- El IVA de esa comisión, que no es ingreso: es del fisco. Sale de la regla
  -- vigente al momento del cobro, no de la de hoy — una regla nueva no puede
  -- reescribir lo que se ganó el mes pasado.
  public.redondear_moneda(
    COALESCE(t.platform_fee, 0)
    * COALESCE((SELECT r.tax_rate_pct FROM public.platform_commission_rules r
                 WHERE r.approval_status = 'approved'
                   AND (r.effective_from IS NULL OR r.effective_from <= t.created_at)
                   AND (r.effective_until IS NULL OR r.effective_until > t.created_at)
                 ORDER BY r.effective_from DESC NULLS LAST LIMIT 1), 0)
    / 100.0, 'ARS')                                    AS iva_de_la_comision,

  public.redondear_moneda(
    COALESCE(t.platform_fee, 0)
    - COALESCE(t.platform_fee, 0)
      * COALESCE((SELECT r.tax_rate_pct FROM public.platform_commission_rules r
                   WHERE r.approval_status = 'approved'
                     AND (r.effective_from IS NULL OR r.effective_from <= t.created_at)
                     AND (r.effective_until IS NULL OR r.effective_until > t.created_at)
                   ORDER BY r.effective_from DESC NULLS LAST LIMIT 1), 0)
      / 100.0, 'ARS')                                  AS gross_profit,

  -- El take rate real de ese pago: cuánto se queda la plataforma de lo que pasó
  -- por ella. Es el número que se compara contra el 0,7%–2% de Tiendanube.
  CASE WHEN COALESCE(t.gross_amount, 0) > 0
       THEN ROUND(COALESCE(t.platform_fee, 0) * 100 / t.gross_amount, 4)
  END                                                  AS take_rate_pct,

  -- Contexto para no confundir el margen de la plataforma con el del comercio.
  COALESCE(t.provider_fee, 0) + COALESCE(t.provider_fee_iva, 0) AS costo_del_comercio,
  t.status                   AS estado,

  -- ⚠️ Con importes chicos el redondeo a dos decimales domina el porcentaje.
  (COALESCE(t.gross_amount, 0) < 1000)                 AS monto_muy_chico_para_comparar
FROM public.payment_transactions t
WHERE public.is_platform_admin(auth.uid());

COMMENT ON VIEW public.platform_gross_profit_por_pago IS
  'Gross profit de la PLATAFORMA en cada pago: comision cobrada menos el IVA de esa comision. NO resta la comision del proveedor, que la paga el comercio. Es contribucion ANTES de infraestructura, que todavia no esta medida por transaccion.';

REVOKE ALL ON public.platform_gross_profit_por_pago FROM anon, authenticated;

-- ── Y el agregado, para no tener que sumarlo a mano ────────────────────────

CREATE OR REPLACE VIEW public.platform_gross_profit_resumen AS
SELECT
  date_trunc('month', p.fecha)::date       AS mes,
  p.moneda,
  count(*)::int                            AS pagos,
  count(DISTINCT p.org_id)::int            AS comercios,
  SUM(p.bruto_procesado)                   AS bruto_procesado,
  SUM(p.comision_plataforma)               AS comision_cobrada,
  SUM(p.iva_de_la_comision)                AS iva,
  SUM(p.gross_profit)                      AS gross_profit,
  CASE WHEN SUM(p.bruto_procesado) > 0
       THEN ROUND(SUM(p.comision_plataforma) * 100 / SUM(p.bruto_procesado), 4)
  END                                      AS take_rate_pct,
  -- Lo que se llevó el proveedor de los comercios en el mismo período. No es
  -- costo de la plataforma; está para dimensionar de qué tamaño es el flujo que
  -- la plataforma no ve pasar.
  SUM(p.costo_del_comercio)                AS costo_de_los_comercios,
  bool_and(p.monto_muy_chico_para_comparar) AS solo_montos_chicos
FROM public.platform_gross_profit_por_pago p
GROUP BY 1, 2;

COMMENT ON VIEW public.platform_gross_profit_resumen IS
  'Gross profit de la plataforma por mes. Si solo_montos_chicos es true, el take rate no significa nada: son pagos de prueba.';

REVOKE ALL ON public.platform_gross_profit_resumen FROM anon, authenticated;
