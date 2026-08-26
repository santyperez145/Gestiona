-- ═══════════════════════════════════════════════════════════════════════════
-- Las tarifas de MercadoPago: lo que se pudo averiguar y lo que no
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Intento de verificación del 2026-08-26 contra la tarifa oficial.
--
-- ⚠️ **No se pudo verificar.** `mercadopago.com.ar/costs-section` devuelve
-- **HTTP 403** a cualquier lectura automática. La tarifa real de un comercio
-- además depende de su cuenta —volumen, plan, promociones vigentes— así que la
-- única fuente confiable es el propio panel de MercadoPago del comercio.
--
-- ── Lo que sí apareció, y por qué importa ─────────────────────────────────
--
-- Varias fuentes secundarias coinciden en una distinción que nuestra carga no
-- hace: **6,29% es la tarifa de Point (terminal presencial)**, no la de
-- Checkout Pro online, que estaría cerca de **3,99% + IVA** con acreditación
-- inmediata; débito rondaría 3,29%.
--
-- Nuestra fila dice "Checkout Pro, acreditación inmediata" con 6,29%. Si la
-- distinción es correcta, el panel del comercio le está mostrando un costo
-- **más alto del real** para las ventas online — y eso lleva a poner precios
-- más caros de lo necesario, que cuesta ventas.
--
-- 📌 **No se cambian los números.** Reemplazar un valor sin verificar por otro
-- sin verificar no es una mejora: sería cambiar el error por otro y perder el
-- rastro de que nadie lo comprobó. Lo que se hace es dejar escrito qué
-- verificar y contra qué.
--
-- ── Cómo se resuelve de verdad ────────────────────────────────────────────
--
-- Dos caminos, y el segundo no depende de nadie:
--
-- 1. El dueño entra a su cuenta de MercadoPago → Costos, y carga la tarifa que
--    le corresponde con `verificada_el`.
--
-- 2. **El sistema la aprende sola.** MercadoPago informa la comisión real en
--    cada pago y ya la guardamos en `payment_transactions.provider_fee`.
--    `desvio_de_comisiones` compara lo estimado contra lo cobrado; con unos
--    pocos cobros de tamaño normal, el número real aparece solo. Los dos cobros
--    que hay son de ARS 1 y el redondeo los hace inservibles para eso.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.payment_provider_fees
   SET fuente =
     'Carga inicial 2026-07-30, SIN verificar. Intento de verificacion 2026-08-26: '
     || 'mercadopago.com.ar/costs-section responde 403 a lectura automatica. '
     || 'Fuentes secundarias sugieren que 6,29% es la tarifa de POINT (terminal presencial) '
     || 'y que Checkout Pro online estaria cerca de 3,99% + IVA (debito ~3,29%). '
     || 'VERIFICAR en el panel de MercadoPago del comercio: la tarifa depende de la cuenta.'
 WHERE provider = 'mercadopago'
   AND method IN ('credit', 'default')
   AND installments = 0;

UPDATE public.payment_provider_fees
   SET fuente =
     'Carga inicial 2026-07-30, SIN verificar. Fuentes secundarias 2026-08-26 sugieren '
     || '~3,29% + IVA para debito. VERIFICAR en el panel de MercadoPago del comercio.'
 WHERE provider = 'mercadopago' AND method = 'debit';

-- ── El aviso que el comercio necesita ver ──────────────────────────────────
--
-- Una tarifa cargada de más no falla: hace poner precios más caros de lo
-- necesario, y eso cuesta ventas sin que aparezca ningún error.

CREATE OR REPLACE VIEW public.tarifas_a_verificar AS
SELECT
  f.provider,
  f.method,
  f.installments,
  f.percent_fee,
  f.fuente,
  f.verificada_el,
  EXTRACT(day FROM now() - f.created_at)::int AS dias_sin_verificar,
  -- Cuántos cobros de tamaño usable hay para contrastarla. Con importes chicos
  -- el redondeo domina y la comparación no sirve.
  (SELECT count(*) FROM public.payment_transactions t
    WHERE t.provider = f.provider AND t.method = f.method
      AND COALESCE(t.gross_amount, 0) >= 1000)::int AS cobros_comparables
FROM public.payment_provider_fees f
WHERE f.verificada_el IS NULL
  AND f.percent_fee > 0;

COMMENT ON VIEW public.tarifas_a_verificar IS
  'Tarifas que nadie comparo contra la del proveedor, con cuantos cobros de tamano usable hay para contrastarlas. Una tarifa cargada de mas no falla: hace poner precios mas caros de lo necesario.';

REVOKE ALL ON public.tarifas_a_verificar FROM anon;
GRANT SELECT ON public.tarifas_a_verificar TO authenticated;
