-- ═══════════════════════════════════════════════════════════════════════════
-- Caja cobra el descuento configurado para el medio de pago
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La pantalla cargaba `discount_cash_percent`, `discount_transfer_percent`,
-- `discount_debit_percent` y `discount_credit_percent`, pero no usaba ninguno.
-- En su lugar un booleano fijo decidía si efectivo/transferencia/mayorista
-- podían usar `products.discount_price_ars`. Eso mezclaba oferta de producto
-- con incentivo de cobro y hacía que Ajustes no cambiara el ticket.
--
-- Esta migración vuelve autoritativa la regla:
--   · la oferta/promoción vigente aplica a cualquier medio;
--   · el porcentaje del medio se calcula contra lista;
--   · gana el menor entre oferta y descuento del medio (no se acumulan);
--   · el split conserva ofertas, pero no combina porcentajes de dos medios;
--   · un cliente viejo no puede borrar un descuento prometido enviando un
--     precio mayor; un descuento manual hacia abajo sigue permitido y auditado.
--
-- `src/lib/posPaymentDiscount.ts` es el espejo de presentación. Si se cambia
-- una cuenta se cambian ambos lados.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_discount_ars numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_payment_discount_percent_chk;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_payment_discount_percent_chk
  CHECK (payment_discount_percent BETWEEN 0 AND 90);

COMMENT ON COLUMN public.sales.payment_discount_percent IS
  'Porcentaje automático del medio de pago aplicado por la base al ticket POS. En split es 0 para evitar una ponderación circular.';
COMMENT ON COLUMN public.sales.payment_discount_ars IS
  'Ahorro de esta línea por el medio de pago frente a la mejor oferta/promoción previa. Snapshot histórico en ARS.';

CREATE OR REPLACE FUNCTION public.pos_payment_discount_pct(
  p_org_id uuid,
  p_method text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_settings public.settings%ROWTYPE;
  v_pct numeric := 0;
  v_method text := lower(btrim(COALESCE(p_method, '')));
BEGIN
  SELECT * INTO v_settings
  FROM public.settings settings
  WHERE settings.org_id = p_org_id
  LIMIT 1;

  v_pct := CASE v_method
    WHEN 'efectivo'      THEN v_settings.discount_cash_percent
    WHEN 'cash'          THEN v_settings.discount_cash_percent
    WHEN 'transferencia' THEN v_settings.discount_transfer_percent
    WHEN 'transfer'      THEN v_settings.discount_transfer_percent
    WHEN 'deposito'      THEN v_settings.discount_transfer_percent
    WHEN 'debito'        THEN v_settings.discount_debit_percent
    WHEN 'debit'         THEN v_settings.discount_debit_percent
    WHEN 'credito'       THEN v_settings.discount_credit_percent
    WHEN 'credit'        THEN v_settings.discount_credit_percent
    ELSE 0
  END;

  IF v_pct IS NULL OR v_pct::text IN ('NaN', 'Infinity', '-Infinity') OR v_pct <= 0 THEN
    RETURN 0;
  END IF;
  RETURN LEAST(v_pct, 90);
END;
$function$;

COMMENT ON FUNCTION public.pos_payment_discount_pct(uuid, text) IS
  'Autoridad del porcentaje de descuento POS por medio. Lee settings del tenant, normaliza aliases y falla cerrado en 0.';

REVOKE ALL ON FUNCTION public.pos_payment_discount_pct(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- Se regenera desde la última definición vigente (20260822000007). Conserva
-- autoridad de costo, impacto de precios, ticket atómico e idempotencia; sólo
-- intercala la regla del medio antes del override explícito del cajero.
CREATE OR REPLACE FUNCTION public.create_sales_transaction_v2(
  p_org_id uuid,
  p_sales jsonb,
  p_source text DEFAULT 'pos'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid())
     OR NOT public.has_permission(p_org_id, 'sales', 'create') THEN
    RAISE EXCEPTION 'No tenes permiso para registrar ventas en esta organizacion'
      USING ERRCODE = '42501';
  END IF;

  FOR v_linea IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_sales, '[]'::jsonb))
  LOOP
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
        -- Compatibilidad con una pestaña/deploy viejo: el servidor respeta el
        -- descuento configurado aunque el navegador todavía mande lista.
        v_stale_prices_ignored := v_stale_prices_ignored + 1;
        v_linea := v_linea || jsonb_build_object(
          'unit_price_ars', v_precio,
          'precio_autoritativo', v_precio,
          'override_de_precio', false,
          'client_price_ignored', true
        );
      ELSE
        -- El cajero puede otorgar un descuento adicional hacia abajo. Como
        -- antes, queda comparado contra el baseline autoritativo.
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

  RETURN public.create_sales_transaction(p_org_id, v_salida, p_source)
    || jsonb_build_object(
      'overrides_de_precio', v_overrides,
      'lineas_con_descuento_medio', v_method_discounts,
      'precios_viejos_ignorados', v_stale_prices_ignored
    );
END;
$function$;

COMMENT ON FUNCTION public.create_sales_transaction_v2(uuid, jsonb, text) IS
  'Venta POS con precio/costo server-side y descuento por medio desde settings. Oferta y medio compiten; split no mezcla porcentajes; un cliente viejo no puede borrar el descuento.';

REVOKE ALL ON FUNCTION public.create_sales_transaction_v2(uuid, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_transaction_v2(uuid, jsonb, text)
  TO authenticated;

-- Prueba pura del contrato, sin tocar datos de un comercio.
DO $verify$
DECLARE
  v_org uuid := gen_random_uuid();
  v_user uuid;
  v_pct numeric;
  v_restos integer;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'Verificacion descuento POS omitida: no hay usuario auth';
    RETURN;
  END IF;

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ descuento POS', 'zz-pos-discount-' || substr(v_org::text, 1, 8), v_user);
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org, v_user, 'owner');
  UPDATE public.settings
  SET discount_cash_percent = 10,
      discount_transfer_percent = 15,
      discount_debit_percent = 2.5,
      discount_credit_percent = 0
  WHERE org_id = v_org;

  v_pct := public.pos_payment_discount_pct(v_org, 'efectivo');
  ASSERT v_pct = 10, 'efectivo no leyo el 10% configurado';
  ASSERT public.pos_payment_discount_pct(v_org, 'transfer') = 15,
    'el alias transfer no leyo transferencia';
  ASSERT public.pos_payment_discount_pct(v_org, 'qr') = 0,
    'QR invento un descuento que no tiene configuracion';

  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_restos
  FROM public.organizations WHERE id = v_org;
  ASSERT v_restos = 0, 'quedaron restos ZZ del descuento POS';

  RAISE NOTICE 'OK: descuento POS lee settings, aliases y QR sin inventar';
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829000040', 'pos_payment_method_discounts')
ON CONFLICT DO NOTHING;
