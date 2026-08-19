-- ═══════════════════════════════════════════════════════════════════════════
-- Las suscripciones se cobran con MercadoPago
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hasta acá el SaaS se cobraba con Stripe: `plans` tiene `stripe_price_id_*` y
-- `subscriptions` guarda `stripe_customer_id`. Hay **3 suscripciones vivas**
-- con esa forma, así que nada de esto se dropea — se agrega el camino nuevo al
-- lado y cada suscripción dice por dónde cobra.
--
-- ── El problema que hay que resolver antes que el código ──────────────────
--
-- ⚠️ **Los planes están en dólares y MercadoPago Argentina cobra en pesos.**
-- Medido: trial 0, starter 29, pro 79, business 199 USD. No hay precio en ARS
-- en ninguna parte.
--
-- Convertirlos con una cotización sería inventar: el precio en pesos de una
-- suscripción es una decisión comercial —cuánto absorber de la brecha, cada
-- cuánto reajustar— y no una multiplicación. Por eso se agregan las columnas
-- **vacías** y el panel de plataforma las pide. Un plan sin precio en pesos no
-- se puede contratar por MercadoPago, y eso se dice en la pantalla en vez de
-- cobrar un número inventado.
--
-- ── Cómo cobra MercadoPago una suscripción ────────────────────────────────
--
-- Con la API de **preapproval**: el comercio autoriza un débito recurrente y MP
-- cobra solo cada período. Nosotros no guardamos la tarjeta ni la vemos — es la
-- misma razón por la que el checkout de la tienda usa el Brick.
--
-- MP avisa por webhook con dos temas distintos, y confundirlos es el error:
--
--   subscription_preapproval          cambió el ESTADO de la suscripción
--                                     (autorizada, pausada, cancelada)
--   subscription_authorized_payment   se COBRÓ un período
--
-- El primero no es plata; el segundo sí. Extender el período con el primero
-- daría acceso gratis.
--
-- ── Quién cobra ───────────────────────────────────────────────────────────
--
-- ⚠️ La suscripción la cobra **la plataforma con su propia cuenta**, no el
-- comercio con la suya. Son dos relaciones distintas: el comprador le paga al
-- comercio (ahí va `marketplace_fee`), y el comercio le paga a Gestiona. Usar
-- el token del comercio para cobrarle al comercio no tiene sentido y además no
-- funcionaría.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Precio en pesos y plan de MercadoPago ───────────────────────────────

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price_ars_monthly numeric,
  ADD COLUMN IF NOT EXISTS price_ars_yearly  numeric,
  -- El id del `preapproval_plan` que se creó en MercadoPago. Se guarda para no
  -- crear uno nuevo en cada alta.
  ADD COLUMN IF NOT EXISTS mp_plan_monthly   text,
  ADD COLUMN IF NOT EXISTS mp_plan_yearly    text;

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_precio_ars_positivo;
ALTER TABLE public.plans ADD CONSTRAINT plans_precio_ars_positivo
  CHECK ((price_ars_monthly IS NULL OR price_ars_monthly >= 0)
     AND (price_ars_yearly  IS NULL OR price_ars_yearly  >= 0));

COMMENT ON COLUMN public.plans.price_ars_monthly IS
  'Precio mensual en pesos. NULL = el plan todavia no se puede contratar por MercadoPago.';

-- ── 2. Por dónde cobra cada suscripción ────────────────────────────────────

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider          text NOT NULL DEFAULT 'mercadopago',
  ADD COLUMN IF NOT EXISTS mp_preapproval_id text,
  ADD COLUMN IF NOT EXISTS mp_payer_email    text,
  ADD COLUMN IF NOT EXISTS ciclo             text NOT NULL DEFAULT 'mensual';

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_provider_valido;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_provider_valido
  CHECK (provider IN ('mercadopago', 'stripe', 'manual'));

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_ciclo_valido;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_ciclo_valido
  CHECK (ciclo IN ('mensual', 'anual'));

-- ⚠️ Las 3 suscripciones que ya existen siguen en Stripe. El default nuevo es
-- MercadoPago, pero lo viejo no se migra solo: cambiar el cobrador de una
-- suscripción viva es una decisión del dueño, no de una migración.
UPDATE public.subscriptions
   SET provider = 'stripe'
 WHERE stripe_subscription_id IS NOT NULL AND provider = 'mercadopago';

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_mp_preapproval_unico
  ON public.subscriptions (mp_preapproval_id) WHERE mp_preapproval_id IS NOT NULL;

-- ── 3. Cada cobro, una fila ────────────────────────────────────────────────
--
-- ⚠️ **`subscription_invoices` NO sirve para esto, y descubrirlo costó una
-- corrida.** Su FK apunta a `customer_subscriptions` —las suscripciones que el
-- comercio le cobra a *sus* clientes, que tiene `customer_id`, `customer_name`
-- y `customer_email`—. Es otra cosa con un nombre parecido.
--
-- Meter ahí las facturas del SaaS habría creado filas cuyo `subscription_id` no
-- joinea con nada. Las dos tablas están vacías, así que la salida limpia es que
-- el SaaS tenga su propio facturero.

CREATE TABLE IF NOT EXISTS public.saas_invoices (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid          NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  org_id          uuid          NOT NULL,
  numero          text          NOT NULL,
  monto           numeric(18,2) NOT NULL CHECK (monto >= 0),
  moneda          text          NOT NULL DEFAULT 'ARS',
  estado          text          NOT NULL
                    CHECK (estado IN ('paid', 'pending', 'rejected', 'refunded', 'cancelled')),
  periodo_desde   timestamptz   NOT NULL,
  periodo_hasta   timestamptz   NOT NULL,
  vence_el        date,
  pagado_at       timestamptz,
  provider        text          NOT NULL DEFAULT 'mercadopago',
  mp_payment_id   text,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saas_invoices_org_idx
  ON public.saas_invoices (org_id, created_at DESC);

-- ⚠️ Esto es lo que hace que un webhook repetido no cobre dos veces. MercadoPago
-- reintenta las notificaciones —es su comportamiento normal, no un error— y sin
-- este índice el mismo pago crearía dos facturas y extendería el período dos
-- veces. Es la misma clase de bug que el descuento de stock duplicado.
CREATE UNIQUE INDEX IF NOT EXISTS saas_invoices_mp_pago_unico
  ON public.saas_invoices (mp_payment_id) WHERE mp_payment_id IS NOT NULL;

COMMENT ON TABLE public.saas_invoices IS
  'Facturas de la suscripcion al SaaS. Distinta de subscription_invoices, que es de las suscripciones que el comercio le cobra a sus clientes.';

ALTER TABLE public.saas_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saas_invoices_org ON public.saas_invoices;
CREATE POLICY saas_invoices_org ON public.saas_invoices
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── 4. Registrar un cobro ──────────────────────────────────────────────────
--
-- La llama el webhook cuando MercadoPago informa que cobró un período.

CREATE OR REPLACE FUNCTION public.suscripcion_registrar_pago(
  p_preapproval text,
  p_payment_id  text,
  p_monto       numeric,
  p_estado      text DEFAULT 'approved',
  p_moneda      text DEFAULT 'ARS'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_sub    public.subscriptions;
  v_ya     uuid;
  v_desde  timestamptz;
  v_hasta  timestamptz;
  v_id     uuid;
  v_numero text;
BEGIN
  IF btrim(COALESCE(p_payment_id, '')) = '' THEN
    RAISE EXCEPTION 'suscripcion_registrar_pago: falta el id del pago';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions
   WHERE mp_preapproval_id = p_preapproval LIMIT 1;

  IF v_sub.id IS NULL THEN
    -- No es un error del sistema: puede ser una notificación de una suscripción
    -- que no es nuestra, o que llegó antes de que terminemos de darla de alta.
    RETURN jsonb_build_object('ok', false, 'motivo', 'preapproval desconocido');
  END IF;

  -- Idempotencia: el mismo pago no se registra dos veces.
  SELECT id INTO v_ya FROM public.saas_invoices
   WHERE mp_payment_id = p_payment_id LIMIT 1;
  IF v_ya IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'invoice_id', v_ya, 'repetido', true);
  END IF;

  -- ⚠️ Un pago que no está aprobado NO extiende el período. Registrarlo igual
  -- daría acceso gratis a una tarjeta rechazada.
  IF p_estado <> 'approved' THEN
    INSERT INTO public.saas_invoices (
      subscription_id, org_id, numero, monto, moneda, estado,
      periodo_desde, periodo_hasta, vence_el, provider, mp_payment_id)
    VALUES (
      v_sub.id, v_sub.org_id,
      'MP-' || p_payment_id, ROUND(COALESCE(p_monto, 0), 2), p_moneda,
      -- Cualquier cosa que no sea aprobada se guarda como rechazada: el detalle
      -- del motivo lo tiene MercadoPago, y acá lo que importa es que no pagó.
      'rejected',
      v_sub.current_period_start, v_sub.current_period_end,
      -- Un cobro que falló vence hoy: es lo que hay que pagar para no perder el
      -- servicio.
      CURRENT_DATE, 'mercadopago', p_payment_id)
    RETURNING id INTO v_id;

    UPDATE public.subscriptions
       SET status = 'past_due'::public.subscription_status, updated_at = now()
     WHERE id = v_sub.id;

    PERFORM public.emitir_evento(v_sub.org_id, 'suscripcion', v_sub.id, 'suscripcion.pago_fallido',
      jsonb_build_object('subscription_id', v_sub.id, 'monto', p_monto, 'estado', p_estado));

    RETURN jsonb_build_object('ok', true, 'invoice_id', v_id, 'extendio', false);
  END IF;

  -- El período nuevo arranca cuando termina el vigente, no hoy: si el cobro
  -- llega dos días tarde, esos dos días ya estaban pagos y regalarlos correría
  -- la fecha de cobro para siempre.
  v_desde := GREATEST(COALESCE(v_sub.current_period_end, now()), now() - interval '1 day');
  v_hasta := v_desde + CASE v_sub.ciclo WHEN 'anual' THEN interval '1 year' ELSE interval '1 month' END;

  v_numero := 'MP-' || to_char(now(), 'YYYYMM') || '-' || right(p_payment_id, 6);

  INSERT INTO public.saas_invoices (
    subscription_id, org_id, numero, monto, moneda, estado,
    periodo_desde, periodo_hasta, vence_el, pagado_at, provider, mp_payment_id)
  VALUES (
    v_sub.id, v_sub.org_id, v_numero, ROUND(COALESCE(p_monto, 0), 2), p_moneda, 'paid',
    v_desde, v_hasta, v_desde::date, now(), 'mercadopago', p_payment_id)
  RETURNING id INTO v_id;

  UPDATE public.subscriptions
     SET status = 'active'::public.subscription_status,
         current_period_start = v_desde,
         current_period_end   = v_hasta,
         updated_at = now()
   WHERE id = v_sub.id;

  PERFORM public.emitir_evento(v_sub.org_id, 'suscripcion', v_sub.id, 'suscripcion.cobrada',
    jsonb_build_object(
      'subscription_id', v_sub.id, 'invoice_id', v_id,
      'monto', p_monto, 'hasta', v_hasta));

  RETURN jsonb_build_object(
    'ok', true, 'invoice_id', v_id, 'extendio', true, 'hasta', v_hasta);
END;
$fn$;

-- ── 5. Cambios de estado de la suscripción ─────────────────────────────────
--
-- El otro tema del webhook. Acá NO se toca el período: esto no es plata.

CREATE OR REPLACE FUNCTION public.suscripcion_actualizar_estado(
  p_preapproval text,
  p_estado_mp   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_sub    public.subscriptions;
  v_nuevo  text;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions
   WHERE mp_preapproval_id = p_preapproval LIMIT 1;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'preapproval desconocido');
  END IF;

  -- El vocabulario de MercadoPago traducido al nuestro. Lo que no se reconoce
  -- se deja como está: inventar un estado sería peor que no saberlo.
  -- El vocabulario de MercadoPago traducido al nuestro. ⚠️ `status` es un enum
  -- (`trialing, active, past_due, canceled, paused`), así que sólo se puede
  -- mapear a uno de esos: un `pending` de MP no tiene equivalente y se deja
  -- como está en vez de inventar un valor que el enum rechazaría.
  v_nuevo := CASE lower(COALESCE(p_estado_mp, ''))
    WHEN 'authorized' THEN 'active'
    WHEN 'paused'     THEN 'paused'
    WHEN 'cancelled'  THEN 'canceled'
    ELSE NULL
  END;

  IF v_nuevo IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'motivo', 'estado no reconocido: ' || COALESCE(p_estado_mp, '?'));
  END IF;

  -- ⚠️ Cancelar NO corta el acceso en el acto: el período ya está pago y
  -- cortarlo sería quedarse con plata cobrada. Se marca para que no renueve.
  IF v_nuevo = 'canceled' THEN
    UPDATE public.subscriptions
       SET cancel_at_period_end = true, updated_at = now()
     WHERE id = v_sub.id;
  ELSE
    UPDATE public.subscriptions
       SET status = v_nuevo::public.subscription_status, updated_at = now()
     WHERE id = v_sub.id;
  END IF;

  PERFORM public.emitir_evento(v_sub.org_id, 'suscripcion', v_sub.id, 'suscripcion.estado_cambiado',
    jsonb_build_object('subscription_id', v_sub.id, 'estado', v_nuevo, 'estado_mp', p_estado_mp));

  RETURN jsonb_build_object('ok', true, 'estado', v_nuevo);
END;
$fn$;

-- ── 6. Qué ve el comercio ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.suscripcion_de_organizacion(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_r jsonb;
BEGIN
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización';
  END IF;

  SELECT jsonb_build_object(
    'subscription_id', s.id,
    'estado', s.status,
    'provider', s.provider,
    'ciclo', s.ciclo,
    'renueva_el', s.current_period_end,
    'cancela_al_final', s.cancel_at_period_end,
    'trial_hasta', s.trial_end,
    'plan', jsonb_build_object(
      'code', p.code, 'name', p.name,
      'price_ars_monthly', p.price_ars_monthly,
      'price_ars_yearly', p.price_ars_yearly,
      'max_products', p.max_products, 'max_users', p.max_users,
      'ai_enabled', p.ai_enabled),
    -- Cuánto falta para que venza. Negativo = ya venció.
    'dias_restantes', CASE WHEN s.current_period_end IS NULL THEN NULL
      ELSE EXTRACT(day FROM s.current_period_end - now())::int END)
  INTO v_r
  FROM public.subscriptions s
  LEFT JOIN public.plans p ON p.id = s.plan_id
  WHERE s.org_id = p_org
  ORDER BY s.created_at DESC LIMIT 1;

  RETURN COALESCE(v_r, jsonb_build_object('estado', 'sin_suscripcion'));
END;
$fn$;

-- Los planes que se pueden contratar por MercadoPago: los que tienen precio en
-- pesos. Un plan sin precio no se ofrece — no se cobra un número inventado.
CREATE OR REPLACE VIEW public.planes_contratables AS
SELECT
  p.id, p.code, p.name, p.description, p.features,
  p.price_ars_monthly, p.price_ars_yearly,
  p.max_products, p.max_sales_per_month, p.max_users,
  p.ai_enabled, p.backups_enabled, p.custom_branding, p.sort_order,
  -- Cuánto se ahorra pagando por año, para poder mostrarlo sin recalcularlo en
  -- cada pantalla.
  CASE WHEN COALESCE(p.price_ars_monthly, 0) > 0 AND COALESCE(p.price_ars_yearly, 0) > 0
       THEN ROUND(100 - (p.price_ars_yearly / (p.price_ars_monthly * 12) * 100))
       ELSE NULL END AS ahorro_anual_pct
FROM public.plans p
WHERE p.active AND COALESCE(p.price_ars_monthly, 0) > 0;

COMMENT ON VIEW public.planes_contratables IS
  'Planes con precio en pesos. Un plan sin precio ARS no se puede cobrar por MercadoPago y no se ofrece.';

GRANT SELECT ON public.planes_contratables TO anon, authenticated;
