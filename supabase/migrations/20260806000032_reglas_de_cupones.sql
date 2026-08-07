-- ═══════════════════════════════════════════════════════════════════════════
-- A4 — Los cupones vuelven a tener condiciones
--
-- `coupons` tenía `max_uses` global y `current_uses`, y nada más.
-- `check_store_coupon` validaba existencia, vigencia y el tope global. Faltaban
-- las dos condiciones que hacen que un cupón sea una herramienta y no una
-- pérdida:
--
-- **Sin mínimo de compra**, un cupón de $10.000 fijo se usa en una compra de
-- $12.000: el comercio regala el 83% de la venta.
--
-- **Sin límite por persona**, una sola persona consume los veinte usos del tope
-- global. El cupón que era para captar veinte clientes captó uno.
--
-- ── Contra qué se mide el mínimo ─────────────────────────────────────────
--
-- Contra la **mercadería**, no contra el total. Midiéndolo contra el total con
-- envío, un cupón de "mínimo $50.000" se activaría con $38.000 de productos más
-- $12.000 de flete, y el comercio estaría subsidiando el envío para llegar a su
-- propio piso. `check_store_coupon` ya recibe el subtotal de mercadería.
--
-- ── Quién es "la misma persona" ──────────────────────────────────────────
--
-- El email normalizado, que es lo único que tiene un comprador sin cuenta, y el
-- mismo criterio con el que el CRM cruza filas sin `customer_id`. No es
-- infalible —se puede usar otro email— pero frena el caso real: la misma
-- persona usando el mismo cupón cinco veces seguidas.
--
-- ── Por qué hace falta una tabla y no alcanza un contador ────────────────
--
-- `current_uses` dice cuántas veces se usó, no **quién** lo usó. Para el límite
-- por persona hay que llevar el registro. `coupon_usages` es ese libro; el
-- contador se conserva porque `create_store_order` lo mantiene y hay pantallas
-- que lo leen, y queda una vista de control por si los dos se separan.
--
-- Espejo de `src/lib/couponRules.ts`, con 18 tests.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS min_order_value numeric,
  ADD COLUMN IF NOT EXISTS max_uses_per_customer integer;

COMMENT ON COLUMN public.coupons.min_order_value IS
  'Compra mínima de MERCADERÍA para poder usar el cupón. Se mide sobre el subtotal de productos, no sobre el total con envío: si no, el comercio termina subsidiando el flete para que el comprador llegue a su propio piso.';

COMMENT ON COLUMN public.coupons.max_uses_per_customer IS
  'Cuántas veces puede usarlo la misma persona, identificada por email normalizado. NULL = sin límite. Sin esto, uno solo consume el tope global.';

-- ── El libro de usos ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coupon_usages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  coupon_id   uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  order_id    uuid REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL,
  /** Email normalizado: minúsculas y sin espacios. Es la identidad del comprador. */
  customer_email text,
  /** Cuando el comprador tiene cuenta, manda el id sobre el email. */
  store_customer_id uuid REFERENCES public.store_customers(id) ON DELETE SET NULL,
  discount_ars numeric NOT NULL DEFAULT 0,
  used_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupon_usages_persona
  ON public.coupon_usages(coupon_id, customer_email);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_org
  ON public.coupon_usages(org_id, used_at DESC);

COMMENT ON TABLE public.coupon_usages IS
  'Quién usó cada cupón. `coupons.current_uses` dice cuántas veces; esto dice quién, que es lo que hace falta para el límite por persona.';

ALTER TABLE public.coupon_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coupon_usages_read ON public.coupon_usages;
CREATE POLICY coupon_usages_read ON public.coupon_usages
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

GRANT SELECT ON public.coupon_usages TO authenticated;

-- ── Cuántas veces lo usó esta persona ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.usos_de_cupon_por_persona(
  p_coupon_id uuid,
  p_email     text
) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(count(*), 0)::int
  FROM public.coupon_usages u
  WHERE u.coupon_id = p_coupon_id
    AND u.customer_email IS NOT NULL
    AND u.customer_email = lower(btrim(COALESCE(p_email, '')))
    AND lower(btrim(COALESCE(p_email, ''))) <> '';
$$;

COMMENT ON FUNCTION public.usos_de_cupon_por_persona IS
  'Usos previos de un cupón por email normalizado. No se tocan puntos ni el signo más: fusionarlos juntaría cuentas de personas distintas, que es peor que dejar pasar un uso de más.';

-- ── Validar, ahora con las dos condiciones ───────────────────────────────
--
-- Se agrega `p_email` al final para no romper a quien la llame con tres
-- argumentos: el checkout viejo sigue funcionando, sólo que sin poder evaluar
-- el límite por persona. Agregar al final es lo que permite desplegar la base
-- antes que el front sin romper nada.
-- ⚠️ DROP de la firma vieja antes del CREATE. Agregar un parámetro **no**
-- reemplaza la función: crea una sobrecarga, y quedan las dos. Con las dos
-- vivas, `COMMENT ON FUNCTION` falla por ambigua y —peor— una llamada de tres
-- argumentos podría seguir cayendo en la versión sin las validaciones nuevas.
-- Es la misma trampa que ya apareció con `record_stock_movement`.
--
-- Los llamadores de tres argumentos siguen funcionando: el cuarto tiene default.
DROP FUNCTION IF EXISTS public.check_store_coupon(text, text, numeric);

CREATE OR REPLACE FUNCTION public.check_store_coupon(
  p_slug     text,
  p_code     text,
  p_subtotal numeric,
  p_email    text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org   uuid;
  v_c     record;
  v_desc  numeric := 0;
  v_usos  int := 0;
BEGIN
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
  IF COALESCE(v_c.min_order_value, 0) > 0
     AND COALESCE(p_subtotal, 0) < v_c.min_order_value THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', format('Te faltan $%s para poder usar este cupón',
                       to_char(v_c.min_order_value - COALESCE(p_subtotal, 0), 'FM999G999G999')),
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

  IF COALESCE(v_c.discount_percent, 0) > 0 THEN
    v_desc := round(COALESCE(p_subtotal, 0) * v_c.discount_percent / 100.0);
  ELSIF COALESCE(v_c.discount_fixed_ars, 0) > 0 THEN
    v_desc := LEAST(v_c.discount_fixed_ars, COALESCE(p_subtotal, 0));
  END IF;

  IF v_desc <= 0 THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón no aplica a este pedido');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', upper(v_c.code),
    'discount', v_desc,
    'min_order_value', v_c.min_order_value);
END;
$$;

COMMENT ON FUNCTION public.check_store_coupon IS
  'Valida un cupón contra vigencia, mínimo de compra, límite por persona y tope global. El mínimo se informa primero porque es lo único que el comprador puede resolver.';

REVOKE ALL ON FUNCTION public.check_store_coupon(text, text, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.check_store_coupon(text, text, numeric, text) TO anon, authenticated;

-- ── Registrar el uso al crear la orden ───────────────────────────────────
--
-- Trigger y no parche a `create_store_order`, que la está editando la otra PC.
-- Además cubre cualquier camino futuro que cree una orden con cupón.
--
-- ⚠️ **No toca `current_uses`.** Ese contador lo incrementa
-- `create_store_order`; sumarlo también acá lo duplicaría — el mismo error que
-- este repo cometió con el stock tres veces.
CREATE OR REPLACE FUNCTION public.trg_registrar_uso_de_cupon()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid uuid;
BEGIN
  IF NEW.coupon_code IS NULL OR btrim(NEW.coupon_code) = '' THEN RETURN NEW; END IF;

  SELECT c.id INTO v_cid FROM public.coupons c
   WHERE c.org_id = NEW.org_id AND upper(c.code) = upper(btrim(NEW.coupon_code))
   LIMIT 1;

  IF v_cid IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.coupon_usages (
    org_id, coupon_id, order_id, customer_email, store_customer_id, discount_ars
  ) VALUES (
    NEW.org_id, v_cid, NEW.id,
    NULLIF(lower(btrim(COALESCE(NEW.customer_email, ''))), ''),
    NEW.store_customer_id,
    COALESCE(NEW.discount_amount, 0)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrar_uso_de_cupon ON public.ecommerce_orders;
CREATE TRIGGER trg_registrar_uso_de_cupon
AFTER INSERT ON public.ecommerce_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_registrar_uso_de_cupon();

COMMENT ON FUNCTION public.trg_registrar_uso_de_cupon IS
  'Deja constancia de quién usó cada cupón. NO toca current_uses: ese contador lo mantiene create_store_order, y sumarlo dos veces es el error clásico de este repo.';

-- ── Control: el contador contra el libro ─────────────────────────────────
CREATE OR REPLACE VIEW public.cupones_descuadrados
WITH (security_invoker = true) AS
SELECT c.org_id, c.id AS coupon_id, c.code,
       COALESCE(c.current_uses, 0) AS contador,
       (SELECT count(*) FROM public.coupon_usages u WHERE u.coupon_id = c.id) AS registrados,
       COALESCE(c.current_uses, 0)
         - (SELECT count(*) FROM public.coupon_usages u WHERE u.coupon_id = c.id) AS diferencia
FROM public.coupons c
WHERE COALESCE(c.current_uses, 0)
      <> (SELECT count(*) FROM public.coupon_usages u WHERE u.coupon_id = c.id);

COMMENT ON VIEW public.cupones_descuadrados IS
  'Cupones donde el contador no coincide con el libro de usos. Las diferencias anteriores a esta migración son esperables —el libro arranca vacío—; las nuevas significan que un camino registra y el otro no.';

GRANT SELECT ON public.cupones_descuadrados TO authenticated;
