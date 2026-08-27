-- ¿Un comercio nuevo puede vender?
--
-- ── Para qué existe ───────────────────────────────────────────────────────
--
-- El norte del producto es `Active Transacting Merchants`: un comercio externo
-- que vende sin ayuda técnica. Esta verificación recorre ese camino entero
-- sobre una organización recién creada y falla si algún tramo se rompe.
--
-- ⚠️ **Con una sola organización varios de estos bugs no se pueden
-- reproducir.** El 2026-08-27 esta misma auditoría encontró dos que llevaban
-- días escondidos porque Exentry ya tenía todo configurado de antes:
--
--   · el rubro salía `perfumes` en un comercio que nunca eligió — el default
--     viejo, que se sacó de la columna pero no de las filas ya escritas;
--   · **la primera venta no llegaba al libro**: los tres triggers de asiento
--     cortaban con «sin plan de cuentas no hay libro donde asentar», y nada
--     más sembraba el plan. Un círculo cerrado, y silencioso, porque el
--     trigger atrapa la excepción para no voltear la venta.
--
-- Por eso conviene correrla después de tocar cualquier cosa del Business Core.
--
-- ── Cómo se corre ─────────────────────────────────────────────────────────
--
--   npx supabase db query --linked --file supabase/verificaciones/20260827_comercio_nuevo_puede_vender.sql
--
-- Crea datos `ZZ`, ejerce los caminos reales y **borra todo**. La última
-- consulta cuenta los restos y tiene que dar 0.
--
-- 📌 Se ejerce por los caminos REALES —el trigger de ventas, la RPC del POS,
-- la RPC del checkout público— y como los ROLES reales: `authenticated` para
-- el comercio y `anon` para el comprador. Un bloque `DO` corre como
-- superusuario y bypassa la RLS: sin `SET ROLE` esto daría verde siempre.

BEGIN;

CREATE TEMP TABLE res(n int, paso text, esperado text, obtenido text) ON COMMIT DROP;
GRANT ALL ON res TO anon, authenticated;
CREATE TEMP TABLE ctx(org uuid, usr uuid, prod uuid, slug text) ON COMMIT DROP;
GRANT ALL ON ctx TO anon, authenticated;

INSERT INTO ctx
SELECT gen_random_uuid(),
       (SELECT user_id FROM public.memberships LIMIT 1),
       gen_random_uuid(),
       'zz-comercio-nuevo';

-- ═══ Un comercio recién nacido ═══════════════════════════════════════════
INSERT INTO public.organizations (id, name, slug, owner_user_id)
SELECT org, 'ZZ comercio nuevo', 'zz-org-'||substr(org::text,1,8), usr FROM ctx;
INSERT INTO public.memberships (org_id, user_id, role) SELECT org, usr, 'owner' FROM ctx;

INSERT INTO res
SELECT 1, 'nace con settings', '1',
       (SELECT count(*)::text FROM public.settings WHERE org_id=(SELECT org FROM ctx));

INSERT INTO res
SELECT 2, 'nace con la matriz de permisos', '>0',
       CASE WHEN (SELECT count(*) FROM public.role_permissions WHERE org_id=(SELECT org FROM ctx)) > 0
            THEN '>0' ELSE '0' END;

-- ⚠️ El rubro NO se adivina: un comercio que no eligió tiene NULL.
INSERT INTO res
SELECT 3, 'el rubro no viene puesto', 'NULL',
       COALESCE((SELECT industry_code FROM public.settings WHERE org_id=(SELECT org FROM ctx)), 'NULL');

-- ═══ Carga su primer producto y vende en el mostrador ════════════════════
INSERT INTO public.products (id, org_id, user_id, name, sale_price_ars, stock, is_active)
SELECT prod, org, usr, 'ZZ primer producto', 5000, 5, true FROM ctx;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT usr::text FROM ctx),'role','authenticated')::text, true);

DO $$
BEGIN
  PERFORM public.create_sales_transaction_v3(
    (SELECT org FROM ctx),
    jsonb_build_array(jsonb_build_object(
      'product_id',(SELECT prod FROM ctx), 'product_name','ZZ primer producto',
      'quantity',1, 'unit_price_ars',5000, 'total_ars',5000,
      'cost_of_goods_ars',2000, 'profit_ars',3000,
      'customer_name','ZZ cliente', 'payment_method','efectivo', 'paid',true)),
    'pos');
  INSERT INTO res VALUES (4, 'vender en el POS', 'PUDO', 'PUDO');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (4, 'vender en el POS', 'PUDO', 'FRENADO: '||SQLERRM);
END $$;

-- Los seeds que la UI dispara a demanda
DO $$
BEGIN
  PERFORM public.seed_default_price_list((SELECT org FROM ctx));
  PERFORM public.seed_default_shipping_zones((SELECT org FROM ctx));
  INSERT INTO res VALUES (5, 'sembrar precios y envíos', 'PUDO', 'PUDO');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (5, 'sembrar precios y envíos', 'PUDO', 'FRENADO: '||SQLERRM);
END $$;

-- Su tienda online
DO $$
BEGIN
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active)
  SELECT org, slug, 'ZZ Tienda', true FROM ctx;
  INSERT INTO res VALUES (8, 'crear la tienda', 'PUDO', 'PUDO');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (8, 'crear la tienda', 'PUDO', 'FRENADO: '||SQLERRM);
END $$;

RESET ROLE;

-- Lo que la venta tiene que haber dejado
INSERT INTO res
SELECT 6, 'el stock bajó', '4',
       (SELECT stock::text FROM public.products WHERE id=(SELECT prod FROM ctx));

-- ⚠️ Éste es el que falló el 2026-08-27 y no hacía ruido.
INSERT INTO res
SELECT 7, 'la venta llegó al libro', '>0',
       CASE WHEN (SELECT count(*) FROM public.ledger_entries WHERE org_id=(SELECT org FROM ctx)) > 0
            THEN '>0' ELSE '0 ← la venta no se asentó' END;

-- ═══ Y ahora el comprador anónimo, que es quien tiene que poder comprar ══
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', NULL, true);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.get_store_by_slug((SELECT slug FROM ctx));
  INSERT INTO res VALUES (9, 'el comprador ve la tienda', '1', n::text);

  SELECT count(*) INTO n FROM public.store_catalog_products WHERE org_id=(SELECT org FROM ctx);
  INSERT INTO res VALUES (10, 've el producto publicado', '1', n::text);

  PERFORM public.create_store_order(
    p_slug            => (SELECT slug FROM ctx),
    p_items           => jsonb_build_array(jsonb_build_object('product_id',(SELECT prod FROM ctx),'quantity',1)),
    p_customer_name   => 'ZZ Comprador',
    p_customer_email  => 'zz@ejemplo.com',
    p_customer_phone  => '1122334455',
    p_shipping        => NULL,
    p_payment_method  => 'transferencia',
    p_notes           => NULL,
    p_coupon          => NULL,
    p_shipping_option => 'pickup',
    p_fiscal          => NULL);
  INSERT INTO res VALUES (11, 'comprar en la tienda', 'PUDO', 'PUDO');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (11, 'comprar en la tienda', 'PUDO', 'FRENADO: '||SQLERRM);
END $$;

RESET ROLE;

-- ═══ Y la app le dice qué le falta ══════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT usr::text FROM ctx),'role','authenticated')::text, true);
INSERT INTO res
SELECT 12, 'la activación lo mide', 'una fila',
       COALESCE((SELECT 'una fila' FROM public.organization_activation_readiness
                  WHERE org_id=(SELECT org FROM ctx) LIMIT 1), 'ninguna');
RESET ROLE;

-- ═══ El resultado ════════════════════════════════════════════════════════
SELECT n, paso, esperado, obtenido,
       CASE WHEN obtenido = esperado THEN 'ok' ELSE '← MIRAR' END AS veredicto
FROM res ORDER BY n;

-- ═══ Limpieza ════════════════════════════════════════════════════════════
-- ⚠️ Las ventas van ANTES que la organización: el CASCADE dispara
-- `trg_sale_stock_movement` en DELETE, que escribe en `stock_movements`
-- apuntando a una organización que el mismo CASCADE puede haber borrado.
DELETE FROM public.sales           WHERE org_id = (SELECT org FROM ctx);
DELETE FROM public.stock_movements WHERE org_id = (SELECT org FROM ctx);
DELETE FROM public.organizations   WHERE id     = (SELECT org FROM ctx);

ROLLBACK;

-- La última fila cuenta los restos: tiene que dar 0.
SELECT count(*) AS restos_zz
FROM public.organizations WHERE name = 'ZZ comercio nuevo';
