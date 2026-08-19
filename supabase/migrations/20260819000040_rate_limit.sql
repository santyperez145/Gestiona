-- ═══════════════════════════════════════════════════════════════════════════
-- Rate limiting en la superficie pública
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ **Medido: no existe ninguno.** 250 funciones son llamables por `anon` y
-- ~20 de ellas escriben, incluida `create_store_order`. Nadie cuenta cuántas
-- veces las llama la misma persona.
--
-- ── Por qué esto es explotable hoy, y no es teórico ───────────────────────
--
-- **Denegación de inventario.** Desde A2, crear una orden **reserva stock** —
-- sin pagar nada. Un script que llame `create_store_order` mil veces deja al
-- comercio con stock disponible en cero durante toda la ventana de reserva. La
-- tienda queda sin vender, no hay ninguna orden pagada, y el atacante no gastó
-- un peso. Cada pieza por separado es correcta: reservar stock antes de cobrar
-- es lo que evita vender dos veces la última unidad. Lo que falta es el límite.
--
-- **Adivinar cupones.** `check_store_coupon` es pública y responde si un código
-- existe. Sin límite, se prueban millones y se encuentran todos.
--
-- **Costo.** Cada orden dispara eventos, filas de outbox y emails.
--
-- ── Las decisiones que definen si esto sirve ──────────────────────────────
--
-- **1. ¿Falla abierto o cerrado?** Abierto. Si el limitador tiene un bug o la
-- tabla se traba, **la tienda tiene que seguir vendiendo**. Un limitador que
-- rompe ventas hace más daño que el abuso que previene, y además es la forma
-- más rápida de que alguien lo desactive entero. Se registra el problema y se
-- deja pasar.
--
-- **2. ¿Ventana fija o deslizante?** Fija. Una deslizante es más justa pero
-- necesita guardar cada evento; la fija guarda un contador. El costo conocido
-- es que se puede hacer el doble del límite justo en el borde de dos ventanas —
-- aceptable para frenar un script, que es de lo que se trata.
--
-- **3. ¿Cuál es la clave?** La IP, que PostgREST expone en `request.headers`.
-- ⚠️ Cuando no está —una llamada interna, un cliente que no la manda— se cae a
-- la tienda como clave. Es más grosero: limita a todos los compradores de esa
-- tienda juntos. Se elige igual porque la alternativa es no limitar nada, y el
-- límite por tienda es lo bastante alto como para no molestar a nadie real.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rate_limits (
  -- Qué se está limitando y a quién: 'checkout:186.13.x.x'
  clave      text        NOT NULL,
  -- Inicio de la ventana. Con la clave forma la primary key, así que cada
  -- ventana es una fila y el contador se incrementa con un UPSERT atómico.
  ventana    timestamptz NOT NULL,
  contador   int         NOT NULL DEFAULT 1,
  PRIMARY KEY (clave, ventana)
);

CREATE INDEX IF NOT EXISTS rate_limits_viejas_idx ON public.rate_limits (ventana);

COMMENT ON TABLE public.rate_limits IS
  'Contador por clave y ventana fija. Falla abierto a proposito: un limitador que rompe ventas hace mas dano que el abuso.';

-- Nadie la lee ni la escribe desde afuera: la tocan funciones SECURITY DEFINER.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- ── De dónde sale la IP ────────────────────────────────────────────────────
--
-- PostgREST publica los headers del request en un GUC. Fuera de PostgREST
-- —psql, el cron, una función llamando a otra— no existe, y ahí devuelve NULL.

CREATE OR REPLACE FUNCTION public.ip_del_request()
RETURNS text LANGUAGE plpgsql STABLE
AS $fn$
DECLARE v_h text; v_ip text;
BEGIN
  BEGIN
    v_h := current_setting('request.headers', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF v_h IS NULL OR v_h = '' THEN RETURN NULL; END IF;

  -- `x-forwarded-for` puede traer varias IPs separadas por coma: la primera es
  -- la del cliente y el resto son los proxies. Se toma la primera.
  v_ip := split_part(COALESCE(
    (v_h::jsonb)->>'x-forwarded-for',
    (v_h::jsonb)->>'x-real-ip',
    ''), ',', 1);

  RETURN NULLIF(btrim(v_ip), '');
EXCEPTION WHEN OTHERS THEN
  -- Un header mal formado no puede tumbar un checkout.
  RETURN NULL;
END;
$fn$;

-- ── El limitador ───────────────────────────────────────────────────────────
--
-- Devuelve `true` si la operación puede seguir. **No lanza excepción**: quien
-- llama decide qué hacer, porque no es lo mismo frenar un checkout que frenar
-- un intento de cupón.

CREATE OR REPLACE FUNCTION public.rate_limit_consumir(
  p_bucket  text,               -- qué se limita: 'checkout', 'cupon'
  p_sujeto  text,               -- a quién: IP, o lo que haya
  p_max     int,
  p_ventana interval DEFAULT interval '1 minute'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_clave   text;
  v_inicio  timestamptz;
  v_cuenta  int;
BEGIN
  IF COALESCE(p_max, 0) <= 0 THEN RETURN true; END IF;

  v_clave := p_bucket || ':' || COALESCE(NULLIF(btrim(p_sujeto), ''), 'sin-sujeto');

  -- El inicio de la ventana actual, redondeado hacia abajo. Dos llamadas del
  -- mismo minuto caen en la misma fila sin necesidad de leer antes de escribir.
  v_inicio := to_timestamp(
    floor(extract(epoch FROM now()) / extract(epoch FROM p_ventana))
    * extract(epoch FROM p_ventana));

  INSERT INTO public.rate_limits (clave, ventana, contador)
  VALUES (v_clave, v_inicio, 1)
  ON CONFLICT (clave, ventana) DO UPDATE
    SET contador = public.rate_limits.contador + 1
  RETURNING contador INTO v_cuenta;

  -- Se limpia lo viejo de vez en cuando, sin un cron sólo para esto. El `< 1`
  -- hace que ocurra en aproximadamente una de cada cien llamadas.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE ventana < now() - interval '1 hour';
  END IF;

  RETURN v_cuenta <= p_max;

EXCEPTION WHEN OTHERS THEN
  -- ⚠️ Falla ABIERTO. Si el limitador se rompe, la tienda sigue vendiendo.
  RAISE WARNING 'rate_limit_consumir falló para %: %', v_clave, SQLERRM;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rate_limit_consumir(text, text, int, interval)
  FROM PUBLIC, anon, authenticated;

-- ── Atajo con la clave ya resuelta ─────────────────────────────────────────
--
-- La IP si está; si no, lo que le pasen —típicamente el slug de la tienda—.
-- Tener esto en un solo lugar evita que cada llamador invente su propio
-- fallback y que la mitad se olvide de ponerlo.

CREATE OR REPLACE FUNCTION public.rate_limit_publico(
  p_bucket   text,
  p_fallback text,
  p_max      int,
  p_ventana  interval DEFAULT interval '1 minute'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  RETURN public.rate_limit_consumir(
    p_bucket,
    COALESCE(public.ip_del_request(), 'tienda:' || COALESCE(p_fallback, '?')),
    p_max, p_ventana);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rate_limit_publico(text, text, int, interval)
  FROM PUBLIC, anon, authenticated;

-- ── Observabilidad ─────────────────────────────────────────────────────────
--
-- Un limitador que nunca se mira no dice si está frenando abuso o clientes.

CREATE OR REPLACE VIEW public.rate_limit_actividad AS
SELECT
  split_part(clave, ':', 1) AS bucket,
  count(*)                  AS sujetos,
  sum(contador)             AS llamadas,
  max(contador)             AS mas_activo,
  max(ventana)              AS ultima_ventana
FROM public.rate_limits
WHERE ventana > now() - interval '1 hour'
  AND public.is_platform_admin(auth.uid())
GROUP BY 1;

COMMENT ON VIEW public.rate_limit_actividad IS
  'Actividad de la ultima hora por bucket. Solo staff de plataforma: saber quien esta al limite es informacion de seguridad.';

GRANT SELECT ON public.rate_limit_actividad TO authenticated;

-- == Conectado a la superficie publica que escribe =========================
--
-- Regeneradas desde `pg_get_functiondef` con un script, insertando la guarda.
-- Los limites son deliberadamente altos: frenan un script, no a una persona.

CREATE OR REPLACE FUNCTION public.check_store_coupon(p_slug text, p_code text, p_subtotal numeric, p_email text DEFAULT NULL::text, p_shipping numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_c     record;
  v_desc  numeric := 0;
  v_bonif numeric := 0;
  v_usos  int := 0;
BEGIN
  -- ⚠️ Sin límite, esta función es un oráculo: responde si un código existe,
  -- así que se prueban millones hasta encontrar los que dan descuento. 20 por
  -- minuto alcanza de sobra para alguien tipeando y no para un script.
  IF NOT public.rate_limit_publico('cupon', p_slug, 20, interval '1 minute') THEN
    RETURN jsonb_build_object('valid', false,
      'reason', 'Probaste muchos códigos seguidos. Esperá un minuto.');
  END IF;

  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(p_slug) AND s.is_active;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Tienda no encontrada');
  END IF;

  SELECT * INTO v_c FROM public.coupons
   WHERE org_id = v_org AND upper(code) = upper(btrim(p_code))
   LIMIT 1;

  IF v_c.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón no existe');
  END IF;
  IF NOT v_c.active THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón ya no está activo');
  END IF;
  IF v_c.valid_from IS NOT NULL AND v_c.valid_from > now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón todavía no empezó');
  END IF;
  IF v_c.valid_until IS NOT NULL AND v_c.valid_until < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón está vencido');
  END IF;

  -- El mínimo va PRIMERO: es lo único que el comprador puede resolver
  -- agregando productos. Decirle "alcanzaste el límite" a quien además no llega
  -- al mínimo lo manda a un callejón sin salida.
  --
  -- Se mide sobre la mercadería y NO sobre el total con envío: si no, un cupón
  -- de "mínimo $50.000" se activaría con $38.000 de productos más $12.000 de
  -- flete, y el comercio estaría subsidiando el envío para llegar a su piso.
  IF COALESCE(v_c.min_order_value, 0) > 0
     AND COALESCE(p_subtotal, 0) < v_c.min_order_value THEN
    RETURN jsonb_build_object(
      'valid', false,
      -- El separador de miles va con punto. `to_char` usa el del locale de la
      -- base, que devuelve coma: al comprador le llegaba "Te faltan $40,000",
      -- que en Argentina se lee como cuarenta pesos con cero centavos.
      'reason', format('Te faltan $%s para poder usar este cupón',
                       replace(to_char(v_c.min_order_value - COALESCE(p_subtotal, 0),
                                       'FM999G999G999'), ',', '.')),
      'min_order_value', v_c.min_order_value,
      'faltan', v_c.min_order_value - COALESCE(p_subtotal, 0));
  END IF;

  IF v_c.max_uses_per_customer IS NOT NULL AND v_c.max_uses_per_customer > 0 THEN
    -- Sin email no se puede evaluar el límite. Se rechaza en vez de dejar
    -- pasar: un cupón "una vez por persona" sin saber quién es no cumple su
    -- condición, y dejarlo pasar lo vuelve ilimitado en la práctica.
    IF lower(btrim(COALESCE(p_email, ''))) = '' THEN
      RETURN jsonb_build_object('valid', false,
        'reason', 'Ingresá tu email para poder validar este cupón');
    END IF;

    v_usos := public.usos_de_cupon_por_persona(v_c.id, p_email);
    IF v_usos >= v_c.max_uses_per_customer THEN
      RETURN jsonb_build_object('valid', false,
        'reason', 'Ya usaste este cupón el máximo de veces');
    END IF;
  END IF;

  IF v_c.max_uses IS NOT NULL AND COALESCE(v_c.current_uses, 0) >= v_c.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón alcanzó su límite de usos');
  END IF;

  -- ── Cuánto hace el cupón ────────────────────────────────────────────────
  -- Espejo de `calcularEfecto` en src/lib/couponRules.ts.
  IF COALESCE(v_c.discount_percent, 0) > 0 THEN
    v_desc := round(COALESCE(p_subtotal, 0) * v_c.discount_percent / 100.0);
  ELSIF COALESCE(v_c.discount_fixed_ars, 0) > 0 THEN
    v_desc := LEAST(v_c.discount_fixed_ars, COALESCE(p_subtotal, 0));
  END IF;

  IF v_c.free_shipping AND COALESCE(p_shipping, 0) > 0 THEN
    v_bonif := LEAST(p_shipping, COALESCE(v_c.free_shipping_max_ars, p_shipping));
  END IF;

  -- Un cupón sin porcentaje ni monto fijo y sin envío gratis no descuenta
  -- nada: está mal cargado.
  IF v_desc <= 0 AND NOT v_c.free_shipping THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón no aplica a este pedido');
  END IF;

  -- Envío gratis sobre un pedido cuyo envío ya vale cero —retiro en tienda, o
  -- el umbral de la tienda ya alcanzado—. Aceptarlo lo consumiría a cambio de
  -- nada. Sólo se decide cuando el envío ya se cotizó: con `p_shipping` NULL
  -- todavía no se sabe y no se bloquea.
  IF v_desc <= 0 AND v_c.free_shipping
     AND p_shipping IS NOT NULL AND v_bonif <= 0 THEN
    RETURN jsonb_build_object('valid', false, 'reason',
      'Este cupón bonifica el envío y tu pedido no tiene costo de envío');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', upper(v_c.code),
    'discount', v_desc,
    'free_shipping', v_c.free_shipping,
    'shipping_discount', v_bonif,
    'free_shipping_max', v_c.free_shipping_max_ars,
    'min_order_value', v_c.min_order_value);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_store_order_idem(p_slug text, p_items jsonb, p_customer_name text, p_customer_email text, p_customer_phone text DEFAULT NULL::text, p_shipping jsonb DEFAULT NULL::jsonb, p_payment_method text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_coupon text DEFAULT NULL::text, p_shipping_option text DEFAULT NULL::text, p_fiscal jsonb DEFAULT NULL::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org       uuid;
  v_reserva   jsonb;
  v_resultado jsonb;
  v_payload   jsonb;
BEGIN
  -- La organización la resuelve el servidor desde el slug. Nunca la manda el
  -- navegador: si no, cualquiera podría reservar claves en la organización
  -- ajena y dejarle el checkout bloqueado.
  SELECT s.org_id INTO v_org
    FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(p_slug) AND s.is_active
   LIMIT 1;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva';
  END IF;

  -- ⚠️ **Denegación de inventario.** Crear una orden reserva stock sin pagar
  -- nada (A2). Mil llamadas dejan la tienda con disponible en cero, sin una
  -- sola orden pagada y sin que el atacante gaste un peso. Cada pieza por
  -- separado es correcta: reservar antes de cobrar es lo que evita vender dos
  -- veces la última unidad. Lo que faltaba era el límite.
  --
  -- 10 por minuto: nadie compra diez veces en un minuto de verdad, y un
  -- script se frena en seco.
  IF NOT public.rate_limit_publico('checkout', p_slug, 10, interval '1 minute') THEN
    RAISE EXCEPTION 'Demasiados intentos de compra seguidos. Esperá un minuto.'
      USING ERRCODE = '53400';
  END IF;

  -- El hash se arma con lo que define la compra. Si cambia el carrito, el
  -- email o el envío, es otra compra aunque reusen la clave.
  v_payload := jsonb_build_object(
    'items', p_items, 'email', lower(btrim(COALESCE(p_customer_email, ''))),
    'shipping', p_shipping, 'coupon', p_coupon,
    'shipping_option', p_shipping_option, 'payment_method', p_payment_method);

  v_reserva := public.idempotencia_reservar(
    v_org, 'create_store_order', p_idempotency_key, v_payload);

  -- Ya se había creado: se devuelve la misma orden, no una nueva.
  IF NOT (v_reserva->>'ejecutar')::boolean THEN
    RETURN (v_reserva->'respuesta') || jsonb_build_object('reintento', true);
  END IF;

  BEGIN
    v_resultado := public.create_store_order(
      p_slug, p_items, p_customer_name, p_customer_email, p_customer_phone,
      p_shipping, p_payment_method, p_notes, p_coupon, p_shipping_option,
      p_fiscal);
  EXCEPTION WHEN OTHERS THEN
    -- Sin esto la clave queda en `en_curso` para siempre y el comprador no
    -- puede reintentar nunca más — que es peor que el problema original.
    PERFORM public.idempotencia_fallar(
      v_org, 'create_store_order', p_idempotency_key, SQLERRM);
    RAISE;
  END;

  PERFORM public.idempotencia_completar(
    v_org, 'create_store_order', p_idempotency_key, v_resultado);

  RETURN v_resultado;
END;
$function$
;
