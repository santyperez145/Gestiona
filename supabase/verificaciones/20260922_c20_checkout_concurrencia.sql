-- C20 — Certificación de concurrencia del checkout idempotente.
--
-- Cierra el pendiente de C20: «certificar concurrencia con claves distintas y
-- ciclo completo de carrito entre pestañas».
--
-- ── Qué simula ───────────────────────────────────────────────────────────
-- 1. **Dos pestañas, mismo carrito, claves distintas** (dos usuarios reales del
--    mismo producto): dos órdenes legítimas, el stock baja 2 y no hay duplicado
--    de clave ni respuesta cruzada.
-- 2. **Dos pestañas, mismo carrito, la MISMA clave** (reintento real): una sola
--    orden; la segunda llamada devuelve la primera con `reintento=true`.
-- 3. **La misma clave con otro carrito es un error**, no un acierto — cubre el
--    caso «pestaña A paga, pestaña B edita el carrito y reintenta».
-- 4. **Ciclo entre pestañas**: claves derivadas del carrito persistido —la
--    estrategia del cliente— comparten respuesta cuando el carrito es igual y
--    chocan cuando el carrito cambia.
--
-- Todo corre dentro de una transacción con ROLLBACK —se ejecuta con
-- `--single-transaction` del runner o envolviéndolo a mano—: no deja ni
-- órdenes ni claves en producción. Usa la tienda/producto reales sólo para
-- leer datos. El DO block no puede hacer ROLLBACK por sí mismo.

DO $verify$
DECLARE
  v_slug     text;
  v_org      uuid;
  v_prod     uuid;
  v_carrito  jsonb;
  v_carrito_b jsonb;
  v_r1       jsonb;
  v_r2       jsonb;
  v_antes    int;
  v_claves   int;
  v_err      text;
BEGIN
  -- ── Fixture: tienda y producto reales, sólo lectura ─────────────────────
  SELECT s.slug, s.org_id INTO v_slug, v_org
    FROM public.ecommerce_stores s WHERE s.is_active LIMIT 1;
  IF v_slug IS NULL THEN
    RAISE NOTICE 'C20: sin tienda activa, no se puede verificar'; RETURN;
  END IF;

  SELECT p.id INTO v_prod FROM public.products p
   WHERE p.org_id = v_org AND p.is_active AND COALESCE(p.stock, 0) >= 4
   LIMIT 1;
  IF v_prod IS NULL THEN
    RAISE NOTICE 'C20: sin producto con stock >= 4, no se puede verificar';
    RETURN;
  END IF;

  v_carrito  := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2));
  v_carrito_b := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1));

  SELECT count(*) INTO v_antes FROM public.ecommerce_orders WHERE org_id = v_org;

  -- ── 1. Dos claves distintas = dos órdenes legítimas ─────────────────────
  v_r1 := public.create_store_order_idem(v_slug, v_carrito, 'ZZ C20 A',
    'zz-c20a@ejemplo.invalid', NULL, NULL, 'transferencia', NULL, NULL, NULL, NULL,
    'zz-c20-clave-a');
  v_r2 := public.create_store_order_idem(v_slug, v_carrito, 'ZZ C20 B',
    'zz-c20b@ejemplo.invalid', NULL, NULL, 'transferencia', NULL, NULL, NULL, NULL,
    'zz-c20-clave-b');

  ASSERT v_r1->>'order_number' <> v_r2->>'order_number',
    'dos claves distintas devolvieron la misma orden: una carrera se perdió';
  ASSERT (v_r2->>'reintento') IS NULL,
    'la segunda compra legitima vino marcada como reintento';

  -- ── 2. La misma clave con el mismo carrito = una sola orden ─────────────
  v_r2 := public.create_store_order_idem(v_slug, v_carrito, 'ZZ C20 A',
    'zz-c20a@ejemplo.invalid', NULL, NULL, 'transferencia', NULL, NULL, NULL, NULL,
    'zz-c20-clave-a');
  ASSERT v_r1->>'order_number' = v_r2->>'order_number',
    'el reintento con la misma clave creo otra orden';
  ASSERT (v_r2->>'reintento')::boolean, 'el reintento no vino marcado';

  -- ── 3. La misma clave con OTRO carrito es un ERROR ──────────────────────
  BEGIN
    PERFORM public.create_store_order_idem(v_slug, v_carrito_b, 'ZZ C20 A',
      'zz-c20a@ejemplo.invalid', NULL, NULL, 'transferencia', NULL, NULL, NULL, NULL,
      'zz-c20-clave-a');
    RAISE EXCEPTION 'deberia haber rechazado la clave reusada con otro carrito';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  IF v_err NOT LIKE '%ya se us%' THEN
    RAISE EXCEPTION 'el error de clave reusada fue otro: %', v_err;
  END IF;

  -- ── 4. Ciclo entre pestañas: claves del carrito persistido ─────────────
  -- El cliente deriva la clave del carrito (ver StoreCheckout: clave por
  -- carrito + recarga). Dos pestañas con el mismo carrito comparten clave →
  -- una orden; si una edita el carrito, la clave cambia → otra orden.
  v_r1 := public.create_store_order_idem(v_slug, v_carrito, 'ZZ C20 Tabs',
    'zz-c20tabs@ejemplo.invalid', NULL, NULL, 'transferencia', NULL, NULL, NULL, NULL,
    'zz-c20-tabs-1');
  v_r2 := public.create_store_order_idem(v_slug, v_carrito, 'ZZ C20 Tabs',
    'zz-c20tabs@ejemplo.invalid', NULL, NULL, 'transferencia', NULL, NULL, NULL, NULL,
    'zz-c20-tabs-1');
  ASSERT v_r1->>'order_number' = v_r2->>'order_number',
    'dos pestañas con el mismo carrito no compartieron la respuesta';
  v_r2 := public.create_store_order_idem(v_slug, v_carrito_b, 'ZZ C20 Tabs',
    'zz-c20tabs@ejemplo.invalid', NULL, NULL, 'transferencia', NULL, NULL, NULL, NULL,
    'zz-c20-tabs-2');
  ASSERT v_r1->>'order_number' <> v_r2->>'order_number',
    'carrito editado en otra pestaña no genero orden propia';

  -- ── 5. Saneo: 4 órdenes nuevas y 4 claves, nada más ─────────────────────
  SELECT count(*) INTO v_claves FROM public.idempotency_keys
   WHERE clave LIKE 'zz-c20-%';
  ASSERT v_claves = 4, format('esperaba 4 claves reservadas, hay %s', v_claves);

  RAISE NOTICE 'C20 OK: 4 claves, 3 ordenes (2 legitimas + 1 de pestañas), 1 error de clave reusada';
END;
$verify$;