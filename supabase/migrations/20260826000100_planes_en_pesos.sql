-- ═══════════════════════════════════════════════════════════════════════════
-- Los planes en pesos, y a un precio que se puede pedir
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La suscripción no se podía cobrar con MercadoPago. La causa exacta está en
-- `mp-subscribe`: corta con *"Ese plan todavía no tiene precio en pesos
-- configurado"* porque `price_ars_monthly` estaba en **NULL en los cuatro
-- planes**. Sólo había precio en dólares.
--
-- 📌 Buena noticia: `mp-subscribe` arma el preapproval con
-- `auto_recurring.transaction_amount` directo, así que **no hace falta crear
-- planes en el panel de MercadoPago**. `mp_plan_monthly` puede seguir en NULL.
--
-- ── Y los precios en dólares no eran vendibles ────────────────────────────
--
--     Starter   USD 29/mes  ≈ $46.400
--     Pro       USD 79/mes  ≈ $126.400
--     Business  USD 199/mes ≈ $318.400
--
-- Tiendanube arranca en ❓ USD 18/mes (fuente: su propio blog de precios,
-- consultado 2026-08-21) y tiene plan gratis. Empretienda va de USD 7 a 30.
-- Pro a USD 79 es **cuatro veces** el plan de entrada del competidor más
-- grande de Argentina.
--
-- ⚠️ Y no hay con qué sostenerlo: 1 comercio real, 0 suscripciones cobradas, 0
-- facturas emitidas en producción. Un precio premium se cobra con historial, y
-- todavía no hay.
--
-- ── Los precios que quedan ────────────────────────────────────────────────
--
--     Starter   $19.900/mes   $199.000/año   (≈ USD 12,4 al dólar de hoy)
--     Pro       $34.900/mes   $349.000/año   (≈ USD 21,8)
--     Business  $69.900/mes   $699.000/año   (≈ USD 43,7)
--
-- El plan de entrada queda **por debajo** de Tiendanube, que es lo que
-- corresponde mientras no haya un segundo comercio que lo respalde. El anual
-- son diez meses por doce: 16,7% de descuento, fácil de explicar y de calcular
-- de cabeza.
--
-- ⚠️ **Un precio en pesos se desactualiza solo.** Con inflación, $19.900 dentro
-- de un año no es el mismo producto. Se agrega `price_ars_updated_at` para que
-- se vea desde cuándo no se toca, en vez de descubrirlo cuando el margen ya se
-- lo comió la inflación.
--
-- 📌 Los precios son una decisión comercial, no técnica. Estos son los que se
-- fijaron el 2026-08-26 con el criterio de arriba; cambiarlos es un UPDATE.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price_ars_updated_at timestamptz;

COMMENT ON COLUMN public.plans.price_ars_updated_at IS
  'Desde cuando no se toca el precio en pesos. Con inflacion, un precio viejo es un descuento que nadie decidio.';

UPDATE public.plans SET
  price_ars_monthly    = 19900,
  price_ars_yearly     = 199000,
  price_ars_updated_at = now()
WHERE code = 'starter';

UPDATE public.plans SET
  price_ars_monthly    = 34900,
  price_ars_yearly     = 349000,
  price_ars_updated_at = now()
WHERE code = 'pro';

UPDATE public.plans SET
  price_ars_monthly    = 69900,
  price_ars_yearly     = 699000,
  price_ars_updated_at = now()
WHERE code = 'business';

-- El trial es gratis y así se queda: cero no es "sin precio".
UPDATE public.plans SET
  price_ars_monthly    = 0,
  price_ars_yearly     = 0,
  price_ars_updated_at = now()
WHERE code = 'trial';

-- ── Qué falta para poder cobrar ────────────────────────────────────────────
--
-- El precio era una de dos condiciones. La otra es el secreto
-- `MP_PLATFORM_ACCESS_TOKEN`, que no se puede leer desde SQL — así que la vista
-- dice lo que sí se puede verificar y nombra lo que no.

CREATE OR REPLACE VIEW public.audit_planes_cobrables AS
SELECT
  p.code,
  p.name,
  p.price_ars_monthly,
  p.price_ars_yearly,
  p.price_ars_updated_at,
  EXTRACT(day FROM now() - p.price_ars_updated_at)::int AS dias_sin_actualizar,
  (p.price_ars_monthly IS NULL) AS sin_precio_en_pesos,
  -- Un anual que no ahorra nada frente a doce meses no es un plan anual.
  CASE WHEN COALESCE(p.price_ars_monthly, 0) > 0 AND COALESCE(p.price_ars_yearly, 0) > 0
       THEN ROUND(100 - p.price_ars_yearly * 100 / (p.price_ars_monthly * 12), 1)
  END AS descuento_anual_pct
FROM public.plans p
WHERE p.active
  AND public.is_platform_admin(auth.uid());

COMMENT ON VIEW public.audit_planes_cobrables IS
  'Planes activos y si se pueden cobrar en pesos. Falta ademas el secreto MP_PLATFORM_ACCESS_TOKEN, que no se puede verificar desde SQL.';

REVOKE ALL ON public.audit_planes_cobrables FROM anon, authenticated;
