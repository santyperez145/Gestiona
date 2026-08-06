-- ═══════════════════════════════════════════════════════════════════════════
-- Conteo de inventario: contar lo que hay y corregir lo que el sistema cree
--
-- Es el pendiente más viejo del proyecto y el único que no se arregla
-- programando: durante meses cada venta descontó el doble y cada compra sumó el
-- doble. Los números se venían corrigiendo a mano desde la pantalla —que no deja
-- asiento— así que **el stock de la base no es confiable**. Hay 15 productos
-- donde el Kardex no coincide con el stock actual, varios con el Kardex en
-- negativo y el stock positivo.
--
-- Hasta ahora la única forma de corregir era editar el número del producto: sin
-- rastro de quién, cuándo, ni contra qué. Esto lo reemplaza por un conteo con
-- asiento.
--
-- ── Las tres decisiones que evitan que el conteo mienta ───────────────────
--
-- **1. Lo esperado se congela al abrir.** Si se comparara contra el stock vivo,
-- una venta ocurrida mientras se cuenta aparecería como diferencia de conteo, y
-- no lo es. Congelarlo es lo que hace que la varianza signifique algo: "cuánto
-- nos habíamos desviado", no "cuánto se movió mientras contábamos".
--
-- **2. El ajuste se aplica contra el stock del momento de cerrar, no contra lo
-- congelado.** Entre abrir y cerrar puede haber ventas legítimas, y descontarlas
-- dos veces sería repetir el bug que originó todo esto. Por eso se guarda
-- `stock_al_cerrar`: el asiento dice exactamente contra qué se ajustó.
--
-- **3. El ajuste pasa por `record_stock_movement`.** No se escribe
-- `products.stock` ni `location_stock` a mano — es la regla que este repo
-- aprendió rompiéndola tres veces. El movimiento queda en el Kardex con su
-- tipo, así que un conteo es auditable como cualquier otro movimiento.
--
-- ── Lo que NO hace ────────────────────────────────────────────────────────
--
-- No bloquea la venta mientras se cuenta. Un comercio chico no puede cerrar el
-- local para contar, y un conteo que obliga a parar es un conteo que no se hace.
-- La contrapartida está documentada: contar y cerrar en la misma jornada.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.stock_counts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  /** Null = se cuenta el stock de toda la organización, sin abrir por sucursal. */
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'abierto'
              CHECK (status IN ('abierto', 'cerrado', 'cancelado')),
  notes       text,
  opened_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_stock_counts_org
  ON public.stock_counts(org_id, opened_at DESC);

COMMENT ON TABLE public.stock_counts IS
  'Sesión de conteo físico. Un conteo abierto no bloquea la venta: se cuenta con el local funcionando y el ajuste se aplica al cerrar.';

CREATE TABLE IF NOT EXISTS public.stock_count_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id    uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  /** Lo que el sistema creía tener al ABRIR. Congelado a propósito. */
  expected    numeric NOT NULL DEFAULT 0,
  /** Lo que se contó. Null = todavía no se contó ese producto. */
  counted     numeric,
  counted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  counted_at  timestamptz,
  /** Contra qué se ajustó realmente, al cerrar. Null hasta entonces. */
  stock_al_cerrar numeric,
  ajuste      numeric,
  UNIQUE (count_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_count_items_count
  ON public.stock_count_items(count_id);

COMMENT ON COLUMN public.stock_count_items.expected IS
  'Stock al momento de abrir el conteo, congelado. La varianza contra esto dice cuánto nos habíamos desviado; comparar contra el stock vivo mostraría como diferencia las ventas ocurridas mientras se contaba.';

COMMENT ON COLUMN public.stock_count_items.stock_al_cerrar IS
  'Stock real en el instante del cierre. El ajuste se calcula contra esto, no contra `expected`: entre abrir y cerrar puede haber ventas legítimas y descontarlas de nuevo repetiría el bug del doble descuento.';

ALTER TABLE public.stock_counts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;

-- Sólo lectura desde la UI: se escriben por los RPC, que validan y dejan asiento.
DROP POLICY IF EXISTS stock_counts_read ON public.stock_counts;
CREATE POLICY stock_counts_read ON public.stock_counts
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS stock_count_items_read ON public.stock_count_items;
CREATE POLICY stock_count_items_read ON public.stock_count_items
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

GRANT SELECT ON public.stock_counts      TO authenticated;
GRANT SELECT ON public.stock_count_items TO authenticated;

-- ── Abrir ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.abrir_conteo(
  p_org_id      uuid,
  p_location_id uuid DEFAULT NULL,
  p_notes       text DEFAULT NULL,
  p_solo_con_stock boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_id    uuid;
  v_items int;
BEGIN
  IF NOT public.is_org_member(p_org_id, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l WHERE l.id = p_location_id AND l.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Dos conteos abiertos a la vez sobre el mismo alcance se pisan al cerrar: el
  -- segundo ajustaría contra un stock que el primero ya movió.
  IF EXISTS (
    SELECT 1 FROM public.stock_counts c
    WHERE c.org_id = p_org_id AND c.status = 'abierto'
      AND c.location_id IS NOT DISTINCT FROM p_location_id
  ) THEN
    RAISE EXCEPTION 'Ya hay un conteo abierto para ese alcance. Cerralo o cancelalo primero.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.stock_counts (org_id, location_id, notes, opened_by)
  VALUES (p_org_id, p_location_id, p_notes, v_user)
  RETURNING id INTO v_id;

  -- La foto de lo esperado. Con sucursal se cuenta el stock de esa sucursal;
  -- sin sucursal, el total de la organización.
  INSERT INTO public.stock_count_items (count_id, org_id, product_id, expected)
  SELECT v_id, p_org_id, p.id,
         CASE WHEN p_location_id IS NULL THEN COALESCE(p.stock, 0)
              ELSE COALESCE((SELECT ls.stock FROM public.location_stock ls
                              WHERE ls.location_id = p_location_id AND ls.product_id = p.id), 0)
         END
  FROM public.products p
  WHERE p.org_id = p_org_id
    AND (NOT p_solo_con_stock OR COALESCE(p.stock, 0) <> 0);

  GET DIAGNOSTICS v_items = ROW_COUNT;

  RETURN jsonb_build_object('conteo_id', v_id, 'productos', v_items);
END;
$$;

COMMENT ON FUNCTION public.abrir_conteo IS
  'Abre un conteo y congela lo esperado. Rechaza un segundo conteo abierto sobre el mismo alcance: dos cierres se pisarían.';

-- ── Contar un producto ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_conteo(
  p_count_id   uuid,
  p_product_id uuid,
  p_cantidad   numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_estado text; v_user uuid := auth.uid(); v_esperado numeric;
BEGIN
  SELECT c.org_id, c.status INTO v_org, v_estado
    FROM public.stock_counts c WHERE c.id = p_count_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El conteo no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre este conteo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_estado <> 'abierto' THEN
    RAISE EXCEPTION 'El conteo ya está %', v_estado USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad < 0 THEN
    RAISE EXCEPTION 'La cantidad contada no puede ser negativa'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.stock_count_items
     SET counted = p_cantidad, counted_by = v_user, counted_at = now()
   WHERE count_id = p_count_id AND product_id = p_product_id
  RETURNING expected INTO v_esperado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese producto no está en el conteo' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object(
    'esperado', v_esperado,
    'contado', p_cantidad,
    'diferencia', p_cantidad - v_esperado
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_conteo(uuid, uuid, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.registrar_conteo(uuid, uuid, numeric) TO authenticated;

-- ── Cerrar y ajustar ──────────────────────────────────────────────────────
--
-- Sólo se ajusta lo que se contó. Un producto sin contar **no** se pone en cero:
-- "no lo conté" y "conté cero" son cosas distintas, y confundirlas borraría el
-- stock de todo lo que no se llegó a revisar.
CREATE OR REPLACE FUNCTION public.cerrar_conteo(p_count_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_loc uuid; v_estado text; v_user uuid := auth.uid();
  r record;
  v_actual numeric;
  v_ajuste numeric;
  v_ajustados int := 0;
  v_sin_contar int;
  v_unidades numeric := 0;
BEGIN
  SELECT c.org_id, c.location_id, c.status INTO v_org, v_loc, v_estado
    FROM public.stock_counts c WHERE c.id = p_count_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El conteo no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre este conteo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_estado <> 'abierto' THEN
    RAISE EXCEPTION 'El conteo ya está %', v_estado USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN
    SELECT i.id, i.product_id, i.counted, i.expected, p.name
    FROM public.stock_count_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.count_id = p_count_id AND i.counted IS NOT NULL
  LOOP
    -- Contra el stock del momento del cierre, no contra lo congelado: las
    -- ventas ocurridas mientras se contaba son reales y ya se descontaron.
    IF v_loc IS NULL THEN
      SELECT COALESCE(p.stock, 0) INTO v_actual FROM public.products p WHERE p.id = r.product_id;
    ELSE
      SELECT COALESCE(ls.stock, 0) INTO v_actual FROM public.location_stock ls
       WHERE ls.location_id = v_loc AND ls.product_id = r.product_id;
      v_actual := COALESCE(v_actual, 0);
    END IF;

    v_ajuste := r.counted - v_actual;

    UPDATE public.stock_count_items
       SET stock_al_cerrar = v_actual, ajuste = v_ajuste
     WHERE id = r.id;

    IF v_ajuste <> 0 THEN
      -- Por la única función que mueve stock. Escribirlo a mano acá sería
      -- repetir exactamente el error que hizo falta contar el inventario.
      PERFORM public.record_stock_movement(
        p_org_id=>v_org, p_product_id=>r.product_id, p_variant_id=>NULL,
        p_product_name=>r.name, p_variant_name=>NULL,
        p_movement_type=>'count_adjustment', p_quantity=>v_ajuste::int,
        p_reference_type=>'stock_count', p_reference_id=>p_count_id,
        p_notes=>format('Conteo físico: esperado %s, contado %s', r.expected, r.counted),
        p_created_by=>v_user, p_location_id=>v_loc
      );
      v_ajustados := v_ajustados + 1;
      v_unidades := v_unidades + abs(v_ajuste);
    END IF;
  END LOOP;

  SELECT count(*) INTO v_sin_contar
    FROM public.stock_count_items WHERE count_id = p_count_id AND counted IS NULL;

  UPDATE public.stock_counts
     SET status = 'cerrado', closed_at = now(), closed_by = v_user
   WHERE id = p_count_id;

  RETURN jsonb_build_object(
    'productos_ajustados', v_ajustados,
    'unidades_corregidas', v_unidades,
    -- Se informa a propósito: cerrar con la mitad sin contar es válido —un
    -- conteo cíclico cuenta un sector por vez— pero tiene que verse.
    'sin_contar', v_sin_contar
  );
END;
$$;

COMMENT ON FUNCTION public.cerrar_conteo IS
  'Cierra el conteo y aplica los ajustes por record_stock_movement. Sólo ajusta lo contado: un producto sin contar no se pone en cero, porque "no lo conté" y "conté cero" son cosas distintas.';

REVOKE ALL ON FUNCTION public.abrir_conteo(uuid, uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.abrir_conteo(uuid, uuid, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.cerrar_conteo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_conteo(uuid) TO authenticated;

-- ── Cancelar ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_conteo(p_count_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_estado text;
BEGIN
  SELECT c.org_id, c.status INTO v_org, v_estado
    FROM public.stock_counts c WHERE c.id = p_count_id;
  IF v_org IS NULL OR NOT public.is_org_member(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre este conteo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_estado <> 'abierto' THEN
    RAISE EXCEPTION 'El conteo ya está %', v_estado USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.stock_counts SET status = 'cancelado', closed_at = now(), closed_by = auth.uid()
   WHERE id = p_count_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_conteo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_conteo(uuid) TO authenticated;

-- ── La varianza, para saber dónde se pierde stock ────────────────────────
CREATE OR REPLACE VIEW public.conteo_varianzas
WITH (security_invoker = true) AS
SELECT i.count_id, c.org_id, c.opened_at, c.status,
       i.product_id, p.name AS producto,
       i.expected, i.counted, i.stock_al_cerrar, i.ajuste,
       i.counted - i.expected AS varianza,
       CASE WHEN i.expected > 0
            THEN round(((i.counted - i.expected) / i.expected) * 100, 1)
            ELSE NULL END AS varianza_pct
FROM public.stock_count_items i
JOIN public.stock_counts c ON c.id = i.count_id
JOIN public.products p ON p.id = i.product_id
WHERE i.counted IS NOT NULL AND i.counted <> i.expected;

COMMENT ON VIEW public.conteo_varianzas IS
  'Productos donde lo contado no coincide con lo que el sistema esperaba. Es la lista de dónde se pierde o sobra mercadería; una varianza repetida en el mismo producto no es error de conteo.';

GRANT SELECT ON public.conteo_varianzas TO authenticated;
