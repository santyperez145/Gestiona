-- ═══════════════════════════════════════════════════════════════════════════
-- Endurecer los motores — cerrar los agujeros que abrieron H1, H2, H3
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ **Postgres otorga EXECUTE a PUBLIC por default.** Cada función que creé en
-- las últimas migraciones quedó llamable por `anon` — el rol de la clave
-- anónima, que viaja en el bundle del navegador y cualquiera puede leer.
--
-- No es teórico. Se probó asumiendo el rol `anon`, seis de seis:
--
--   anon escribe en el libro contable ajeno       ASIENTO CREADO
--   anon se acredita plata en la billetera        PLATA ACREDITADA
--   anon marca una suscripcion como pagada        ACEPTADO
--   anon inyecta eventos en la historia ajena     EVENTO CREADO
--   anon vacia la cola de entregas                TOMO LA COLA
--   anon lee el saldo de un comercio ajeno        disponible=19.999.998
--
-- Ese último número es el ataque mirándose el resultado: se acreditó veinte
-- millones y la billetera se los mostró como disponibles. Desde ahí
-- `wallet_solicitar_retiro` —que sí valida membresía— los dejaría retirar. La
-- cadena de robo estaba completa.
--
-- Es exactamente la clase de agujero que este repo ya había cerrado una vez con
-- las políticas `USING (true)`: con la clave anónima se leían los tokens de
-- MercadoPago de todas las organizaciones. La forma es la misma —algo que se
-- creyó interno y era público— y por eso acá también queda una guarda.
--
-- ── La regla ──────────────────────────────────────────────────────────────
--
-- Una función `SECURITY DEFINER` que recibe `org_id` y no verifica quién llama
-- **es un agujero**. Se cierra de las dos maneras a la vez:
--
--   1. REVOKE de PUBLIC, anon y authenticated en todo lo interno.
--   2. Verificación de membresía adentro de lo que sí tiene que ser llamable.
--
-- Las dos, no una: el REVOKE protege de la llamada directa y la verificación
-- protege de que mañana alguien vuelva a otorgar el permiso sin darse cuenta.
--
-- ── Por qué revocar no rompe nada de adentro ──────────────────────────────
--
-- Cuando una función `SECURITY DEFINER` llama a otra, el permiso se evalúa
-- contra el **dueño** de la primera —postgres—, no contra quien la invocó. Los
-- triggers, el cron y `create_store_order` siguen funcionando igual.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Lo interno deja de ser público ──────────────────────────────────────
--
-- Estas funciones las llaman triggers, el cron y otras funciones. Ninguna tiene
-- por qué ser invocable desde un navegador.

DO $blk$
DECLARE
  v_fn   text;
  v_args text;
  v_internas text[] := ARRAY[
    -- H2: el motor de eventos
    'emitir_evento', 'outbox_tomar', 'outbox_entregado', 'outbox_fallado',
    'outbox_despachar', 'outbox_confirmar', 'outbox_limpiar', 'outbox_espera',
    -- H3: el libro
    'ledger_asentar', 'ledger_contraasentar', 'ledger_plan_default',
    'ledger_asentar_orden_pagada', 'ledger_revertir_orden',
    -- Billetera
    'wallet_liberar',
    -- Suscripciones: la más peligrosa de todas, marcaba pagado gratis
    'suscripcion_registrar_pago', 'suscripcion_actualizar_estado',
    -- H1: idempotencia. Reservar claves ajenas bloquea checkouts legítimos.
    'idempotencia_reservar', 'idempotencia_completar', 'idempotencia_fallar'
  ];
BEGIN
  FOR v_fn, v_args IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY(v_internas)
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      v_fn, v_args);
  END LOOP;
END $blk$;

-- Las dos que sí llama una Edge Function con `service_role` (el webhook de
-- MercadoPago). Se otorgan explícitamente porque el REVOKE de PUBLIC también
-- se las sacó.
DO $blk$
DECLARE v_args text;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='suscripcion_registrar_pago';
  IF v_args IS NOT NULL THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.suscripcion_registrar_pago(%s) TO service_role', v_args);
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='suscripcion_actualizar_estado';
  IF v_args IS NOT NULL THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.suscripcion_actualizar_estado(%s) TO service_role', v_args);
  END IF;
END $blk$;

-- ── 2. Lo que sí se llama desde el panel, con verificación adentro ─────────
--
-- `wallet_saldo` la usa la pantalla de billetera, así que tiene que seguir
-- siendo llamable. Lo que no puede es contestar por una organización ajena.

CREATE OR REPLACE FUNCTION public.wallet_saldo(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_pendiente  numeric := 0;
  v_disponible numeric := 0;
  v_retirado   numeric := 0;
BEGIN
  -- ⚠️ La verificación que faltaba. Sin esto, cualquiera con la clave anónima
  -- leía el saldo de cualquier comercio pasándole el uuid.
  IF NOT public.is_org_member(p_org, auth.uid())
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización' USING ERRCODE = '42501';
  END IF;

  -- Se suma sobre las partidas, no sobre una columna. Es la propiedad que hace
  -- que este número no pueda mentir: si no coincide con el libro, es que no hay
  -- dos números.
  SELECT
    COALESCE(SUM(CASE WHEN a.codigo = '1.1.03' THEN l.debe - l.haber ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.codigo = '1.1.04' THEN l.debe - l.haber ELSE 0 END), 0)
  INTO v_pendiente, v_disponible
  FROM public.ledger_lines l
  JOIN public.ledger_accounts a ON a.id = l.account_id
  WHERE l.org_id = p_org AND a.codigo IN ('1.1.03', '1.1.04');

  SELECT COALESCE(SUM(monto), 0) INTO v_retirado
    FROM public.wallet_withdrawals
   WHERE org_id = p_org AND estado IN ('solicitado', 'en_proceso');

  RETURN jsonb_build_object(
    'pendiente',  ROUND(GREATEST(v_pendiente, 0), 2),
    'disponible', ROUND(v_disponible, 2),
    'en_retiro',  ROUND(v_retirado, 2),
    'retirable',  ROUND(GREATEST(v_disponible - v_retirado, 0), 2),
    'total',      ROUND(GREATEST(v_pendiente, 0) + v_disponible, 2),
    'moneda',     'ARS');
END;
$fn$;

-- `ledger_saldo` recibe una cuenta, y una cuenta pertenece a una organización.
CREATE OR REPLACE FUNCTION public.ledger_saldo(
  p_account_id uuid,
  p_hasta      date DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_org uuid; v_saldo numeric;
BEGIN
  SELECT org_id INTO v_org FROM public.ledger_accounts WHERE id = p_account_id;
  IF v_org IS NULL THEN RETURN 0; END IF;

  IF NOT public.is_org_member(v_org, auth.uid())
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa cuenta' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(
    CASE WHEN a.tipo IN ('activo', 'gasto') THEN l.debe - l.haber
         ELSE l.haber - l.debe END), 0)
    INTO v_saldo
    FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
    JOIN public.ledger_entries  e ON e.id = l.entry_id
   WHERE l.account_id = p_account_id
     AND (p_hasta IS NULL OR e.fecha <= p_hasta);

  RETURN v_saldo;
END;
$fn$;

-- ── 3. El segundo agujero: `destino = 'interno'` ──────────────────────────
--
-- ⚠️ El worker ejecuta `SELECT <objetivo>($1)` para las suscripciones internas.
-- El nombre va por `format(%I)`, así que no hay inyección — pero **el dueño de
-- un comercio podía crear una suscripción interna apuntando a cualquier función
-- del esquema que reciba un jsonb**, incluidas las `SECURITY DEFINER` que
-- acaban de revocarse. Habría sido la puerta de atrás justo después de cerrar
-- la de adelante.
--
-- Lo interno queda reservado a las suscripciones de plataforma (`org_id` NULL),
-- que sólo puede crear quien tiene acceso directo a la base. La RLS ya impide
-- que un miembro escriba filas con `org_id` NULL, así que las dos reglas se
-- refuerzan.

ALTER TABLE public.event_subscriptions DROP CONSTRAINT IF EXISTS event_subscriptions_interno_es_de_plataforma;
ALTER TABLE public.event_subscriptions ADD CONSTRAINT event_subscriptions_interno_es_de_plataforma
  CHECK (destino <> 'interno' OR org_id IS NULL);

-- ── 4. El tercer agujero: SSRF por webhook ────────────────────────────────
--
-- ⚠️ Un webhook es una URL que **el servidor** visita. Apuntarla a
-- `169.254.169.254` —el servicio de metadata de la nube— o a `localhost` la
-- convierte en una forma de leer la red interna desde afuera. `src/lib/outbox.ts`
-- ya lo validaba, pero el cliente no es la autoridad: un INSERT directo por
-- PostgREST se lo saltea.

ALTER TABLE public.event_subscriptions DROP CONSTRAINT IF EXISTS event_subscriptions_webhook_publico;
ALTER TABLE public.event_subscriptions ADD CONSTRAINT event_subscriptions_webhook_publico
  CHECK (
    destino <> 'webhook'
    OR (
      objetivo ~* '^https?://'
      -- Nada de localhost, loopback ni rangos privados. Se escribe explícito
      -- para que se pueda leer qué se está bloqueando y por qué.
      AND objetivo !~* '^https?://(localhost|127\.|0\.0\.0\.0|\[::1\])'
      AND objetivo !~* '^https?://10\.'
      AND objetivo !~* '^https?://192\.168\.'
      AND objetivo !~* '^https?://169\.254\.'
      AND objetivo !~* '^https?://172\.(1[6-9]|2[0-9]|3[01])\.'
      AND objetivo !~* '^https?://[^/]*\.(local|internal)(/|$|:)'
    )
  );

-- ── 5. La guarda, para que esto no vuelva ─────────────────────────────────
--
-- No alcanza con arreglarlo: hay que poder **ver** si vuelve a pasar. Esta
-- vista lista toda función `SECURITY DEFINER` que sea llamable por `anon` o
-- `authenticated` y no verifique permisos adentro.
--
-- Es el mismo criterio que `rls_audit_open_policies`: una lista que tiene que
-- estar vacía salvo por lo que se declare a propósito.

CREATE OR REPLACE VIEW public.audit_funciones_expuestas AS
SELECT
  p.proname AS funcion,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  has_function_privilege('anon', p.oid, 'EXECUTE')          AS llama_anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS llama_authenticated,
  -- Si recibe una organización y no la valida, es un agujero.
  (pg_get_function_identity_arguments(p.oid) ILIKE '%org%')  AS recibe_org
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  -- Se reconocen las cuatro formas de verificar que hay en el repo. ⚠️ Sin la
  -- consulta directa a `memberships`, la vista marcaba `save_afip_config` como
  -- agujero cuando valida bien —dueño o admin— sólo que sin el helper. Una
  -- guarda que grita en falso se termina ignorando, y ahí deja de servir.
  AND pg_get_functiondef(p.oid) NOT ILIKE '%is_org_member%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%is_platform_admin%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%has_permission%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%public.memberships%'
  -- La superficie pública de la tienda es pública a propósito: el comprador no
  -- tiene sesión y resuelve todo por slug, que el servidor valida.
  AND p.proname NOT LIKE '%store%'
  AND p.proname NOT LIKE 'get_store%'
  AND p.proname NOT IN ('handle_new_user_create_org', 'next_store_order_number');

COMMENT ON VIEW public.audit_funciones_expuestas IS
  'Funciones SECURITY DEFINER llamables desde el navegador que no verifican permisos. Deberia estar casi vacia: cada fila es un posible agujero.';

GRANT SELECT ON public.audit_funciones_expuestas TO authenticated;

-- ── 6. Lo que ya estaba abierto, que no lo abrí yo ────────────────────────
--
-- La vista de arriba encontró **21 funciones previas** con el mismo patrón. Se
-- triagearon por dos preguntas: ¿verifica algo? ¿escribe?
--
-- Las de sólo lectura del storefront —`resolve_store_line`, `store_promo_price`,
-- `platform_commission_amount`— son públicas a propósito: el comprador no tiene
-- sesión y todo se resuelve por slug, que el servidor valida. Se dejan.
--
-- Las **nueve que escriben sin verificar nada** no tienen excusa. Ninguna
-- necesita ser llamable por un visitante sin sesión:
--
--   record_payment_settlement       toca plata
--   record_debt_payment_cash_entry  toca plata
--   seed_default_*, seed_demo_data  siembran datos en una organización ajena
--   apply_territory_rules, generate_po_number
--
-- ⚠️ Se revoca de `anon` a las nueve y de `authenticated` sólo a las dos de
-- plata, que las llama el servidor. Sacarle el permiso a `authenticated` en las
-- de siembra podría romper el alta de una organización desde el panel, y
-- endurecer rompiendo es cómo se termina aflojando todo de nuevo.

DO $blk$
DECLARE
  v_fn   text;
  v_args text;
  v_sin_sesion text[] := ARRAY[
    'record_payment_settlement', 'record_debt_payment_cash_entry',
    'seed_default_alert_rules', 'seed_default_permissions',
    'seed_default_price_list', 'seed_default_shipping_zones',
    'seed_demo_data', 'apply_territory_rules', 'generate_po_number'
  ];
  v_solo_servidor text[] := ARRAY[
    'record_payment_settlement', 'record_debt_payment_cash_entry'
  ];
BEGIN
  FOR v_fn, v_args IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY(v_sin_sesion)
  LOOP
    -- ⚠️ **FROM PUBLIC, no sólo FROM anon.** Revocarle a `anon` no le saca
    -- nada si el permiso lo tiene vía PUBLIC, del que todo rol es miembro.
    -- La primera versión de este bloque revocaba sólo de `anon` y la
    -- verificación mostró las ocho funciones seguían llamables. Es el detalle
    -- que hace que un endurecimiento no endurezca nada.
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', v_fn, v_args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', v_fn, v_args);

    IF v_fn = ANY(v_solo_servidor) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', v_fn, v_args);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', v_fn, v_args);
    END IF;
  END LOOP;
END $blk$;

-- == 7. Las tres que escriben ventas y stock para cualquier organizacion ===
--
-- Regeneradas desde `pg_get_functiondef` con un script, insertando la guarda:
-- reescribir de memoria una funcion de 92 lineas es como casi se rompe
-- `mark_store_order_paid`.

CREATE OR REPLACE FUNCTION public.create_sales_transaction(p_org_id uuid, p_sales jsonb, p_source text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_source text := lower(btrim(COALESCE(p_source, 'manual')));
  v_transaction_id uuid := gen_random_uuid();
  v_line jsonb;
  v_sale public.sales%ROWTYPE;
  v_sale_id uuid;
  v_sale_ids jsonb := '[]'::jsonb;
  v_first_date timestamptz;
BEGIN
  -- ⚠️ Endurecimiento: esta función es SECURITY DEFINER y recibe la
  -- organización por parámetro. Sin esto, cualquier usuario autenticado podía
  -- operar sobre OTRA organización pasándole el uuid — y los compradores de la
  -- tienda también son usuarios autenticados, así que la superficie era
  -- cualquiera que se hubiera registrado para comprar un perfume.
  IF NOT public.is_org_member(p_org_id, auth.uid())
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización' USING ERRCODE = '42501';
  END IF;

  IF v_actor_id IS NULL
     OR NOT public.has_org_role(p_org_id, v_actor_id, ARRAY['owner','admin','vendedor']) THEN
    RAISE EXCEPTION 'No tenés permiso para registrar ventas en esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(p_sales) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_sales) = 0
     OR jsonb_array_length(p_sales) > 100 THEN
    RAISE EXCEPTION 'Una venta debe tener entre 1 y 100 renglones';
  END IF;

  -- Los conectores de tienda, marketplace y API entran como servidor y usan
  -- el trigger de `sales`; este RPC autenticado sólo representa operaciones
  -- humanas del panel. Así nadie puede fingir una venta de otro canal ni
  -- inyectar ecommerce_order_id para reagrupar una orden externa.
  IF v_source NOT IN ('manual', 'pos', 'presupuesto') THEN
    RAISE EXCEPTION 'Este canal se registra únicamente desde su integración de servidor';
  END IF;

  SELECT NULLIF((p_sales->0)->>'date', '')::timestamptz
    INTO v_first_date;

  INSERT INTO public.sale_transactions (
    id, org_id, source, created_by, occurred_at
  ) VALUES (
    v_transaction_id, p_org_id, v_source, v_actor_id, COALESCE(v_first_date, now())
  );
  PERFORM set_config('gestiona.sale_transaction_id', v_transaction_id::text, true);

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sales)
  LOOP
    SELECT * INTO v_sale
    FROM jsonb_populate_record(NULL::public.sales, v_line);

    v_sale.id := COALESCE(v_sale.id, gen_random_uuid());
    v_sale.org_id := p_org_id;
    v_sale.user_id := v_actor_id;
    v_sale.sale_transaction_id := v_transaction_id;
    v_sale.ecommerce_order_id := NULL;
    v_sale.source := v_source;
    v_sale.created_at := now();
    v_sale.product_name := NULLIF(left(btrim(COALESCE(v_sale.product_name, '')), 500), '');
    v_sale.quantity := COALESCE(v_sale.quantity, 0);
    v_sale.unit_price_ars := COALESCE(v_sale.unit_price_ars, 0);
    v_sale.total_ars := COALESCE(v_sale.total_ars, 0);
    v_sale.cost_per_unit_usd := COALESCE(v_sale.cost_per_unit_usd, 0);
    v_sale.cost_of_goods_ars := COALESCE(v_sale.cost_of_goods_ars, 0);
    v_sale.profit_ars := COALESCE(v_sale.profit_ars, 0);
    v_sale.profit_usd := COALESCE(v_sale.profit_usd, 0);
    v_sale.discount_applied := COALESCE(v_sale.discount_applied, false);
    v_sale.date := COALESCE(v_sale.date, now());
    v_sale.paid := COALESCE(v_sale.paid, true);
    v_sale.payment_method := COALESCE(NULLIF(left(btrim(COALESCE(v_sale.payment_method, '')), 100), ''), 'efectivo');
    v_sale.returned := COALESCE(v_sale.returned, false);
    v_sale.returned_quantity := COALESCE(v_sale.returned_quantity, 0);

    IF v_sale.product_name IS NULL OR v_sale.quantity <= 0 THEN
      RAISE EXCEPTION 'Cada renglón necesita un producto y una cantidad mayor a cero';
    END IF;

    INSERT INTO public.sales
    SELECT (v_sale).*
    RETURNING id INTO v_sale_id;

    v_sale_ids := v_sale_ids || to_jsonb(v_sale_id);
  END LOOP;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'sale_ids', v_sale_ids,
    'lines', jsonb_array_length(v_sale_ids)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_stock_reservation(p_org_id uuid, p_product_id uuid, p_quantity integer, p_customer_name text, p_customer_phone text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text, p_variant_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_available integer;
  v_id uuid;
BEGIN
  -- ⚠️ Endurecimiento: esta función es SECURITY DEFINER y recibe la
  -- organización por parámetro. Sin esto, cualquier usuario autenticado podía
  -- operar sobre OTRA organización pasándole el uuid — y los compradores de la
  -- tienda también son usuarios autenticados, así que la superficie era
  -- cualquiera que se hubiera registrado para comprar un perfume.
  IF NOT public.is_org_member(p_org_id, auth.uid())
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;
  IF p_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_variants v
    WHERE v.id = p_variant_id AND v.product_id = p_product_id AND v.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Variante no encontrada para el producto';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = p_location_id AND l.org_id = p_org_id AND l.active
  ) THEN
    RAISE EXCEPTION 'La sucursal de la reserva tiene que estar activa y pertenecer a la organización';
  END IF;

  PERFORM 1 FROM public.products WHERE id = p_product_id FOR UPDATE;
  v_available := public.stock_disponible(p_product_id, p_variant_id, p_location_id);
  IF p_quantity > v_available THEN
    RAISE EXCEPTION 'Stock insuficiente: hay % disponible(s)', GREATEST(v_available, 0);
  END IF;

  INSERT INTO public.stock_reservations (
    org_id, product_id, variant_id, location_id, customer_name, customer_phone,
    quantity, expires_at, notes, created_by
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_location_id, p_customer_name, p_customer_phone,
    p_quantity, p_expires_at, p_notes, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_manual_stock_movement(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_movement_type text, p_quantity integer, p_notes text, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_name text;
  v_variant_name text;
BEGIN
  -- ⚠️ Endurecimiento: esta función es SECURITY DEFINER y recibe la
  -- organización por parámetro. Sin esto, cualquier usuario autenticado podía
  -- operar sobre OTRA organización pasándole el uuid — y los compradores de la
  -- tienda también son usuarios autenticados, así que la superficie era
  -- cualquiera que se hubiera registrado para comprar un perfume.
  IF NOT public.is_org_member(p_org_id, auth.uid())
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION 'Unauthorized: el actor no coincide con la sesión';
  END IF;

  IF NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'La cantidad del movimiento no puede ser cero';
  END IF;

  IF p_movement_type NOT IN ('breakage','gift','reservation','adjustment_in','adjustment_out') THEN
    RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
  END IF;

  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'Variant not found for product: %', p_variant_id;
    END IF;
  END IF;

  RETURN public.record_stock_movement(
    p_org_id => p_org_id,
    p_product_id => p_product_id,
    p_variant_id => p_variant_id,
    p_product_name => v_product_name,
    p_variant_name => v_variant_name,
    p_movement_type => p_movement_type,
    p_quantity => p_quantity,
    p_reference_type => 'manual',
    p_reference_id => NULL,
    p_notes => p_notes,
    p_created_by => auth.uid()
  );
END;
$function$
;

