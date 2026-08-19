-- ═══════════════════════════════════════════════════════════════════════════
-- El orquestador de pagos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `docs/ARQUITECTURA.md` lo tiene en la tabla de "se adopta ya": *hay dos
-- proveedores, un tercero sin abstracción duele*. Medido hoy: hay **uno**
-- conectado (MercadoPago), cero tablas de orquestación, y `store-pay` habla
-- directo con la API de MercadoPago. Agregar Stripe o dLocal significaría hoy
-- copiar esa función y bifurcar el checkout.
--
-- ── Qué es un orquestador y qué no ────────────────────────────────────────
--
-- No es un procesador: la plata la siguen moviendo MercadoPago y compañía.
-- Es la capa que decide **por dónde** cobrar, guarda **qué pasó** en cada
-- intento, y deja el resultado en un solo formato para que el resto del sistema
-- no sepa quién cobró.
--
-- Es el peldaño 1 y medio de la escalera de `ARQUITECTURA.md` §6, hecho en
-- serio. No es custodia de fondos ni PSP regulado — eso es otra empresa.
--
-- ── Las tres piezas ───────────────────────────────────────────────────────
--
--   payment_intents    la intención de cobrar una orden. UNA por orden.
--   payment_attempts   cada intento con un proveedor concreto. VARIOS.
--   payment_routing    qué proveedor atiende qué, y en qué orden.
--
-- La separación entre intent y attempt es lo que habilita lo que ninguno de los
-- competidores hace: **si un proveedor falla o está caído, se reintenta con
-- otro sin perder la venta**. En Tiendanube o Empretienda, si MercadoPago
-- rechaza, el comprador se va.
--
-- ── Lo innovador, y sale de datos que ya están ────────────────────────────
--
-- `payment_provider_fees` ya guarda comisión, IVA de la comisión y días de
-- acreditación **por proveedor, método y cuotas** — 10 filas cargadas. Con eso
-- el ruteo puede elegir por **costo real**, no por preferencia:
--
--     3 cuotas por MercadoPago    6,29% + IVA, acredita en 14 días
--     3 cuotas por otro           5,10% + IVA, acredita en 18 días
--
-- El comercio decide si prioriza costo o velocidad de acreditación, y el
-- sistema rutea solo. Es exactamente la tesis del producto —el margen real por
-- canal necesita cuatro datos a la vez— aplicada al cobro.
--
-- ⚠️ **Lo que NO hace este orquestador**, y conviene decirlo: no reintenta solo
-- contra otro proveedor sin que alguien lo pida. Un reintento automático puede
-- terminar en doble cobro si el primero en realidad salió y el aviso se perdió.
-- El failover deja el intent listo para el siguiente intento; dispararlo es una
-- decisión explícita del checkout.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Qué proveedores existen y qué saben hacer ───────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_providers (
  codigo       text PRIMARY KEY,
  nombre       text NOT NULL,
  -- Qué métodos sabe cobrar. Un proveedor que no hace efectivo no puede ser
  -- elegido para efectivo, por barato que sea.
  metodos      text[] NOT NULL DEFAULT '{}',
  monedas      text[] NOT NULL DEFAULT '{ARS}',
  -- ¿Sabe partir el cobro entre el comercio y la plataforma? Sin esto no se
  -- puede cobrar comisión en el mismo pago y hay que facturarla aparte.
  soporta_split boolean NOT NULL DEFAULT false,
  soporta_cuotas boolean NOT NULL DEFAULT false,
  -- Se apaga sin borrar nada: un proveedor caído se desactiva y el ruteo lo
  -- saltea, sin perder el histórico de lo que cobró.
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;

-- El catálogo es público: la tienda necesita saber qué medios ofrecer antes de
-- que el comprador tenga sesión. No hay nada sensible acá.
DROP POLICY IF EXISTS payment_providers_lectura ON public.payment_providers;
CREATE POLICY payment_providers_lectura ON public.payment_providers
  FOR SELECT USING (true);

INSERT INTO public.payment_providers (codigo, nombre, metodos, soporta_split, soporta_cuotas)
VALUES
  ('mercadopago',   'MercadoPago',            ARRAY['tarjeta','mercadopago','qr'], true,  true),
  ('transferencia', 'Transferencia bancaria', ARRAY['transferencia'],              false, false),
  ('efectivo',      'Efectivo',               ARRAY['efectivo'],                   false, false)
ON CONFLICT (codigo) DO UPDATE
  SET metodos = EXCLUDED.metodos,
      soporta_split = EXCLUDED.soporta_split,
      soporta_cuotas = EXCLUDED.soporta_cuotas;

-- ── 2. Las reglas de ruteo ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_routing (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = regla de plataforma, vale para toda organización que no tenga la suya.
  org_id     uuid,
  metodo     text NOT NULL,
  provider   text NOT NULL REFERENCES public.payment_providers(codigo),
  -- Menor gana. Empate se rompe por costo.
  prioridad  int  NOT NULL DEFAULT 100,
  -- Rango de monto en el que aplica. Sirve para mandar los tickets grandes por
  -- el proveedor más barato aunque acredite más lento.
  monto_min  numeric,
  monto_max  numeric,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_routing_unica
  ON public.payment_routing
     (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), metodo, provider);

ALTER TABLE public.payment_routing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_routing_org ON public.payment_routing;
CREATE POLICY payment_routing_org ON public.payment_routing
  FOR ALL USING (org_id IS NOT NULL AND public.is_org_member(org_id, auth.uid()))
  WITH CHECK (org_id IS NOT NULL AND public.is_org_member(org_id, auth.uid()));

-- Reglas base de plataforma: cada método a su proveedor obvio. Un comercio
-- puede agregar las suyas y las de él ganan.
INSERT INTO public.payment_routing (org_id, metodo, provider, prioridad)
VALUES
  (NULL, 'mercadopago',   'mercadopago',   10),
  (NULL, 'tarjeta',       'mercadopago',   10),
  (NULL, 'transferencia', 'transferencia', 10),
  (NULL, 'efectivo',      'efectivo',      10)
ON CONFLICT (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), metodo, provider)
DO NOTHING;

-- ── 3. La intención de cobro ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  order_id    uuid REFERENCES public.ecommerce_orders(id) ON DELETE CASCADE,
  monto       numeric(18,2) NOT NULL CHECK (monto > 0),
  moneda      text NOT NULL DEFAULT 'ARS',
  metodo      text NOT NULL,
  cuotas      int  NOT NULL DEFAULT 1 CHECK (cuotas >= 1),
  estado      text NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente','procesando','acreditado','rechazado','expirado','cancelado')),
  -- El intento que terminó acreditando. Con esto se va del cobro al proveedor
  -- sin recorrer todos los intentos.
  attempt_ok  uuid,
  expira_at   timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ **Una sola intención viva por orden.** Sin esto, dos pestañas abiertas
-- generan dos intentos de cobro y el comprador puede pagar dos veces. Es la
-- misma familia del descuento de stock duplicado: una operación que corre dos
-- veces y nadie lo nota hasta que aparece en el resumen de la tarjeta.
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_una_viva_por_orden
  ON public.payment_intents (order_id)
  WHERE order_id IS NOT NULL AND estado IN ('pendiente','procesando','acreditado');

CREATE INDEX IF NOT EXISTS payment_intents_org_idx ON public.payment_intents (org_id, created_at DESC);

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_intents_org ON public.payment_intents;
CREATE POLICY payment_intents_org ON public.payment_intents
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── 4. Cada intento con un proveedor ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id   uuid NOT NULL REFERENCES public.payment_intents(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL,
  provider    text NOT NULL REFERENCES public.payment_providers(codigo),
  -- Orden del intento: 1, 2, 3. El segundo existe porque el primero falló.
  nro         int  NOT NULL DEFAULT 1,
  estado      text NOT NULL DEFAULT 'iniciado'
                CHECK (estado IN ('iniciado','pendiente','aprobado','rechazado','error','expirado')),
  external_id text,
  -- Lo que costó, cuando el proveedor lo informa. Se guarda por intento y no
  -- por orden: dos intentos con proveedores distintos cuestan distinto.
  comision    numeric(18,2),
  comision_iva numeric(18,2),
  neto        numeric(18,2),
  -- Por qué falló, en el vocabulario del proveedor. Sin esto, "rechazado" no
  -- dice si fue fondos insuficientes o un problema del proveedor, y son cosas
  -- muy distintas para decidir si conviene reintentar.
  motivo      text,
  raw         jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resuelto_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_nro_unico
  ON public.payment_attempts (intent_id, nro);
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_externo_unico
  ON public.payment_attempts (provider, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_attempts_intent_idx ON public.payment_attempts (intent_id);

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_attempts_org ON public.payment_attempts;
CREATE POLICY payment_attempts_org ON public.payment_attempts
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── 5. El ruteo: elegir por costo real ─────────────────────────────────────
--
-- Devuelve los proveedores que **pueden** cobrar eso, ordenados por costo real
-- para ese monto y esas cuotas. El costo sale de `payment_provider_fees`, que
-- ya guarda comisión, IVA de la comisión y días de acreditación.
--
-- Es lo que ningún competidor hace: Tiendanube y Empretienda tienen el
-- proveedor que tienen.

CREATE OR REPLACE FUNCTION public.pago_proveedores_para(
  p_org      uuid,
  p_metodo   text,
  p_monto    numeric,
  p_cuotas   int DEFAULT 1,
  p_moneda   text DEFAULT 'ARS'
) RETURNS TABLE (
  provider    text,
  prioridad   int,
  costo       numeric,
  costo_pct   numeric,
  dias_acredita int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH reglas AS (
    -- La regla del comercio gana sobre la de plataforma para el mismo par
    -- (método, proveedor). `DISTINCT ON` con org_id primero hace exactamente eso.
    SELECT DISTINCT ON (r.metodo, r.provider)
           r.provider, r.prioridad
      FROM public.payment_routing r
     WHERE r.is_active
       AND r.metodo = p_metodo
       AND (r.org_id IS NULL OR r.org_id = p_org)
       AND (r.monto_min IS NULL OR p_monto >= r.monto_min)
       AND (r.monto_max IS NULL OR p_monto <= r.monto_max)
     ORDER BY r.metodo, r.provider, (r.org_id IS NOT NULL) DESC
  ),
  costos AS (
    SELECT
      g.provider,
      g.prioridad,
      -- La tarifa vigente más específica: la que coincide en cuotas, o la
      -- genérica. `effective_from` deja tener el histórico sin borrar.
      (SELECT f.percent_fee FROM public.payment_provider_fees f
        WHERE f.provider = g.provider AND f.method = p_metodo
          AND COALESCE(f.installments, p_cuotas) = p_cuotas
          AND f.currency = p_moneda
          AND (f.effective_from IS NULL OR f.effective_from <= CURRENT_DATE)
        ORDER BY f.installments NULLS LAST, f.effective_from DESC NULLS LAST
        LIMIT 1) AS pct,
      (SELECT f.fixed_fee FROM public.payment_provider_fees f
        WHERE f.provider = g.provider AND f.method = p_metodo
          AND COALESCE(f.installments, p_cuotas) = p_cuotas
          AND f.currency = p_moneda
        ORDER BY f.installments NULLS LAST, f.effective_from DESC NULLS LAST
        LIMIT 1) AS fijo,
      (SELECT f.iva_on_fee_pct FROM public.payment_provider_fees f
        WHERE f.provider = g.provider AND f.method = p_metodo
        ORDER BY f.effective_from DESC NULLS LAST LIMIT 1) AS iva_pct,
      (SELECT f.release_days FROM public.payment_provider_fees f
        WHERE f.provider = g.provider AND f.method = p_metodo
        ORDER BY f.effective_from DESC NULLS LAST LIMIT 1) AS dias
    FROM reglas g
    JOIN public.payment_providers pp ON pp.codigo = g.provider
   WHERE pp.is_active
     -- ⚠️ Un proveedor que no sabe hacer el método no se elige, por barato que
     -- sea. El costo se compara **después** de filtrar por capacidad.
     AND p_metodo = ANY(pp.metodos)
     AND p_moneda = ANY(pp.monedas)
     AND (p_cuotas = 1 OR pp.soporta_cuotas)
  )
  SELECT
    c.provider,
    c.prioridad,
    -- Costo total en pesos: porcentaje sobre el monto, más el fijo, más el IVA
    -- de la comisión. Sin el IVA el número miente en un 21%.
    ROUND(
      (p_monto * COALESCE(c.pct, 0) / 100.0 + COALESCE(c.fijo, 0))
      * (1 + COALESCE(c.iva_pct, 0) / 100.0), 2) AS costo,
    COALESCE(c.pct, 0) AS costo_pct,
    COALESCE(c.dias, 0) AS dias_acredita
  FROM costos c
  ORDER BY c.prioridad, 3;
$fn$;

COMMENT ON FUNCTION public.pago_proveedores_para IS
  'Proveedores capaces de cobrar eso, ordenados por prioridad y costo real. El costo incluye el IVA de la comision: sin el, el numero miente 21%.';

-- ── 6. Crear la intención ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pago_intent_crear(
  p_order_id uuid,
  p_metodo   text DEFAULT NULL,
  p_cuotas   int  DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_o        public.ecommerce_orders;
  v_ya       public.payment_intents;
  v_metodo   text;
  v_prov     text;
  v_intent   uuid;
  v_attempt  uuid;
BEGIN
  SELECT * INTO v_o FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_o.id IS NULL THEN
    RAISE EXCEPTION 'La orden no existe';
  END IF;

  v_metodo := COALESCE(NULLIF(btrim(p_metodo), ''), v_o.payment_method);

  -- ⚠️ Idempotencia por orden. Si ya hay una intención viva se devuelve esa: dos
  -- pestañas abiertas no pueden generar dos cobros.
  SELECT * INTO v_ya FROM public.payment_intents
   WHERE order_id = p_order_id AND estado IN ('pendiente','procesando','acreditado')
   LIMIT 1;

  IF v_ya.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'intent_id', v_ya.id, 'estado', v_ya.estado, 'reusado', true,
      'monto', v_ya.monto);
  END IF;

  -- Una orden ya pagada no se vuelve a cobrar.
  IF v_o.payment_status = 'paid' THEN
    RAISE EXCEPTION 'La orden % ya está pagada', v_o.order_number;
  END IF;

  SELECT p.provider INTO v_prov
    FROM public.pago_proveedores_para(v_o.org_id, v_metodo, v_o.total, p_cuotas) p
   LIMIT 1;

  IF v_prov IS NULL THEN
    -- Se dice cuál método no tiene salida, en vez de un error genérico: es lo
    -- que el comercio necesita para arreglarlo.
    RAISE EXCEPTION 'No hay ningún proveedor activo que pueda cobrar "%" en esta tienda', v_metodo;
  END IF;

  INSERT INTO public.payment_intents (org_id, order_id, monto, moneda, metodo, cuotas)
  VALUES (v_o.org_id, p_order_id, v_o.total, 'ARS', v_metodo, GREATEST(p_cuotas, 1))
  RETURNING id INTO v_intent;

  INSERT INTO public.payment_attempts (intent_id, org_id, provider, nro)
  VALUES (v_intent, v_o.org_id, v_prov, 1)
  RETURNING id INTO v_attempt;

  PERFORM public.emitir_evento(v_o.org_id, 'pago', v_intent, 'pago.iniciado',
    jsonb_build_object('intent_id', v_intent, 'order_id', p_order_id,
                       'monto', v_o.total, 'metodo', v_metodo, 'provider', v_prov));

  RETURN jsonb_build_object(
    'intent_id', v_intent, 'attempt_id', v_attempt, 'provider', v_prov,
    'monto', v_o.total, 'metodo', v_metodo, 'estado', 'pendiente');
END;
$fn$;

-- ── 7. Registrar el resultado de un intento ────────────────────────────────

CREATE OR REPLACE FUNCTION public.pago_attempt_resultado(
  p_attempt_id  uuid,
  p_estado      text,
  p_external_id text DEFAULT NULL,
  p_comision    numeric DEFAULT NULL,
  p_comision_iva numeric DEFAULT NULL,
  p_neto        numeric DEFAULT NULL,
  p_motivo      text DEFAULT NULL,
  p_raw         jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_a public.payment_attempts;
  v_i public.payment_intents;
BEGIN
  SELECT * INTO v_a FROM public.payment_attempts WHERE id = p_attempt_id;
  IF v_a.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'intento desconocido');
  END IF;

  -- Un intento ya resuelto no cambia de opinión. El webhook del proveedor puede
  -- llegar dos veces —es su comportamiento normal— y aceptarlo de nuevo
  -- reescribiría el resultado.
  IF v_a.estado IN ('aprobado','rechazado','expirado') THEN
    RETURN jsonb_build_object('ok', true, 'repetido', true, 'estado', v_a.estado);
  END IF;

  SELECT * INTO v_i FROM public.payment_intents WHERE id = v_a.intent_id;

  UPDATE public.payment_attempts
     SET estado = p_estado, external_id = COALESCE(p_external_id, external_id),
         comision = p_comision, comision_iva = p_comision_iva, neto = p_neto,
         motivo = p_motivo, raw = COALESCE(p_raw, raw), resuelto_at = now()
   WHERE id = p_attempt_id;

  IF p_estado = 'aprobado' THEN
    UPDATE public.payment_intents
       SET estado = 'acreditado', attempt_ok = p_attempt_id, updated_at = now()
     WHERE id = v_a.intent_id;

    PERFORM public.emitir_evento(v_a.org_id, 'pago', v_a.intent_id, 'pago.acreditado',
      jsonb_build_object('intent_id', v_a.intent_id, 'attempt_id', p_attempt_id,
                         'order_id', v_i.order_id, 'provider', v_a.provider,
                         'monto', v_i.monto, 'comision', p_comision, 'neto', p_neto));

  ELSIF p_estado IN ('rechazado','error') THEN
    -- ⚠️ El intent NO pasa a rechazado todavía: queda pendiente para que se
    -- pueda intentar con otro proveedor. Cerrarlo acá haría que un rechazo de
    -- un proveedor perdiera la venta.
    UPDATE public.payment_intents SET updated_at = now() WHERE id = v_a.intent_id;

    PERFORM public.emitir_evento(v_a.org_id, 'pago', v_a.intent_id, 'pago.rechazado',
      jsonb_build_object('intent_id', v_a.intent_id, 'attempt_id', p_attempt_id,
                         'provider', v_a.provider, 'motivo', p_motivo));
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado', p_estado, 'intent_id', v_a.intent_id);
END;
$fn$;

-- ── 8. Failover: el siguiente proveedor ────────────────────────────────────
--
-- ⚠️ **No se dispara solo.** Un reintento automático puede terminar en doble
-- cobro si el primero en realidad salió y el aviso se perdió. Esta función
-- prepara el siguiente intento; llamarla es una decisión del checkout, que es
-- quien sabe que el comprador sigue ahí esperando.

CREATE OR REPLACE FUNCTION public.pago_reintentar(p_intent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_i        public.payment_intents;
  v_usados   text[];
  v_prov     text;
  v_nro      int;
  v_attempt  uuid;
BEGIN
  SELECT * INTO v_i FROM public.payment_intents WHERE id = p_intent_id;
  IF v_i.id IS NULL THEN RAISE EXCEPTION 'La intención de cobro no existe'; END IF;

  IF v_i.estado = 'acreditado' THEN
    RAISE EXCEPTION 'Esa orden ya está paga: reintentar cobraría dos veces';
  END IF;

  -- Los proveedores que ya se probaron no se repiten: si rechazó, va a rechazar
  -- de nuevo, y el comprador ve el mismo error dos veces.
  SELECT array_agg(DISTINCT provider), COALESCE(MAX(nro), 0)
    INTO v_usados, v_nro
    FROM public.payment_attempts WHERE intent_id = p_intent_id;

  SELECT p.provider INTO v_prov
    FROM public.pago_proveedores_para(v_i.org_id, v_i.metodo, v_i.monto, v_i.cuotas) p
   WHERE NOT (p.provider = ANY(COALESCE(v_usados, ARRAY[]::text[])))
   LIMIT 1;

  IF v_prov IS NULL THEN
    -- Se agotaron los proveedores. Ahí sí el intent muere, y el evento deja
    -- constancia de que no fue un proveedor puntual sino todos.
    UPDATE public.payment_intents
       SET estado = 'rechazado', updated_at = now() WHERE id = p_intent_id;

    PERFORM public.emitir_evento(v_i.org_id, 'pago', p_intent_id, 'pago.agotado',
      jsonb_build_object('intent_id', p_intent_id, 'probados', v_usados));

    RETURN jsonb_build_object('ok', false, 'motivo', 'no quedan proveedores para reintentar',
                              'probados', v_usados);
  END IF;

  INSERT INTO public.payment_attempts (intent_id, org_id, provider, nro)
  VALUES (p_intent_id, v_i.org_id, v_prov, v_nro + 1)
  RETURNING id INTO v_attempt;

  UPDATE public.payment_intents SET estado = 'pendiente', updated_at = now()
   WHERE id = p_intent_id;

  RETURN jsonb_build_object('ok', true, 'attempt_id', v_attempt, 'provider', v_prov,
                            'nro', v_nro + 1);
END;
$fn$;

-- ── 9. Lo interno no se llama desde el navegador ───────────────────────────
--
-- La lección de la sesión anterior, aplicada de entrada esta vez.

REVOKE ALL ON FUNCTION public.pago_intent_crear(uuid, text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pago_attempt_resultado(uuid, text, text, numeric, numeric, numeric, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pago_reintentar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pago_proveedores_para(uuid, text, numeric, int, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pago_intent_crear(uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.pago_attempt_resultado(uuid, text, text, numeric, numeric, numeric, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pago_reintentar(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pago_proveedores_para(uuid, text, numeric, int, text) TO service_role;

-- ── 10. Qué ve el comercio ─────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.pagos_por_proveedor AS
SELECT
  a.org_id,
  a.provider,
  count(*)                                        AS intentos,
  count(*) FILTER (WHERE a.estado = 'aprobado')   AS aprobados,
  count(*) FILTER (WHERE a.estado = 'rechazado')  AS rechazados,
  -- La tasa de aprobación es EL número de un orquestador: si un proveedor
  -- aprueba el 70% y otro el 92%, rutear al segundo vale más que cualquier
  -- diferencia de comisión.
  ROUND(100.0 * count(*) FILTER (WHERE a.estado = 'aprobado')
        / NULLIF(count(*) FILTER (WHERE a.estado IN ('aprobado','rechazado')), 0), 1)
                                                  AS aprobacion_pct,
  COALESCE(SUM(a.comision + COALESCE(a.comision_iva, 0))
           FILTER (WHERE a.estado = 'aprobado'), 0) AS comisiones,
  COALESCE(SUM(a.neto) FILTER (WHERE a.estado = 'aprobado'), 0) AS neto
FROM public.payment_attempts a
WHERE public.is_org_member(a.org_id, auth.uid())
GROUP BY a.org_id, a.provider;

COMMENT ON VIEW public.pagos_por_proveedor IS
  'Tasa de aprobacion y costo por proveedor. La aprobacion vale mas que la comision: un proveedor barato que rechaza el 30% sale carisimo.';

GRANT SELECT ON public.pagos_por_proveedor TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ Corrección: dos vocabularios que no se cruzaban, y el costo cero
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La verificación mostró costo **0,00** para MercadoPago sobre $100.000, que es
-- imposible. Tres causas, y las tres son la misma familia de bug:
--
-- **1. Vocabularios distintos.** `payment_provider_fees.method` usa
-- `credit` / `debit` / `wallet` / `transfer` / `cash`, y el ruteo usa el
-- vocabulario de la tienda: `mercadopago` / `tarjeta` / `transferencia` /
-- `efectivo`. Nunca se cruzaban, así que la subconsulta no encontraba fila.
-- Es lo mismo que pasó con las listas de precios: dos generaciones de nombres
-- conviviendo, cada mitad del código leyendo la suya.
--
-- **2. `installments` usa 0, no NULL** para "cualquier cantidad de cuotas". El
-- `COALESCE(f.installments, p_cuotas)` nunca daba con la fila genérica.
--
-- **3. Y el más grave: costo desconocido devolvía CERO.** Un proveedor sin
-- tarifa cargada parecía **gratis** y ganaba el ordenamiento por costo. El
-- router habría elegido justamente el que menos sabemos. Ahora devuelve NULL y
-- va último: no saber cuánto cuesta no es que salga gratis.

CREATE OR REPLACE FUNCTION public.pago_metodo_de_tarifa(p_metodo text, p_cuotas int)
RETURNS text LANGUAGE sql IMMUTABLE
AS $fn$
  -- El puente entre los dos vocabularios, en un solo lugar. Si mañana aparece
  -- un método nuevo se agrega acá y no en cinco consultas.
  SELECT CASE lower(COALESCE(p_metodo, ''))
    WHEN 'efectivo'      THEN 'cash'
    WHEN 'transferencia' THEN 'transfer'
    -- Una compra en cuotas es crédito; una en un pago por la billetera es
    -- `wallet`, que sale bastante más barato. Distinguirlo es plata real.
    WHEN 'mercadopago'   THEN CASE WHEN COALESCE(p_cuotas, 1) > 1 THEN 'credit' ELSE 'wallet' END
    WHEN 'tarjeta'       THEN 'credit'
    WHEN 'debito'        THEN 'debit'
    ELSE 'default'
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.pago_proveedores_para(
  p_org      uuid,
  p_metodo   text,
  p_monto    numeric,
  p_cuotas   int DEFAULT 1,
  p_moneda   text DEFAULT 'ARS'
) RETURNS TABLE (
  provider    text,
  prioridad   int,
  costo       numeric,
  costo_pct   numeric,
  dias_acredita int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH reglas AS (
    SELECT DISTINCT ON (r.metodo, r.provider) r.provider, r.prioridad
      FROM public.payment_routing r
     WHERE r.is_active AND r.metodo = p_metodo
       AND (r.org_id IS NULL OR r.org_id = p_org)
       AND (r.monto_min IS NULL OR p_monto >= r.monto_min)
       AND (r.monto_max IS NULL OR p_monto <= r.monto_max)
     ORDER BY r.metodo, r.provider, (r.org_id IS NOT NULL) DESC
  ),
  capaces AS (
    SELECT g.provider, g.prioridad
      FROM reglas g
      JOIN public.payment_providers pp ON pp.codigo = g.provider
     WHERE pp.is_active
       AND p_metodo = ANY(pp.metodos)
       AND p_moneda = ANY(pp.monedas)
       AND (COALESCE(p_cuotas, 1) = 1 OR pp.soporta_cuotas)
  ),
  tarifa AS (
    SELECT c.provider, c.prioridad, f.percent_fee, f.fixed_fee,
           f.iva_on_fee_pct, f.release_days
      FROM capaces c
      LEFT JOIN LATERAL (
        SELECT *
          FROM public.payment_provider_fees x
         WHERE x.provider = c.provider
           AND x.method   = public.pago_metodo_de_tarifa(p_metodo, p_cuotas)
           AND x.currency = p_moneda
           -- 0 es la fila genérica: vale para cualquier cantidad de cuotas.
           AND COALESCE(x.installments, 0) IN (COALESCE(p_cuotas, 1), 0)
           AND (x.effective_from IS NULL OR x.effective_from <= CURRENT_DATE)
         -- La específica de esas cuotas gana sobre la genérica.
         ORDER BY (COALESCE(x.installments, 0) = COALESCE(p_cuotas, 1)) DESC,
                  x.effective_from DESC NULLS LAST
         LIMIT 1) f ON true
  )
  SELECT
    t.provider,
    t.prioridad,
    -- ⚠️ NULL cuando no hay tarifa cargada. Devolver 0 haría que el proveedor
    -- del que menos sabemos gane el ordenamiento por costo.
    CASE WHEN t.percent_fee IS NULL AND t.fixed_fee IS NULL THEN NULL
         ELSE ROUND((p_monto * COALESCE(t.percent_fee, 0) / 100.0 + COALESCE(t.fixed_fee, 0))
                    * (1 + COALESCE(t.iva_on_fee_pct, 0) / 100.0), 2)
    END AS costo,
    t.percent_fee AS costo_pct,
    t.release_days AS dias_acredita
  FROM tarifa t
  -- Prioridad primero; a igual prioridad, el más barato. Lo que no tiene tarifa
  -- cargada va último: no se lo premia por ser desconocido.
  ORDER BY t.prioridad,
           (t.percent_fee IS NULL),
           ROUND((p_monto * COALESCE(t.percent_fee, 0) / 100.0 + COALESCE(t.fixed_fee, 0))
                 * (1 + COALESCE(t.iva_on_fee_pct, 0) / 100.0), 2);
$fn$;

REVOKE ALL ON FUNCTION public.pago_proveedores_para(uuid, text, numeric, int, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pago_proveedores_para(uuid, text, numeric, int, text) TO service_role;
