-- Un producto puede no llevar stock — P1-02
--
-- ── El sesgo real del onboarding no eran los presets ──────────────────────
--
-- La auditoría del 2026-08-24 dice que el onboarding está sesgado a productos
-- y que faltan servicios, turnos, proyectos y gastronomía. Al medirlo, los
-- siete perfiles de `industry_presets` son datos —agregar uno es un INSERT—
-- así que ése no era el problema.
--
-- El problema es una línea del esquema:
--
--     products.stock  integer  NOT NULL  DEFAULT 0
--
-- y ninguna noción de «esto no se stockea». Una peluquería que carga «Corte de
-- pelo» y lo vende diez veces lo ve en **−10**: `trg_sale_stock_movement`
-- dispara en cada venta y `record_stock_movement` descuenta. La vista
-- `stock_negativo` —que según CONTRIBUTING.md tiene que estar vacía— se llenaría de
-- servicios, y el panel diría «agotado» sobre algo que no se agota.
--
-- 📌 Por eso el arreglo no es agregar rubros: es que el Business Core acepte
-- algo que se vende y no se stockea. Los rubros vienen después, y son datos.
--
-- ── Dónde va la decisión ──────────────────────────────────────────────────
--
-- Dentro de `record_stock_movement`, que es la única autoridad sobre
-- `products.stock`, `product_variants.stock` y `location_stock`. Cubre de una
-- sola vez la venta, la compra, el ajuste manual, el cierre de conteo físico y
-- la transferencia entre sucursales.
--
-- Repartirla entre los triggers sería la misma decisión escrita en cinco
-- lugares, y en este repo eso ya divergió dos veces.
--
-- El default es `true`: los 60 productos que ya existen no cambian en nada.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS maneja_stock boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.maneja_stock IS
  'false = se vende pero no se descuenta nada (un servicio, una hora, un '
  'plato). `record_stock_movement` no le toca el stock ni le escribe Kardex. '
  'Default true: un producto normal no cambia.';

-- El índice sirve a las vistas que ahora tienen que excluirlos.
CREATE INDEX IF NOT EXISTS idx_products_maneja_stock
  ON public.products (org_id) WHERE maneja_stock IS FALSE;

-- ═══════════════════════════════════════════════════════════════════════════
-- La autoridad, regenerada desde `pg_get_functiondef` con la guarda adentro
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.record_stock_movement(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_product_name text, p_variant_name text, p_movement_type text, p_quantity integer, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_unit_cost_usd numeric DEFAULT NULL::numeric, p_unit_price_ars numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resuelto jsonb;
  v_costo_ars numeric;
  v_stock_before INTEGER;
  v_stock_after  INTEGER;
  v_mov_id       UUID;
  v_location_id  UUID := p_location_id;
BEGIN

  -- ── Un producto puede no llevar stock ───────────────────────────────────
  --
  -- Un servicio —un corte de pelo, una hora de consultoría, un plato de un
  -- restaurante— se vende igual que un producto: tiene precio, va al POS, sale
  -- en la factura y suma al margen. Lo que no tiene es algo que descontar.
  --
  -- Sin esta guarda, cada venta lo empuja a −1, −2, −3, y `stock_negativo`
  -- —que según CONTRIBUTING.md tiene que estar vacía— se llena de servicios. El
  -- panel diría «agotado» sobre algo que nunca se agota.
  --
  -- ⚠️ La decisión vive ACÁ y no en los triggers porque ésta es la única
  -- autoridad sobre el stock: cubre de una sola vez la venta, la compra, el
  -- ajuste manual, el cierre de conteo físico y la transferencia entre
  -- sucursales. Repartirla entre los triggers sería la misma decisión escrita
  -- en cinco lugares, que en este repo ya divergió dos veces.
  --
  -- Devuelve NULL —no hay movimiento— y no escribe en `stock_movements`: un
  -- Kardex de algo que no se stockea sería una fila que nadie puede conciliar.
  IF p_product_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.id = p_product_id AND p.maneja_stock IS FALSE
  ) THEN
    RETURN NULL;
  END IF;
  -- Con una sola sucursal activa, cualquier stock sin ubicación sólo puede
  -- estar ahí. Así una variante creada después de habilitar sucursales no
  -- queda global e invisible para la tienda. Con dos o más no se adivina.
  IF v_location_id IS NULL THEN
    SELECT min(l.id::text)::uuid INTO v_location_id
    FROM public.locations l
    WHERE l.org_id = p_org_id AND l.active
    HAVING count(*) = 1;
  END IF;

  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = v_location_id AND l.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'La sucursal del movimiento no pertenece a la organización'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock_before
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
  ELSE
    SELECT stock INTO v_stock_before
    FROM public.products
    WHERE id = p_product_id AND org_id = p_org_id;
  END IF;
  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity;

  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants
       SET stock = v_stock_after
     WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
    UPDATE public.products p
       SET stock = (
         SELECT COALESCE(SUM(pv.stock), 0)
         FROM public.product_variants pv
         WHERE pv.product_id = p.id
       )
     WHERE id = p_product_id AND org_id = p_org_id;
  ELSE
    UPDATE public.products
       SET stock = v_stock_after
     WHERE id = p_product_id AND org_id = p_org_id;
  END IF;

  IF v_location_id IS NOT NULL AND p_product_id IS NOT NULL THEN
    INSERT INTO public.location_stock (org_id, location_id, product_id, stock, updated_at)
    VALUES (p_org_id, v_location_id, p_product_id, p_quantity, now())
    ON CONFLICT (location_id, product_id) DO UPDATE
      SET stock = public.location_stock.stock + EXCLUDED.stock,
          updated_at = now();

    IF p_variant_id IS NOT NULL THEN
      INSERT INTO public.location_variant_stock (
        org_id, location_id, product_id, variant_id, stock, updated_at
      ) VALUES (
        p_org_id, v_location_id, p_product_id, p_variant_id, p_quantity, now()
      )
      ON CONFLICT (location_id, variant_id) DO UPDATE
        SET stock = public.location_variant_stock.stock + EXCLUDED.stock,
            updated_at = now(),
            product_id = EXCLUDED.product_id,
            org_id = EXCLUDED.org_id;
    END IF;
  END IF;

  -- ⚠️ El costo en pesos se CONGELA acá, en el momento del movimiento.
  --
  -- Antes sólo se guardaba `unit_cost_usd` y el ledger lo multiplicaba por la
  -- cotización **de hoy**: una devaluación reescribía el margen de las ventas
  -- del mes pasado. Es el estándar de cualquier ERP —Odoo, SAP B1, Dynamics—
  -- convertir una vez, en la transacción, y no volver a tocarlo.
  --
  -- Y para un producto cuyo costo es en pesos, `unit_cost_usd` es NULL: sin
  -- esta columna entraba al libro con costo cero.
  v_resuelto := public.costo_unitario_ars(p_org_id, p_product_id, p_variant_id);
  v_costo_ars := CASE
    -- Si vino un costo en dólares explícito en la llamada, manda ése: es el de
    -- la compra que se está registrando, no el del catálogo.
    WHEN COALESCE(p_unit_cost_usd, 0) > 0 AND (v_resuelto->>'moneda') = 'USD'
         AND COALESCE((v_resuelto->>'tipo_cambio')::numeric, 0) > 0
      THEN public.redondear_moneda(p_unit_cost_usd * (v_resuelto->>'tipo_cambio')::numeric, 'ARS')
    ELSE NULLIF(v_resuelto->>'costo_ars', '')::numeric
  END;

  INSERT INTO public.stock_movements (
    org_id, product_id, variant_id, product_name, variant_name,
    movement_type, quantity, stock_before, stock_after,
    reference_type, reference_id, unit_cost_usd, unit_cost_ars, unit_price_ars, notes, created_by,
    location_id
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_product_name, p_variant_name,
    p_movement_type, p_quantity, v_stock_before, v_stock_after,
    p_reference_type, p_reference_id, p_unit_cost_usd, v_costo_ars, p_unit_price_ars, p_notes, p_created_by,
    v_location_id
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$function$
;

-- ═══════════════════════════════════════════════════════════════════════════
-- Lo que no se stockea no entra en las listas de stock
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ `stock_negativo` NO necesita cambio: el stock de un servicio nunca se
-- mueve, así que se queda en 0 y no puede volverse negativo. Lo que sí hay que
-- corregir es la lista de reposición: `run_abc_analysis` clasifica por VENTAS,
-- y un servicio se vende — así que aparecía como «quebrado» pidiendo comprar
-- unidades de algo que no se compra.
CREATE OR REPLACE VIEW public.stock_a_reponer AS
SELECT a.org_id,
  a.product_id,
  p.name AS producto,
  p.stock,
  a.days_on_hand AS cobertura_dias,
  a.abc_class,
  a.xyz_class,
  a.velocity,
  a.stockout_risk,
  a.reorder_point,
  a.safety_stock,
  a.eoq,
  a.total_units AS vendidas_en_el_periodo,
  CASE
    WHEN a.reorder_point IS NOT NULL AND p.stock < a.reorder_point
      THEN a.reorder_point - p.stock + COALESCE(a.eoq, 0)
    ELSE NULL::integer
  END AS sugerencia_compra
FROM public.inventory_abc a
JOIN public.products p ON p.id = a.product_id
WHERE a.analysis_date = ((SELECT max(a2.analysis_date) FROM public.inventory_abc a2
                           WHERE a2.org_id = a.org_id))
  AND (a.stockout_risk = ANY (ARRAY['quebrado'::text, 'critico'::text, 'atencion'::text]))
  AND p.maneja_stock;

COMMENT ON VIEW public.stock_a_reponer IS
  'Productos que hay que reponer. Excluye los que no llevan stock: un servicio '
  'se vende, así que el análisis ABC lo marcaba «quebrado» y pedía comprar '
  'unidades de algo que no se compra.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos, con datos ZZ y sin dejar restos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_user     uuid;
  v_prod     uuid := gen_random_uuid();
  v_serv     uuid := gen_random_uuid();
  v_stock_p  int;
  v_stock_s  int;
  v_movs_p   int;
  v_movs_s   int;
  v_restos   int;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ verificacion servicios',
          'zz-serv-' || substr(v_org::text, 1, 8), v_user);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  -- Un producto normal y un servicio, con el mismo stock inicial.
  INSERT INTO public.products (id, org_id, user_id, name, sale_price_ars, stock, maneja_stock)
  VALUES (v_prod, v_org, v_user, 'ZZ producto con stock', 1000, 10, true),
         (v_serv, v_org, v_user, 'ZZ corte de pelo',      1000, 10, false);

  -- Se vende uno de cada uno, por el camino real (el trigger).
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity,
    unit_price_ars, total_ars, cost_of_goods_ars, profit_ars, customer_name,
    date, paid, payment_method, source)
  VALUES (v_org, v_user, v_prod, 'ZZ producto con stock', 3,
          1000, 3000, 1500, 1500, 'ZZ', CURRENT_DATE, true, 'efectivo', 'manual'),
         (v_org, v_user, v_serv, 'ZZ corte de pelo', 3,
          1000, 3000, 1500, 1500, 'ZZ', CURRENT_DATE, true, 'efectivo', 'manual');

  SELECT stock INTO v_stock_p FROM public.products WHERE id = v_prod;
  SELECT stock INTO v_stock_s FROM public.products WHERE id = v_serv;
  SELECT count(*) INTO v_movs_p FROM public.stock_movements WHERE product_id = v_prod;
  SELECT count(*) INTO v_movs_s FROM public.stock_movements WHERE product_id = v_serv;

  -- ── a. El servicio NO se movió ──────────────────────────────────────────
  ASSERT v_stock_s = 10,
    'el servicio se descontó igual: quedó en ' || v_stock_s || ' en vez de 10';
  ASSERT v_movs_s = 0,
    'el servicio dejó ' || v_movs_s || ' movimiento(s) de Kardex que nadie puede conciliar';

  -- ── b. ⚠️ Y el producto normal SÍ ───────────────────────────────────────
  -- Sin esta mitad, una guarda que frenara TODOS los movimientos pasaría el
  -- punto (a) igual — y habría roto el stock de todo el sistema en silencio,
  -- que es exactamente el bug que costó meses de conteos a mano.
  ASSERT v_stock_p = 7,
    'el producto normal NO se descontó: quedó en ' || v_stock_p || ' en vez de 7';
  ASSERT v_movs_p = 1,
    'el producto normal dejó ' || v_movs_p || ' movimientos en vez de 1';

  -- ── c. Sin restos ───────────────────────────────────────────────────────
  -- ⚠️ Las ventas se borran ANTES que la organización, y a propósito.
  -- El CASCADE borra `sales`, eso dispara `trg_sale_stock_movement` en DELETE,
  -- y el trigger intenta escribir en `stock_movements` una fila que apunta a
  -- una organización que el mismo CASCADE ya podría haber borrado: falla con
  -- 23503. Se descubrió acá, limpiando datos ZZ.
  --
  -- 📌 Y no es sólo un problema de este test: significa que **borrar una
  -- organización con ventas puede fallar**, y eso es una acción real de
  -- superadmin. Queda anotado como hallazgo aparte.
  DELETE FROM public.sales WHERE org_id = v_org;
  DELETE FROM public.stock_movements WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;   -- el resto va en CASCADE
  SELECT count(*) INTO v_restos FROM public.products WHERE org_id = v_org;
  ASSERT v_restos = 0, 'quedaron ' || v_restos || ' productos ZZ';

  RAISE NOTICE 'OK: el servicio no se mueve, el producto sí, sin restos';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000090', 'un_producto_puede_no_llevar_stock')
ON CONFLICT DO NOTHING;
