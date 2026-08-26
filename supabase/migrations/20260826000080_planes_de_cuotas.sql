-- ═══════════════════════════════════════════════════════════════════════════
-- El comercio decide en cuántas cuotas vende
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido el 2026-08-26: **no hay ninguna configuración de cuotas**. Ni en
-- `settings`, ni en `ecommerce_stores`, ni por proveedor. El sistema conoce las
-- tarifas por cantidad de cuotas —3, 6 y 12— y `payment_intents.cuotas` existe,
-- pero el comercio no puede decir cuáles ofrece ni en qué condiciones.
--
-- ── Cómo lo hace Tiendanube (verificado 2026-08-26) ───────────────────────
--
-- Tres piezas, y las tres importan
-- (ayuda.tiendanube.com/es_AR/122919-informacion/como-configurar-las-cuotas-en-mi-tienda):
--
--   1. **Qué planes ofrecer**, hasta 12.
--   2. **Con o sin interés.** Con interés, el costo de financiación lo paga el
--      comprador. Sin interés, *"vos absorbés este costo, normalmente por medio
--      de la tarifa que cobra la pasarela"*.
--   3. **Monto mínimo por plan.** Textual: *"podés configurar un monto diferente
--      para ofrecer 3 cuotas sin interés y otro para ofrecer 6"*.
--
-- ⚠️ **La tercera no es un detalle de conveniencia: es la que salva el margen.**
--
-- Doce cuotas sin interés cuestan 18,60% + IVA = **22,51%**. En una venta de
-- $10.000 el comercio se queda con $7.749. Si su margen era del 30%, acaba de
-- regalar tres cuartas partes. El monto mínimo existe para que ese plan sólo
-- aparezca cuando la venta lo aguanta.
--
-- 📌 Con MercadoPago hay una capa más: las cuotas sin interés se habilitan en
-- el panel del propio MercadoPago (Tu negocio → Costos) y la tienda las
-- refleja. Esta tabla es lo que **el comercio decide ofrecer**; que MercadoPago
-- las tenga habilitadas es condición aparte y no la podemos verificar desde
-- acá.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.org_installment_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider      text NOT NULL REFERENCES public.payment_providers(codigo),
  installments  int  NOT NULL CHECK (installments BETWEEN 2 AND 24),
  -- true  = lo absorbe el comercio (le cuesta la tarifa de esa cantidad de cuotas)
  -- false = lo paga el comprador (al comercio le cuesta como 1 pago)
  sin_interes   boolean NOT NULL DEFAULT false,
  -- ⚠️ Debajo de este monto el plan NO se ofrece. Es lo que evita regalar el
  -- margen en una venta chica.
  monto_minimo  numeric NOT NULL DEFAULT 0 CHECK (monto_minimo >= 0),
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider, installments)
);

CREATE INDEX IF NOT EXISTS org_installment_plans_org_idx
  ON public.org_installment_plans (org_id, provider);

COMMENT ON TABLE public.org_installment_plans IS
  'Planes de cuotas que el comercio decide ofrecer. sin_interes=true significa que el costo de financiacion lo absorbe el comercio.';
COMMENT ON COLUMN public.org_installment_plans.monto_minimo IS
  'Monto minimo de la venta para ofrecer este plan. 12 cuotas sin interes cuestan 22,51%: sin este piso, una venta chica regala el margen entero.';

ALTER TABLE public.org_installment_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Miembros leen los planes de cuotas" ON public.org_installment_plans;
CREATE POLICY "Miembros leen los planes de cuotas"
  ON public.org_installment_plans FOR SELECT
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "Dueno y admin gestionan los planes de cuotas" ON public.org_installment_plans;
CREATE POLICY "Dueno y admin gestionan los planes de cuotas"
  ON public.org_installment_plans FOR ALL
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

DROP TRIGGER IF EXISTS trg_org_installment_plans_updated ON public.org_installment_plans;
CREATE TRIGGER trg_org_installment_plans_updated
BEFORE UPDATE ON public.org_installment_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Qué cuotas se pueden ofrecer para un monto ─────────────────────────────

CREATE OR REPLACE FUNCTION public.cuotas_disponibles(
  p_org uuid,
  p_monto numeric,
  p_provider text DEFAULT NULL)
RETURNS TABLE (
  provider          text,
  installments      int,
  sin_interes       boolean,
  monto_minimo      numeric,
  costo_pct         numeric,
  costo_ars         numeric,
  neto_ars          numeric,
  cuota_ars         numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT
    pl.provider,
    pl.installments,
    pl.sin_interes,
    pl.monto_minimo,
    -- ⚠️ Sin interés cuesta la tarifa de ESA cantidad de cuotas; con interés,
    -- el comercio cobra como un pago y la financiación la paga el comprador.
    ROUND(f.percent_fee * (1 + f.iva_on_fee_pct / 100.0), 4) AS costo_pct,
    public.redondear_moneda(
      p_monto * f.percent_fee * (1 + f.iva_on_fee_pct / 100.0) / 100.0, 'ARS') AS costo_ars,
    public.redondear_moneda(
      p_monto - p_monto * f.percent_fee * (1 + f.iva_on_fee_pct / 100.0) / 100.0, 'ARS') AS neto_ars,
    public.redondear_moneda(p_monto / pl.installments, 'ARS') AS cuota_ars
  FROM public.org_installment_plans pl
  -- La tarifa que aplica: la de esa cantidad de cuotas si es sin interés, la de
  -- un pago si la financia el comprador.
  LEFT JOIN LATERAL (
    SELECT x.percent_fee, x.iva_on_fee_pct
      FROM public.payment_provider_fees x
     WHERE x.provider = pl.provider
       AND x.method = 'credit'
       AND x.installments = CASE WHEN pl.sin_interes THEN pl.installments ELSE 0 END
       AND (x.effective_from IS NULL OR x.effective_from <= CURRENT_DATE)
     ORDER BY x.effective_from DESC NULLS LAST
     LIMIT 1
  ) f ON true
  WHERE pl.org_id = p_org
    AND pl.activo
    AND (p_provider IS NULL OR pl.provider = p_provider)
    AND COALESCE(p_monto, 0) >= pl.monto_minimo
    AND public.is_org_member(p_org, auth.uid())
  ORDER BY pl.provider, pl.installments;
$fn$;

REVOKE ALL ON FUNCTION public.cuotas_disponibles(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cuotas_disponibles(uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.cuotas_disponibles(uuid, numeric, text) IS
  'Planes de cuotas ofrecibles para un monto, con lo que le cuesta cada uno al comercio. Filtra por monto_minimo: un plan que no se banca esa venta no aparece.';

-- ── Los planes que hay tarifa para ofrecer ─────────────────────────────────
--
-- Para que la pantalla no ofrezca configurar 9 cuotas si no hay tarifa cargada
-- para 9: sin tarifa el costo sería desconocido y el comercio estaría eligiendo
-- a ciegas.

CREATE OR REPLACE VIEW public.planes_de_cuotas_posibles AS
SELECT DISTINCT
  f.provider,
  f.installments,
  ROUND(f.percent_fee * (1 + f.iva_on_fee_pct / 100.0), 4) AS costo_sin_interes_pct,
  (SELECT ROUND(b.percent_fee * (1 + b.iva_on_fee_pct / 100.0), 4)
     FROM public.payment_provider_fees b
    WHERE b.provider = f.provider AND b.method = 'credit' AND b.installments = 0
    LIMIT 1)                                              AS costo_con_interes_pct,
  f.verificada_el IS NULL                                 AS tarifa_sin_verificar
FROM public.payment_provider_fees f
WHERE f.method = 'credit'
  AND f.installments > 0
  AND (f.effective_from IS NULL OR f.effective_from <= CURRENT_DATE);

COMMENT ON VIEW public.planes_de_cuotas_posibles IS
  'Cantidades de cuotas para las que hay tarifa cargada, con lo que cuestan absorbiendolas o cobrandolas al comprador. Sin tarifa el comercio elegiria a ciegas.';

REVOKE ALL ON public.planes_de_cuotas_posibles FROM anon;
GRANT SELECT ON public.planes_de_cuotas_posibles TO authenticated;
