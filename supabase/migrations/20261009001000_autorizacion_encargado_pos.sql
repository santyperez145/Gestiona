-- Autorización del encargado para descuentos manuales en el POS.
--
-- Hasta acá cualquier miembro con permiso de venta podía bajar un precio sin
-- límite. El comercio define `settings.pos_descuento_max_pct`; un descuento
-- manual mayor (frente al precio autoritativo) exige una autorización que un
-- dueño/admin emite con su PIN en la caja. La autorización es del cajero que
-- la pidió, vence a los 10 minutos y tiene tope de porcentaje. La venta guarda
-- quién la autorizó en `sales.price_override_approved_by`.
-- NULL en el máximo conserva el comportamiento anterior. Dueños y admins no
-- necesitan autorización. `create_sales_transaction_v2` es copia de la versión
-- vigente (base vinculada, 2026-10-09) con este control agregado.

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pos_descuento_max_pct numeric(5,2);
ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_pos_descuento_max_pct_rango;
ALTER TABLE public.settings ADD CONSTRAINT settings_pos_descuento_max_pct_rango
  CHECK (pos_descuento_max_pct IS NULL OR pos_descuento_max_pct BETWEEN 0 AND 100);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS price_override_approved_by uuid;

CREATE TABLE IF NOT EXISTS public.pos_supervisor_pins (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  pin_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
ALTER TABLE public.pos_supervisor_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_supervisor_pins FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.pos_autorizaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL,
  cashier_id uuid NOT NULL,
  max_descuento_pct numeric(5,2) NOT NULL CHECK (max_descuento_pct > 0 AND max_descuento_pct <= 100),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_autorizaciones_org_idx ON public.pos_autorizaciones (org_id, created_at DESC);
ALTER TABLE public.pos_autorizaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_autorizaciones FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS pos_autorizaciones_read ON public.pos_autorizaciones;
CREATE POLICY pos_autorizaciones_read ON public.pos_autorizaciones FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin']));
GRANT SELECT ON public.pos_autorizaciones TO authenticated;

CREATE TABLE IF NOT EXISTS public.pos_pin_intentos (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL,
  cashier_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_pin_intentos_idx ON public.pos_pin_intentos (org_id, cashier_id, created_at DESC);
ALTER TABLE public.pos_pin_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_pin_intentos FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.definir_pin_supervisor(p_org uuid, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo dueños y administradores autorizan descuentos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' OR p_pin ~ '^(\d)\1+$' THEN
    RAISE EXCEPTION 'El PIN debe tener de 4 a 8 dígitos y no repetir el mismo número';
  END IF;
  INSERT INTO public.pos_supervisor_pins (org_id, user_id, pin_hash, updated_at)
  VALUES (p_org, auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), now())
  ON CONFLICT (org_id, user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.configurar_descuento_maximo_pos(p_org uuid, p_max_pct numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo dueños y administradores configuran el descuento máximo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_max_pct IS NOT NULL AND (p_max_pct < 0 OR p_max_pct > 100) THEN
    RAISE EXCEPTION 'El descuento máximo debe estar entre 0 y 100 %%';
  END IF;
  UPDATE public.settings SET pos_descuento_max_pct = p_max_pct WHERE org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'La organización no tiene configuración'; END IF;
  RETURN jsonb_build_object('ok', true, 'pos_descuento_max_pct', p_max_pct);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.autorizar_descuento_pos(p_org uuid, p_pin text, p_max_pct numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_approver uuid;
  v_id uuid;
  v_name text;
BEGIN
  IF v_user IS NULL OR NOT public.is_org_member(p_org, v_user) OR NOT public.has_permission(p_org, 'sales', 'create') THEN
    RAISE EXCEPTION 'No tenés permiso para vender en esta organización' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_max_pct IS NULL OR p_max_pct <= 0 OR p_max_pct > 100 THEN
    RAISE EXCEPTION 'Porcentaje de descuento inválido';
  END IF;
  -- Cinco PIN incorrectos en 15 minutos bloquean nuevos intentos de esta caja.
  IF (SELECT count(*) FROM public.pos_pin_intentos
      WHERE org_id = p_org AND cashier_id = v_user AND created_at > now() - interval '15 minutes') >= 5 THEN
    RAISE EXCEPTION 'Demasiados PIN incorrectos. Esperá 15 minutos.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.user_id INTO v_approver
  FROM public.pos_supervisor_pins p
  JOIN public.memberships m ON m.org_id = p.org_id AND m.user_id = p.user_id AND m.role IN ('owner', 'admin')
  WHERE p.org_id = p_org AND p.pin_hash = extensions.crypt(COALESCE(p_pin, ''), p.pin_hash)
  LIMIT 1;
  IF v_approver IS NULL THEN
    INSERT INTO public.pos_pin_intentos (org_id, cashier_id) VALUES (p_org, v_user);
    RETURN jsonb_build_object('ok', false, 'motivo', 'PIN incorrecto');
  END IF;
  INSERT INTO public.pos_autorizaciones (org_id, approver_id, cashier_id, max_descuento_pct, expires_at)
  VALUES (p_org, v_approver, v_user, round(p_max_pct, 2), now() + interval '10 minutes')
  RETURNING id INTO v_id;
  SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), 'Encargado') INTO v_name FROM public.profiles pr WHERE pr.user_id = v_approver;
  RETURN jsonb_build_object('ok', true, 'autorizacion_id', v_id, 'autorizado_por', COALESCE(v_name, 'Encargado'),
    'max_descuento_pct', round(p_max_pct, 2), 'vence', now() + interval '10 minutes');
END;
$fn$;

REVOKE ALL ON FUNCTION public.definir_pin_supervisor(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configurar_descuento_maximo_pos(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.autorizar_descuento_pos(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_pin_supervisor(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configurar_descuento_maximo_pos(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.autorizar_descuento_pos(uuid, text, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_sales_transaction_v2(p_org_id uuid, p_sales jsonb, p_source text DEFAULT 'pos'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_linea jsonb;
  v_precios jsonb;
  v_salida jsonb := '[]'::jsonb;
  v_qty numeric;
  v_precio numeric;
  v_precio_pre_medio numeric;
  v_precio_lista numeric;
  v_precio_medio numeric;
  v_pedido numeric;
  v_costo_ars numeric;
  v_method text;
  v_split boolean;
  v_payment_pct numeric;
  v_payment_discount_ars numeric;
  v_overrides integer := 0;
  v_method_discounts integer := 0;
  v_stale_prices_ignored integer := 0;
  v_limite numeric;
  v_es_encargado boolean;
  v_descuento_pct numeric;
  v_aprobacion uuid;
  v_aut public.pos_autorizaciones%ROWTYPE;
  v_usadas uuid[] := '{}';
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid())
     OR NOT public.has_permission(p_org_id, 'sales', 'create') THEN
    RAISE EXCEPTION 'No tenes permiso para registrar ventas en esta organizacion'
      USING ERRCODE = '42501';
  END IF;

  -- Descuento manual máximo sin autorización (NULL = sin límite, como antes).
  SELECT s.pos_descuento_max_pct INTO v_limite FROM public.settings s WHERE s.org_id = p_org_id;
  v_es_encargado := public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin']);

  FOR v_linea IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_sales, '[]'::jsonb))
  LOOP
    -- La autorización la completa la base; nunca se acepta del navegador.
    v_aprobacion := NULLIF(v_linea->>'autorizacion_id', '')::uuid;
    v_linea := v_linea - 'autorizacion_id' - 'price_override_approved_by';
    v_qty := GREATEST(COALESCE((v_linea->>'quantity')::numeric, 0), 0);
    v_precios := public.precio_pos_autoritativo(
      p_org_id,
      NULLIF(v_linea->>'product_id', '')::uuid,
      NULLIF(v_linea->>'variant_id', '')::uuid,
      v_qty
    );

    v_precio := (v_precios->>'precio_vigente')::numeric;
    v_precio_pre_medio := v_precio;
    v_precio_lista := (v_precios->>'precio_lista')::numeric;
    v_costo_ars := (v_precios->>'costo_ars')::numeric * v_qty;
    v_method := lower(btrim(COALESCE(v_linea->>'payment_method', 'efectivo')));
    v_split := jsonb_typeof(v_linea->'split_payments') = 'array'
      AND jsonb_array_length(v_linea->'split_payments') > 0;
    v_payment_pct := CASE
      WHEN v_split THEN 0
      ELSE public.pos_payment_discount_pct(p_org_id, v_method)
    END;

    IF v_payment_pct > 0 AND v_precio_lista > 0 THEN
      v_precio_medio := public.redondear_moneda(
        v_precio_lista * (100 - v_payment_pct) / 100.0,
        'ARS'
      );
      v_precio := LEAST(v_precio, v_precio_medio);
    END IF;

    v_payment_discount_ars := public.redondear_moneda(
      GREATEST(0, v_precio_pre_medio - v_precio) * v_qty,
      'ARS'
    );
    IF v_payment_discount_ars > 0 THEN
      v_method_discounts := v_method_discounts + 1;
    END IF;

    v_pedido := NULLIF(v_linea->>'unit_price_ars', '')::numeric;

    IF v_pedido IS NOT NULL AND abs(v_pedido - v_precio) > 0.01 THEN
      IF v_payment_pct > 0 AND v_pedido > v_precio THEN
        -- Compatibilidad con una pestaÃ±a/deploy viejo: el servidor respeta el
        -- descuento configurado aunque el navegador todavÃ­a mande lista.
        v_stale_prices_ignored := v_stale_prices_ignored + 1;
        v_linea := v_linea || jsonb_build_object(
          'unit_price_ars', v_precio,
          'precio_autoritativo', v_precio,
          'override_de_precio', false,
          'client_price_ignored', true
        );
      ELSE
        -- El cajero puede otorgar un descuento adicional hacia abajo. Como
        -- antes, queda comparado contra el baseline autoritativo. Arriba del
        -- máximo del comercio necesita la autorización de un encargado.
        IF v_pedido < v_precio AND v_precio > 0 AND v_limite IS NOT NULL AND NOT v_es_encargado THEN
          v_descuento_pct := round((v_precio - v_pedido) / v_precio * 100, 2);
          IF v_descuento_pct > v_limite + 0.01 THEN
            SELECT * INTO v_aut FROM public.pos_autorizaciones a
            WHERE a.id = v_aprobacion AND a.org_id = p_org_id AND a.cashier_id = auth.uid()
              AND a.expires_at > now() AND a.max_descuento_pct + 0.01 >= v_descuento_pct;
            IF NOT FOUND THEN
              RAISE EXCEPTION 'El descuento de % %% en «%» supera el máximo de % %%. Pedí la autorización del encargado.',
                v_descuento_pct, v_linea->>'product_name', v_limite
                USING ERRCODE = '42501';
            END IF;
            v_linea := v_linea || jsonb_build_object('price_override_approved_by', v_aut.approver_id);
            v_usadas := array_append(v_usadas, v_aut.id);
          END IF;
        END IF;
        v_overrides := v_overrides + 1;
        v_linea := v_linea || jsonb_build_object(
          'unit_price_ars', v_pedido,
          'precio_autoritativo', v_precio,
          'override_de_precio', true
        );
        v_precio := v_pedido;
      END IF;
    ELSE
      v_linea := v_linea || jsonb_build_object(
        'unit_price_ars', v_precio,
        'precio_autoritativo', v_precio,
        'override_de_precio', false
      );
    END IF;

    v_linea := v_linea || jsonb_build_object(
      'payment_discount_percent', v_payment_pct,
      'payment_discount_ars', v_payment_discount_ars,
      'discount_applied',
        COALESCE(v_linea->>'discount_applied', 'false')::boolean
        OR v_payment_discount_ars > 0
        OR COALESCE((v_linea->>'override_de_precio')::boolean, false),
      'total_ars', public.redondear_moneda(v_precio * v_qty, 'ARS'),
      'cost_per_unit_usd', (v_precios->>'costo_usd')::numeric,
      'cost_of_goods_ars', public.redondear_moneda(v_costo_ars, 'ARS'),
      'profit_ars', public.redondear_moneda(v_precio * v_qty - v_costo_ars, 'ARS')
    );

    IF COALESCE((v_precios->>'tipo_cambio')::numeric, 0) > 0 THEN
      v_linea := v_linea || jsonb_build_object(
        'profit_usd', round(
          (v_precio * v_qty - v_costo_ars) / (v_precios->>'tipo_cambio')::numeric,
          2
        )
      );
    ELSE
      v_linea := v_linea || jsonb_build_object('profit_usd', 0);
    END IF;

    v_salida := v_salida || jsonb_build_array(v_linea);
  END LOOP;

  IF cardinality(v_usadas) > 0 THEN
    UPDATE public.pos_autorizaciones SET used_at = COALESCE(used_at, now()) WHERE id = ANY(v_usadas);
  END IF;

  RETURN public.create_sales_transaction(p_org_id, v_salida, p_source)
    || jsonb_build_object(
      'overrides_de_precio', v_overrides,
      'lineas_con_descuento_medio', v_method_discounts,
      'precios_viejos_ignorados', v_stale_prices_ignored
    );
END;
$function$;
