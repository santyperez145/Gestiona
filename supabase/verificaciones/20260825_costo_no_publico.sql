-- Segunda pasada: las dos que quedaron y podrían filtrar plata.
-- Esta vez con org y producto que SÍ se corresponden — la prueba anterior usó
-- un producto de otra organización y por eso "falló" sin probar nada.

CREATE TEMP TABLE r(n int, ataque text, resultado text, seguro boolean);
GRANT ALL ON r TO anon;

DO $blk$
DECLARE v_org uuid; v_prod uuid; v_res jsonb; v_n numeric;
BEGIN
  -- El par correcto: producto DE esa organización.
  SELECT p.org_id, p.id INTO v_org, v_prod
    FROM public.products p
   WHERE p.is_active IS NOT FALSE
   ORDER BY p.created_at LIMIT 1;

  SET LOCAL ROLE anon;

  BEGIN
    v_res := public.precio_pos_autoritativo(v_org, v_prod, NULL, 1);
    -- ⚠️ Lo que importa no es que ejecute: es SI DEVUELVE EL COSTO. El precio
    -- de venta ya es público en la tienda; el costo y el margen no.
    INSERT INTO r VALUES (1,'precio_pos_autoritativo: devuelve costo?',
      left(v_res::text, 160),
      NOT (v_res::text ILIKE '%cost%' OR v_res::text ILIKE '%costo%'
        OR v_res::text ILIKE '%margen%' OR v_res::text ILIKE '%profit%'
        OR v_res::text ILIKE '%ganancia%'));
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (1,'precio_pos_autoritativo: devuelve costo?', left(SQLERRM,60), true);
  END;

  BEGIN
    v_n := public.platform_commission_amount(v_org, 100000, 'mercado_pago');
    INSERT INTO r VALUES (2,'platform_commission_amount (comision de plataforma)',
      'DEVOLVIO '||v_n::text, false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (2,'platform_commission_amount (comision de plataforma)',
      left(SQLERRM,60), true);
  END;

  BEGIN
    SELECT public.stock_disponible(v_prod, NULL) INTO v_n;
    INSERT INTO r VALUES (3,'stock_disponible (ya es publico en la tienda)',
      'DEVOLVIO '||v_n::text, true);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (3,'stock_disponible (ya es publico en la tienda)', left(SQLERRM,60), true);
  END;

  RESET ROLE;
END $blk$;

SELECT n, ataque, resultado,
       CASE WHEN seguro THEN 'sin fuga' ELSE '*** REVISAR ***' END AS veredicto
FROM r ORDER BY n;
